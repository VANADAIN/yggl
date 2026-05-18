import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DaemonMode } from './binary.js'

export interface AuthConfig {
	enabled: boolean
}

export interface AdminSocketConfig {
	host: string
	port: number
}

export interface YgglConfig {
	daemon: DaemonMode
	peers: string[]
	autoDiscover: boolean
	auth: AuthConfig
	adminSocket: AdminSocketConfig
}

export class ConfigError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'ConfigError'
	}
}

export const DEFAULT_PEERS: string[] = [
	// Europe
	'tls://ygg.mkg20001.io:443',
	'tls://ygg1.mk16.de:1338?key=0000000087ee9949eeab56bd430ee8f324cad55abf3993ed9b9be63ce693e18a',
	'tls://vpn.itrus.su:7992',
	'tls://51.15.204.214:54321',
	// Asia
	'tls://asia.deinfra.org:15015',
]

export const DEFAULT_CONFIG: YgglConfig = {
	daemon: 'auto',
	peers: DEFAULT_PEERS,
	autoDiscover: true,
	auth: { enabled: false },
	adminSocket: { host: 'localhost', port: 9001 },
}

export const CONFIG_FILENAME = 'yggl.config.json'

function validateAuth(raw: unknown): AuthConfig {
	if (typeof raw !== 'object' || raw === null) return DEFAULT_CONFIG.auth
	const r = raw as Record<string, unknown>
	return {
		enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_CONFIG.auth.enabled,
	}
}

function validateAdminSocket(raw: unknown): AdminSocketConfig {
	if (typeof raw !== 'object' || raw === null) return DEFAULT_CONFIG.adminSocket
	const r = raw as Record<string, unknown>
	return {
		host:
			typeof r.host === 'string' && r.host.length > 0 ? r.host : DEFAULT_CONFIG.adminSocket.host,
		port:
			typeof r.port === 'number' && r.port > 0 && r.port < 65536
				? r.port
				: DEFAULT_CONFIG.adminSocket.port,
	}
}

function validatePeers(raw: unknown): string[] {
	if (!Array.isArray(raw)) return DEFAULT_CONFIG.peers
	const peers = raw.filter((p): p is string => typeof p === 'string' && p.length > 0)
	return peers.length > 0 ? peers : DEFAULT_CONFIG.peers
}

export function validateConfig(raw: unknown): YgglConfig {
	if (typeof raw !== 'object' || raw === null) {
		throw new ConfigError('Config must be a JSON object')
	}
	const r = raw as Record<string, unknown>
	return {
		daemon: typeof r.daemon === 'string' ? (r.daemon as DaemonMode) : DEFAULT_CONFIG.daemon,
		peers: validatePeers(r.peers),
		autoDiscover:
			typeof r.autoDiscover === 'boolean' ? r.autoDiscover : DEFAULT_CONFIG.autoDiscover,
		auth: validateAuth(r.auth),
		adminSocket: validateAdminSocket(r.adminSocket),
	}
}

function applyEnvOverrides(config: YgglConfig): YgglConfig {
	const result = { ...config, auth: { ...config.auth }, adminSocket: { ...config.adminSocket } }

	if (process.env.YGGL_DAEMON) result.daemon = process.env.YGGL_DAEMON as DaemonMode
	if (process.env.YGGL_PEERS) result.peers = process.env.YGGL_PEERS.split(',').map((p) => p.trim())
	if (process.env.YGGL_ADMIN_HOST) result.adminSocket.host = process.env.YGGL_ADMIN_HOST
	if (process.env.YGGL_ADMIN_PORT) {
		const port = Number.parseInt(process.env.YGGL_ADMIN_PORT, 10)
		if (!Number.isNaN(port)) result.adminSocket.port = port
	}

	return result
}

export function loadConfig(configPath = CONFIG_FILENAME): YgglConfig {
	const absPath = resolve(configPath)
	let raw: unknown = {}

	if (existsSync(absPath)) {
		try {
			raw = JSON.parse(readFileSync(absPath, 'utf8'))
		} catch {
			throw new ConfigError(`Failed to parse config file: ${absPath}`)
		}
	}

	return applyEnvOverrides(validateConfig(raw))
}

export function writeDefaultConfig(configPath = CONFIG_FILENAME): void {
	const absPath = resolve(configPath)
	if (existsSync(absPath)) {
		throw new ConfigError(`Config file already exists: ${absPath}`)
	}
	writeFileSync(absPath, JSON.stringify(DEFAULT_CONFIG, null, '\t'), 'utf8')
}
