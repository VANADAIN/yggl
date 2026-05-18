import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { join, resolve } from 'node:path'
import type { YgglConfig } from './config.js'
import type { DetectionDeps } from './daemon.js'
import { detectDaemon, YGGL_DIR, YGGSTACK_CONF } from './daemon.js'
import { mergeYggstackConfig, parseYggstackConfig } from './yggstack-conf.js'

export class ConnectError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'ConnectError'
	}
}

export interface ConnectOptions {
	remoteAddress: string
	remotePort: number
	localPort?: number
}

export interface ConnectResult {
	localPort: number
}

export interface ConnectManagerDeps extends DetectionDeps {
	spawnProcess?: (binaryPath: string, args: string[]) => ChildProcess
	confPath?: string
	runtimeConfPath?: string
	waitForLocalPort?: (port: number, timeoutMs?: number) => Promise<void>
}

export function parseConnectTarget(target: string): { address: string; port: number } {
	// "[200:xxxx::1]:3000" bracketed form
	const bracketMatch = target.match(/^\[([^\]]+)\]:(\d+)$/)
	if (bracketMatch) {
		const port = Number.parseInt(bracketMatch[2] ?? '', 10)
		if (Number.isNaN(port) || port < 1 || port > 65535)
			throw new ConnectError(`Invalid port in connect target: ${target}`)
		return { address: bracketMatch[1] ?? '', port }
	}

	// "200:xxxx::1:3000" — last colon separates port
	const lastColon = target.lastIndexOf(':')
	if (lastColon === -1) throw new ConnectError(`Invalid connect target: ${target}`)
	const address = target.slice(0, lastColon)
	const port = Number.parseInt(target.slice(lastColon + 1), 10)
	if (!address || Number.isNaN(port) || port < 1 || port > 65535)
		throw new ConnectError(`Invalid connect target: ${target}`)
	return { address, port }
}

function waitForLocalPort(port: number, timeoutMs = 10000): Promise<void> {
	const interval = 200
	const deadline = Date.now() + timeoutMs
	return new Promise((resolve, reject) => {
		const attempt = () => {
			const socket = createConnection({ host: '127.0.0.1', port })
			socket.setTimeout(1000)
			socket.on('connect', () => {
				socket.destroy()
				resolve()
			})
			socket.on('error', () => {
				if (Date.now() >= deadline) {
					reject(new ConnectError('yggstack failed to set up local TCP forward within timeout'))
					return
				}
				setTimeout(attempt, interval)
			})
			socket.on('timeout', () => {
				socket.destroy()
				if (Date.now() >= deadline) {
					reject(new ConnectError('yggstack local TCP forward timed out'))
					return
				}
				setTimeout(attempt, interval)
			})
		}
		attempt()
	})
}

export class ConnectManager {
	private proc: ChildProcess | null = null

	async start(
		config: YgglConfig,
		options: ConnectOptions,
		deps: ConnectManagerDeps = {},
	): Promise<ConnectResult> {
		const { remoteAddress, remotePort, localPort = remotePort } = options
		const waitForForward = deps.waitForLocalPort ?? waitForLocalPort

		const detection = await detectDaemon(config, deps)
		if (detection.adopted) {
			throw new ConnectError(
				'A daemon is already running on the admin socket. Stop it first before connecting.',
			)
		}
		const binaryPath = detection.binaryPath

		const confPath = deps.confPath ?? resolve(YGGSTACK_CONF)
		if (!existsSync(confPath)) {
			throw new ConnectError(
				`yggstack config not found at ${confPath}\nRun \`yggl init\` to generate it.`,
			)
		}

		const base = parseYggstackConfig(readFileSync(confPath, 'utf8'))
		const merged = mergeYggstackConfig(base, config)
		const runtimeConf = deps.runtimeConfPath ?? join(YGGL_DIR, 'yggstack.runtime.conf')
		writeFileSync(runtimeConf, JSON.stringify(merged, null, '\t'), 'utf8')

		const spawnFn =
			deps.spawnProcess ??
			((cmd: string, args: string[]) =>
				spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: false }))

		this.proc = spawnFn(binaryPath, [
			'-useconffile',
			runtimeConf,
			'-local-tcp',
			`${localPort}:[${remoteAddress}]:${remotePort}`,
		])
		this.proc.stdout?.on('data', (data: Buffer) => process.stderr.write(`[yggstack] ${data}`))
		this.proc.stderr?.on('data', (data: Buffer) => process.stderr.write(`[yggstack] ${data}`))

		await waitForForward(localPort)

		return { localPort }
	}

	async stop(): Promise<void> {
		if (!this.proc) return
		this.proc.kill('SIGTERM')
		await new Promise<void>((r) => {
			this.proc?.once('exit', () => r())
			setTimeout(r, 5000)
		})
		this.proc = null
	}
}
