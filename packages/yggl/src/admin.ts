import { createConnection } from 'node:net'
import type { YgglConfig } from './config.js'

export class AdminError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'AdminError'
	}
}

export interface SelfInfo {
	address: string
	publicKey: string
	buildName: string
	buildVersion: string
}

export interface PeerInfo {
	address: string
	publicKey: string
	remote: string
	uptime: number
	rxBytes: number
	txBytes: number
	latency: number
}

export interface SessionInfo {
	address: string
	publicKey: string
	uptime: number
	rxBytes: number
	txBytes: number
}

type AdminRequest = { request: string; keepalive: false }

interface AdminResponse {
	status: 'success' | 'error'
	response?: unknown
	error?: string
}

export interface AdminClientDeps {
	sendRequest?: (host: string, port: number, req: AdminRequest) => Promise<AdminResponse>
}

function defaultSendRequest(host: string, port: number, req: AdminRequest): Promise<AdminResponse> {
	return new Promise((resolve, reject) => {
		const socket = createConnection({ host, port })
		socket.setTimeout(5000)
		let buf = ''

		socket.on('connect', () => {
			socket.write(`${JSON.stringify(req)}\n`)
		})
		socket.on('data', (chunk: Buffer) => {
			buf += chunk.toString('utf8')
		})
		socket.on('end', () => {
			try {
				resolve(JSON.parse(buf) as AdminResponse)
			} catch {
				reject(new AdminError('Invalid JSON in admin response'))
			}
		})
		socket.on('error', (err: Error) => {
			reject(new AdminError(`Admin socket error: ${err.message}`))
		})
		socket.on('timeout', () => {
			socket.destroy()
			reject(new AdminError('Admin socket timed out'))
		})
	})
}

export class AdminClient {
	private readonly host: string
	private readonly port: number
	private readonly send: (host: string, port: number, req: AdminRequest) => Promise<AdminResponse>

	constructor(config: YgglConfig, deps: AdminClientDeps = {}) {
		this.host = config.adminSocket.host
		this.port = config.adminSocket.port
		this.send = deps.sendRequest ?? defaultSendRequest
	}

	private async call(request: string): Promise<unknown> {
		const resp = await this.send(this.host, this.port, { request, keepalive: false })
		if (resp.status !== 'success') {
			throw new AdminError(resp.error ?? `Admin request "${request}" failed`)
		}
		return resp.response
	}

	async getSelf(): Promise<SelfInfo> {
		const r = (await this.call('getSelf')) as Record<string, unknown>
		return {
			address: typeof r.address === 'string' ? r.address : '',
			publicKey: typeof r.key === 'string' ? r.key : '',
			buildName: typeof r.build_name === 'string' ? r.build_name : '',
			buildVersion: typeof r.build_version === 'string' ? r.build_version : '',
		}
	}

	async getPeers(): Promise<PeerInfo[]> {
		const r = (await this.call('getPeers')) as Record<string, unknown>
		const peers = Array.isArray(r.peers) ? (r.peers as Record<string, unknown>[]) : []
		return peers.map((p) => ({
			address: typeof p.address === 'string' ? p.address : '',
			publicKey: typeof p.key === 'string' ? p.key : '',
			remote: typeof p.remote === 'string' ? p.remote : '',
			uptime: typeof p.uptime === 'number' ? p.uptime : 0,
			rxBytes: typeof p.rx_bytes === 'number' ? p.rx_bytes : 0,
			txBytes: typeof p.tx_bytes === 'number' ? p.tx_bytes : 0,
			latency: typeof p.latency === 'number' ? p.latency : 0,
		}))
	}

	async getSessions(): Promise<SessionInfo[]> {
		const r = (await this.call('getSessions')) as Record<string, unknown>
		const sessions = Array.isArray(r.sessions) ? (r.sessions as Record<string, unknown>[]) : []
		return sessions.map((s) => ({
			address: typeof s.address === 'string' ? s.address : '',
			publicKey: typeof s.key === 'string' ? s.key : '',
			uptime: typeof s.uptime === 'number' ? s.uptime : 0,
			rxBytes: typeof s.rx_bytes === 'number' ? s.rx_bytes : 0,
			txBytes: typeof s.tx_bytes === 'number' ? s.tx_bytes : 0,
		}))
	}

	async waitForReady(timeoutMs = 10000): Promise<void> {
		const deadline = Date.now() + timeoutMs
		let lastError: Error | null = null

		while (Date.now() < deadline) {
			try {
				await this.getSelf()
				return
			} catch (err) {
				lastError = err as Error
				await new Promise((r) => setTimeout(r, 200))
			}
		}

		throw new AdminError(
			`Admin API not ready within ${timeoutMs}ms: ${lastError?.message ?? 'unknown error'}`,
		)
	}
}
