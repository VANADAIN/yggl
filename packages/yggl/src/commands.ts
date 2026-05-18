import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { AdminClient } from './admin.js'
import type { YgglConfig } from './config.js'
import { CONFIG_FILENAME, DEFAULT_PEERS, loadConfig, writeDefaultConfig } from './config.js'
import { ConnectManager, parseConnectTarget } from './connect.js'
import { DaemonManager, detectDaemon, initYggstackConf, YGGL_DIR } from './daemon.js'
import { ShareManager } from './share.js'
import { c, formatBytes, formatUptime, Spinner } from './ui.js'

const PID_FILE = join(YGGL_DIR, 'yggl.pid')

function writePid(): void {
	mkdirSync(YGGL_DIR, { recursive: true })
	writeFileSync(PID_FILE, String(process.pid), 'utf8')
}

function removePid(): void {
	try {
		rmSync(PID_FILE)
	} catch {}
}

function keepAlive(): Promise<never> {
	return new Promise<never>(() => {})
}

// ── init ─────────────────────────────────────────────────────────────────────

export async function runInit(configPath = CONFIG_FILENAME): Promise<void> {
	const spinner = new Spinner()
	try {
		spinner.start('Initializing yggl...')
		writeDefaultConfig(configPath)
		const config = loadConfig(configPath)
		const detection = await detectDaemon(config)
		if (detection.adopted) {
			spinner.stop()
			throw new Error('A daemon is already running — stop it before running init')
		}
		initYggstackConf(detection.binaryPath)
		spinner.stop()
		console.log(c.green(`✓ Config:  ${resolve(configPath)}`))
		console.log(c.green(`✓ Keys:    ${resolve(join(YGGL_DIR, 'yggstack.conf'))}`))
		console.log(c.dim('\nRun `yggl start` to connect to the Yggdrasil network.'))
	} catch (err) {
		spinner.stop()
		throw err
	}
}

// ── start ─────────────────────────────────────────────────────────────────────

export async function runStart(configPath = CONFIG_FILENAME): Promise<never> {
	const config = loadConfig(configPath)
	const daemon = new DaemonManager()
	const spinner = new Spinner()

	const cleanup = async () => {
		spinner.stop()
		removePid()
		if (daemon.source && daemon.source !== 'adopted') await daemon.stop()
	}

	process.once('SIGINT', () => cleanup().finally(() => process.exit(0)))
	process.once('SIGTERM', () => cleanup().finally(() => process.exit(0)))

	try {
		spinner.start('Starting Yggdrasil daemon...')
		const source = await daemon.start(config)
		spinner.stop()
		writePid()

		const client = new AdminClient(config)
		const self = await client.getSelf()

		console.log(c.bold('\nYggdrasil is running\n'))
		console.log(`  ${c.dim('Address:')} ${c.cyan(self.address)}`)
		console.log(`  ${c.dim('Source: ')} ${source}`)
		if (self.buildName) console.log(`  ${c.dim('Build:  ')} ${self.buildName} ${self.buildVersion}`)
		console.log(c.dim('\nPress Ctrl+C to stop\n'))
	} catch (err) {
		spinner.stop()
		removePid()
		throw err
	}

	return keepAlive()
}

// ── share ─────────────────────────────────────────────────────────────────────

export interface ShareCommandOptions {
	port: number
	auth: boolean
	token?: string
	allow?: string
	config?: string
}

export async function runShare(opts: ShareCommandOptions): Promise<never> {
	const config = loadConfig(opts.config)
	const mgr = new ShareManager()
	const spinner = new Spinner()

	const allowKeys = opts.allow
		? opts.allow
				.split(',')
				.map((k) => k.trim())
				.filter(Boolean)
		: []

	const cleanup = async () => {
		spinner.stop()
		removePid()
		await mgr.stop()
	}

	process.once('SIGINT', () => cleanup().finally(() => process.exit(0)))
	process.once('SIGTERM', () => cleanup().finally(() => process.exit(0)))

	try {
		spinner.start(`Sharing port ${opts.port}...`)
		const result = await mgr.start(config, {
			port: opts.port,
			auth: opts.auth,
			...(opts.token ? { token: opts.token } : {}),
			allowKeys,
		})
		spinner.stop()
		writePid()

		console.log(c.bold(`\nSharing port ${opts.port} over Yggdrasil\n`))
		console.log(`  ${c.dim('URL:  ')} ${c.cyan(result.url)}`)
		if (result.token) {
			console.log(`  ${c.dim('Token:')} ${c.yellow(result.token)}`)
			console.log(c.dim('        Set Authorization: Bearer <token> on requests'))
		}
		if (allowKeys.length > 0) {
			console.log(`  ${c.dim('Allow:')} ${allowKeys.join(', ')}`)
		}
		console.log(c.dim('\nPress Ctrl+C to stop\n'))
	} catch (err) {
		spinner.stop()
		removePid()
		throw err
	}

	return keepAlive()
}

// ── connect ───────────────────────────────────────────────────────────────────

export interface ConnectCommandOptions {
	target: string
	localPort?: number
	config?: string
}

export async function runConnect(opts: ConnectCommandOptions): Promise<never> {
	const { address, port: remotePort } = parseConnectTarget(opts.target)
	const localPort = opts.localPort ?? remotePort
	const config = loadConfig(opts.config)
	const mgr = new ConnectManager()
	const spinner = new Spinner()

	const cleanup = async () => {
		spinner.stop()
		await mgr.stop()
	}

	process.once('SIGINT', () => cleanup().finally(() => process.exit(0)))
	process.once('SIGTERM', () => cleanup().finally(() => process.exit(0)))

	try {
		spinner.start(`Connecting to [${address}]:${remotePort}...`)
		const result = await mgr.start(config, { remoteAddress: address, remotePort, localPort })
		spinner.stop()

		console.log(c.bold('\nPort forwarding active\n'))
		console.log(`  ${c.dim('Local: ')} ${c.cyan(`localhost:${result.localPort}`)}`)
		console.log(`  ${c.dim('Remote:')} [${address}]:${remotePort}`)
		console.log(c.dim('\nPress Ctrl+C to stop\n'))
	} catch (err) {
		spinner.stop()
		throw err
	}

	return keepAlive()
}

