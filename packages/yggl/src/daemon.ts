import type { ChildProcess } from 'node:child_process'
import { execSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { join, resolve } from 'node:path'
import { resolveBinary } from './binary.js'
import type { YgglConfig } from './config.js'
import { mergeYggstackConfig, parseYggstackConfig } from './yggstack-conf.js'

export const YGGL_DIR = '.yggl'
export const YGGSTACK_CONF = join(YGGL_DIR, 'yggstack.conf')

export class DaemonError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'DaemonError'
	}
}

export type DaemonSource = 'adopted' | 'spawned-bundled' | 'spawned-system' | 'spawned-custom'

export interface DetectionDeps {
	probeAdminSocket?: (host: string, port: number) => Promise<boolean>
	findInPath?: (cmd: string) => string | null
	findBundled?: (pkgName: string, binaryName: string) => string | null
}

function defaultProbeAdminSocket(host: string, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ host, port })
		socket.setTimeout(2000)
		socket.on('connect', () => {
			socket.destroy()
			resolve(true)
		})
		socket.on('error', () => resolve(false))
		socket.on('timeout', () => {
			socket.destroy()
			resolve(false)
		})
	})
}

function defaultFindInPath(cmd: string): string | null {
	const which = process.platform === 'win32' ? 'where' : 'which'
	try {
		const result = execSync(`${which} ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] })
		return result.toString().trim().split('\n')[0] ?? null
	} catch {
		return null
	}
}

export type DetectionResult =
	| { adopted: true; binaryPath: null; source: 'adopted' }
	| {
			adopted: false
			binaryPath: string
			source: 'system-yggdrasil' | 'system-yggstack' | 'bundled'
	  }

export async function detectDaemon(
	config: YgglConfig,
	deps: DetectionDeps = {},
): Promise<DetectionResult> {
	const probeAdminSocket = deps.probeAdminSocket ?? defaultProbeAdminSocket
	const findInPath = deps.findInPath ?? defaultFindInPath

	// 1. Check if a daemon is already running
	const running = await probeAdminSocket(config.adminSocket.host, config.adminSocket.port)
	if (running) {
		return { adopted: true, binaryPath: null, source: 'adopted' }
	}

	// 2. system yggdrasil (requires root — just detect, warn at CLI layer)
	const sysYggdrasil = findInPath('yggdrasil')
	if (sysYggdrasil) {
		return { adopted: false, binaryPath: sysYggdrasil, source: 'system-yggdrasil' }
	}

	// 3. system yggstack
	const sysYggstack = findInPath('yggstack')
	if (sysYggstack) {
		return { adopted: false, binaryPath: sysYggstack, source: 'system-yggstack' }
	}

	// 4. bundled binary
	const bundled = resolveBinary(
		'bundled',
		deps.findBundled ? { findBundled: deps.findBundled } : {},
	)
	return { adopted: false, binaryPath: bundled, source: 'bundled' }
}

export class DaemonManager {
	private proc: ChildProcess | null = null
	private _source: DaemonSource | null = null

	get source(): DaemonSource | null {
		return this._source
	}

	async isRunning(config: YgglConfig): Promise<boolean> {
		return defaultProbeAdminSocket(config.adminSocket.host, config.adminSocket.port)
	}

	async start(config: YgglConfig): Promise<DaemonSource> {
		// Already running externally — adopt it
		const running = await this.isRunning(config)
		if (running) {
			this._source = 'adopted'
			return 'adopted'
		}

		const confPath = resolve(YGGSTACK_CONF)
		if (!existsSync(confPath)) {
			throw new DaemonError(
				`yggstack config not found at ${confPath}\nRun \`yggl init\` to generate it.`,
			)
		}

		// Merge runtime settings into stored yggstack config
		const base = parseYggstackConfig(readFileSync(confPath, 'utf8'))
		const merged = mergeYggstackConfig(base, config)
		const runtimeConf = join(YGGL_DIR, 'yggstack.runtime.conf')
		writeFileSync(runtimeConf, JSON.stringify(merged, null, '\t'), 'utf8')

		// Resolve binary
		const detection = await detectDaemon(config)
		if (detection.adopted) {
			this._source = 'adopted'
			return 'adopted'
		}
		const binaryPath = detection.binaryPath

		this.proc = spawn(binaryPath, ['-useconffile', runtimeConf], {
			stdio: ['ignore', 'pipe', 'pipe'],
			detached: false,
		})

		this.proc.stdout?.on('data', (data: Buffer) => {
			process.stderr.write(`[yggstack] ${data}`)
		})
		this.proc.stderr?.on('data', (data: Buffer) => {
			process.stderr.write(`[yggstack] ${data}`)
		})

		await this.waitForSocket(config)

		const src =
			detection.source === 'bundled'
				? 'spawned-bundled'
				: detection.source === 'system-yggstack'
					? 'spawned-system'
					: 'spawned-custom'
		this._source = src as DaemonSource
		return src as DaemonSource
	}

	async stop(): Promise<void> {
		if (this._source === 'adopted') {
			throw new DaemonError(
				'This daemon was not started by yggl and will not be stopped.\n' +
					'Stop it manually with your system service manager.',
			)
		}
		if (!this.proc) return

		this.proc.kill('SIGTERM')
		await new Promise<void>((resolve) => {
			this.proc?.once('exit', () => resolve())
			setTimeout(resolve, 5000)
		})
		this.proc = null
		this._source = null
	}

	private waitForSocket(config: YgglConfig, timeoutMs = 10000): Promise<void> {
		const { host, port } = config.adminSocket
		const interval = 200
		const deadline = Date.now() + timeoutMs

		return new Promise((resolve, reject) => {
			const attempt = () => {
				defaultProbeAdminSocket(host, port).then((up) => {
					if (up) return resolve()
					if (Date.now() >= deadline)
						return reject(new DaemonError('yggstack failed to start within timeout'))
					setTimeout(attempt, interval)
				})
			}
			attempt()
		})
	}
}

export function initYggstackConf(binaryPath: string): void {
	mkdirSync(YGGL_DIR, { recursive: true })
	const confPath = resolve(YGGSTACK_CONF)
	if (existsSync(confPath)) {
		throw new DaemonError(`yggstack config already exists at ${confPath}`)
	}
	const raw = execSync(`"${binaryPath}" -genconf -json`, {
		stdio: ['ignore', 'pipe', 'ignore'],
	})
	writeFileSync(confPath, raw.toString(), 'utf8')
}
