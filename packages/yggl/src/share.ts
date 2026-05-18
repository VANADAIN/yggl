import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { createServer, request as httpRequest } from 'node:http'
import { createConnection } from 'node:net'
import { join, resolve } from 'node:path'
import { AdminClient } from './admin.js'
import type { YgglConfig } from './config.js'
import type { DetectionDeps } from './daemon.js'
import { detectDaemon, YGGL_DIR, YGGSTACK_CONF } from './daemon.js'
import { mergeYggstackConfig, parseYggstackConfig } from './yggstack-conf.js'

export class ShareError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'ShareError'
	}
}

export interface ShareOptions {
	port: number
	auth?: boolean
	token?: string
	allowKeys?: string[]
}

export interface ShareResult {
	address: string
	port: number
	token?: string
	url: string
}

export interface ShareManagerDeps extends DetectionDeps {
	spawnProcess?: (binaryPath: string, args: string[]) => ChildProcess
	confPath?: string
	runtimeConfPath?: string
	waitForAdminSocket?: (host: string, port: number, timeoutMs?: number) => Promise<void>
}

export function generateToken(): string {
	return randomBytes(24).toString('base64url')
}

export function createTokenProxy(targetPort: number, token: string): Server {
	const expected = `Bearer ${token}`

	const server = createServer((req, res) => {
		if (req.headers.authorization !== expected) {
			res.writeHead(401, {
				'Content-Type': 'text/plain',
				'WWW-Authenticate': 'Bearer realm="yggl"',
			})
			res.end('Unauthorized')
			return
		}

		const headers = { ...req.headers }
		delete headers.authorization

		const proxyReq = httpRequest(
			{ host: '127.0.0.1', port: targetPort, method: req.method, path: req.url, headers },
			(proxyRes) => {
				res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers)
				proxyRes.pipe(res)
			},
		)
		proxyReq.on('error', () => {
			if (!res.headersSent) {
				res.writeHead(502, { 'Content-Type': 'text/plain' })
				res.end('Bad Gateway')
			}
		})
		req.pipe(proxyReq)
	})

	server.on('upgrade', (req, socket, head) => {
		if (req.headers.authorization !== expected) {
			socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Bearer realm="yggl"\r\n\r\n')
			socket.destroy()
			return
		}

		const target = createConnection({ host: '127.0.0.1', port: targetPort })
		target.on('connect', () => {
			let upgradeReq = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`
			for (const [key, value] of Object.entries(req.headers)) {
				if (key.toLowerCase() !== 'authorization') upgradeReq += `${key}: ${value}\r\n`
			}
			upgradeReq += '\r\n'
			target.write(upgradeReq)
			if (head.length > 0) target.write(head)
			socket.pipe(target)
			target.pipe(socket)
		})
		target.on('error', () => socket.destroy())
		socket.on('error', () => target.destroy())
	})

	return server
}

function proxyListen(server: Server): Promise<number> {
	return new Promise((resolve, reject) => {
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address()
			if (addr && typeof addr === 'object') resolve(addr.port)
			else reject(new ShareError('Failed to get proxy listen port'))
		})
		server.on('error', reject)
	})
}

function waitForAdminSocket(host: string, port: number, timeoutMs = 10000): Promise<void> {
	const interval = 200
	const deadline = Date.now() + timeoutMs
	return new Promise((resolve, reject) => {
		const attempt = () => {
			const socket = createConnection({ host, port })
			socket.setTimeout(1000)
			socket.on('connect', () => {
				socket.destroy()
				resolve()
			})
			socket.on('error', () => {
				if (Date.now() >= deadline) {
					reject(new ShareError('yggstack failed to start within timeout'))
					return
				}
				setTimeout(attempt, interval)
			})
			socket.on('timeout', () => {
				socket.destroy()
				if (Date.now() >= deadline) {
					reject(new ShareError('yggstack failed to start within timeout'))
					return
				}
				setTimeout(attempt, interval)
			})
		}
		attempt()
	})
}

export class ShareManager {
	private proc: ChildProcess | null = null
	private proxyServer: Server | null = null

	async start(
		config: YgglConfig,
		options: ShareOptions,
		deps: ShareManagerDeps = {},
	): Promise<ShareResult> {
		const { port, auth = false, allowKeys = [] } = options
		const token = auth ? (options.token ?? generateToken()) : undefined
		const waitForAdmin = deps.waitForAdminSocket ?? waitForAdminSocket

		const detection = await detectDaemon(config, deps)
		if (detection.adopted) {
			throw new ShareError(
				'A daemon is already running on the admin socket. Stop it first before sharing.',
			)
		}
		const binaryPath = detection.binaryPath

		const confPath = deps.confPath ?? resolve(YGGSTACK_CONF)
		if (!existsSync(confPath)) {
			throw new ShareError(
				`yggstack config not found at ${confPath}\nRun \`yggl init\` to generate it.`,
			)
		}

		const base = parseYggstackConfig(readFileSync(confPath, 'utf8'))
		const merged = mergeYggstackConfig(base, config)
		if (allowKeys.length > 0) merged.AllowedPublicKeys = allowKeys

		const runtimeConf = deps.runtimeConfPath ?? join(YGGL_DIR, 'yggstack.runtime.conf')
		writeFileSync(runtimeConf, JSON.stringify(merged, null, '\t'), 'utf8')

		let localPort = port
		if (token !== undefined) {
			this.proxyServer = createTokenProxy(port, token)
			localPort = await proxyListen(this.proxyServer)
		}

		const spawnFn =
			deps.spawnProcess ??
			((cmd: string, args: string[]) =>
				spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: false }))

		this.proc = spawnFn(binaryPath, [
			'-useconffile',
			runtimeConf,
			'-remote-tcp',
			`${port}:127.0.0.1:${localPort}`,
		])
		this.proc.stdout?.on('data', (data: Buffer) => process.stderr.write(`[yggstack] ${data}`))
		this.proc.stderr?.on('data', (data: Buffer) => process.stderr.write(`[yggstack] ${data}`))

		await waitForAdmin(config.adminSocket.host, config.adminSocket.port)
		const adminClient = new AdminClient(config)
		const self = await adminClient.getSelf()

		return {
			address: self.address,
			port,
			url: `http://[${self.address}]:${port}`,
			...(token !== undefined ? { token } : {}),
		}
	}

	async stop(): Promise<void> {
		if (this.proxyServer) {
			await new Promise<void>((r) => this.proxyServer?.close(() => r()))
			this.proxyServer = null
		}
		if (this.proc) {
			this.proc.kill('SIGTERM')
			await new Promise<void>((r) => {
				this.proc?.once('exit', () => r())
				setTimeout(r, 5000)
			})
			this.proc = null
		}
	}
}