// ── status ───────────────────────────────────────────────────────────────────

export async function runStatus(
	configPath = CONFIG_FILENAME,
	clientFactory?: (config: YgglConfig) => Pick<AdminClient, 'getSelf' | 'getPeers' | 'getSessions'>,
): Promise<void> {
	const config = loadConfig(configPath)
	const client = clientFactory ? clientFactory(config) : new AdminClient(config)

	let self: Awaited<ReturnType<AdminClient['getSelf']>>
	try {
		self = await client.getSelf()
	} catch {
		console.log(c.red('✗ Yggdrasil is not running'))
		console.log(c.dim('  Run `yggl start` to connect'))
		process.exitCode = 1
		return
	}

	console.log(`${c.green('●')} ${c.bold('Yggdrasil is running')}\n`)
	console.log(`  ${c.dim('Address:')} ${c.cyan(self.address)}`)
	if (self.publicKey) console.log(`  ${c.dim('Key:    ')} ${self.publicKey}`)
	if (self.buildName) console.log(`  ${c.dim('Build:  ')} ${self.buildName} ${self.buildVersion}`)

	const [peers, sessions] = await Promise.all([client.getPeers(), client.getSessions()])

	if (peers.length > 0) {
		console.log(`\n  ${c.bold(`Peers (${peers.length})`)}`)
		for (const p of peers) {
			const uptime = formatUptime(p.uptime)
			const rx = formatBytes(p.rxBytes)
			const tx = formatBytes(p.txBytes)
			console.log(
				`    ${c.cyan(p.address.padEnd(22))} ${c.dim(p.remote.padEnd(30))} ` +
					`${c.dim('up')} ${uptime.padEnd(5)} ${c.dim('↓')}${rx} ${c.dim('↑')}${tx}`,
			)
		}
	} else {
		console.log(`\n  ${c.dim('No peers connected')}`)
	}

	if (sessions.length > 0) {
		console.log(`\n  ${c.bold(`Sessions (${sessions.length})`)}`)
		for (const s of sessions) {
			const uptime = formatUptime(s.uptime)
			const rx = formatBytes(s.rxBytes)
			const tx = formatBytes(s.txBytes)
			console.log(
				`    ${c.cyan(s.address.padEnd(22))} ${c.dim('up')} ${uptime.padEnd(5)} ${c.dim('↓')}${rx} ${c.dim('↑')}${tx}`,
			)
		}
	}

	console.log()
}

// ── peers ────────────────────────────────────────────────────────────────────

function readRawConfig(configPath: string): Record<string, unknown> {
	if (!existsSync(configPath)) return {}
	try {
		return JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
	} catch {
		throw new Error(`Failed to parse config file: ${configPath}`)
	}
}

function writeRawConfig(configPath: string, raw: Record<string, unknown>): void {
	writeFileSync(configPath, JSON.stringify(raw, null, '\t'), 'utf8')
}

export async function runPeersAdd(configPath = CONFIG_FILENAME, uri: string): Promise<void> {
	const raw = readRawConfig(configPath)
	const peers: string[] = Array.isArray(raw.peers) ? (raw.peers as string[]) : [...DEFAULT_PEERS]

	if (peers.includes(uri)) {
		console.log(c.yellow(`⚠  Peer already in list: ${uri}`))
		return
	}
	peers.push(uri)
	raw.peers = peers
	writeRawConfig(configPath, raw)
	console.log(c.green(`✓ Added peer: ${uri}`))
}

export async function runPeersRemove(configPath = CONFIG_FILENAME, uri: string): Promise<void> {
	const raw = readRawConfig(configPath)
	const peers: string[] = Array.isArray(raw.peers) ? (raw.peers as string[]) : [...DEFAULT_PEERS]
	const filtered = peers.filter((p) => p !== uri)

	if (filtered.length === peers.length) {
		console.log(c.yellow(`⚠  Peer not found: ${uri}`))
		return
	}
	raw.peers = filtered
	writeRawConfig(configPath, raw)
	console.log(c.green(`✓ Removed peer: ${uri}`))
}

export async function runPeersList(configPath = CONFIG_FILENAME): Promise<void> {
	const config = loadConfig(configPath)
	console.log(c.bold(`Peers (${config.peers.length}):`))
	for (const peer of config.peers) {
		console.log(`  ${c.dim('•')} ${peer}`)
	}
}

// ── stop ─────────────────────────────────────────────────────────────────────

export async function runStop(): Promise<void> {
	if (!existsSync(PID_FILE)) {
		console.log(c.yellow('⚠  No yggl PID file found — is yggl running?'))
		console.log(c.dim('   If yggl is running in a terminal, press Ctrl+C to stop it.'))
		return
	}

	const pid = Number.parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10)
	if (Number.isNaN(pid)) {
		rmSync(PID_FILE)
		throw new Error('PID file is corrupted — removed it')
	}

	try {
		process.kill(pid, 0) // check if alive
	} catch {
		rmSync(PID_FILE)
		console.log(c.yellow(`⚠  Process ${pid} is not running (removed stale PID file)`))
		return
	}

	process.kill(pid, 'SIGTERM')
	rmSync(PID_FILE)
	console.log(c.green(`✓ Sent stop signal to yggl process ${pid}`))
}
