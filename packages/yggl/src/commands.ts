import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { AdminClient } from './admin.js'
import type { YgglConfig } from './config.js'
import { CONFIG_FILENAME, DEFAULT_PEERS, loadConfig, writeDefaultConfig } from './config.js'
import { ConnectManager, parseConnectTarget } from './connect.js'
import { DaemonManager } from './daemon.js'
import { ShareManager } from './share.js'
import { c, formatBytes, formatUptime, Spinner } from './ui.js'
import {
	getLocalProjectValue,
	type IdentityMode,
	type LocalProjectValueKey,
	listLocalProjectValues,
	maskSecret,
	prepareRuntimeProject,
	readLocalProjectSettings,
	resolveProjectPaths,
	setLocalProjectValue,
	unsetLocalProjectValue,
} from './workspace.js'

function writePid(pidPath: string): void {
	mkdirSync(dirname(pidPath), { recursive: true })
	writeFileSync(pidPath, String(process.pid), 'utf8')
}

function removePid(pidPath: string): void {
	try {
		rmSync(pidPath)
	} catch {}
}

function keepAlive(): Promise<never> {
	return new Promise<never>(() => {})
}

function parseAllowKeys(allow?: string): string[] {
	return allow
		? allow
				.split(',')
				.map((key) => key.trim())
				.filter(Boolean)
		: []
}

function stopSpinner(spinner: Spinner): void {
	spinner.stop()
}

function registerSignalCleanup(cleanup: () => Promise<void>): () => void {
	const exitWithCleanup = () => cleanup().finally(() => process.exit(0))
	process.once('SIGINT', exitWithCleanup)
	process.once('SIGTERM', exitWithCleanup)
	return () => {
		process.off('SIGINT', exitWithCleanup)
		process.off('SIGTERM', exitWithCleanup)
	}
}

async function withSpinner<T>(message: string, run: (spinner: Spinner) => Promise<T>): Promise<T> {
	const spinner = new Spinner()
	try {
		spinner.start(message)
		return await run(spinner)
	} catch (err) {
		stopSpinner(spinner)
		throw err
	}
}

async function runPersistentCommand(
	message: string,
	cleanup: () => Promise<void>,
	run: () => Promise<void>,
): Promise<never> {
	return withSpinner(message, async (spinner) => {
		const unregister = registerSignalCleanup(async () => {
			stopSpinner(spinner)
			await cleanup()
		})

		try {
			await run()
			stopSpinner(spinner)
		} catch (err) {
			unregister()
			stopSpinner(spinner)
			await cleanup()
			throw err
		}

		return keepAlive()
	})
}

function resolveAuthToken(localToken?: string): string | undefined {
	return process.env.YGGL_AUTH_TOKEN || localToken
}

function normalizeIdentityMode(value?: string): IdentityMode {
	if (value === 'global' || value === 'project') return value
	throw new Error('identity-mode must be one of: global, project')
}

function normalizeLocalKey(key: string): LocalProjectValueKey {
	if (key === 'auth-token' || key === 'identity-mode') return key
	throw new Error('Unsupported local key. Supported keys: auth-token, identity-mode')
}

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

async function resolveRuntimeProject(configPath: string | undefined, config: YgglConfig) {
	return prepareRuntimeProject(config, configPath ?? CONFIG_FILENAME)
}

// ── init ─────────────────────────────────────────────────────────────────────

export async function runInit(configPath = CONFIG_FILENAME): Promise<void> {
	await withSpinner('Initializing yggl...', async (spinner) => {
		writeDefaultConfig(configPath)
		const paths = resolveProjectPaths(configPath)
		stopSpinner(spinner)
		console.log(c.green(`✓ Config:         ${resolve(configPath)}`))
		console.log(c.green(`✓ Local settings: ${paths.localSettingsPath}`))
		console.log(c.green(`✓ Runtime state:  ${paths.runtimeDir}`))
		console.log(c.dim('\nIdentity will be created automatically on first start/share/connect.'))
	})
}

// ── start ─────────────────────────────────────────────────────────────────────

export async function runStart(configPath = CONFIG_FILENAME): Promise<never> {
	const config = loadConfig(configPath)
	const runtime = await resolveRuntimeProject(configPath, config)
	const daemon = new DaemonManager()

	const cleanup = async () => {
		removePid(runtime.pidPath)
		if (daemon.source && daemon.source !== 'adopted') await daemon.stop()
	}

	return runPersistentCommand('Starting Yggdrasil daemon...', cleanup, async () => {
		const source = await daemon.start(config, {
			confPath: runtime.confPath,
			runtimeConfPath: runtime.runtimeConfPath,
		})
		writePid(runtime.pidPath)

		const client = new AdminClient(config)
		const self = await client.getSelf()

		console.log(c.bold('\nYggdrasil is running\n'))
		console.log(`  ${c.dim('Address:')} ${c.cyan(self.address)}`)
		console.log(`  ${c.dim('Source: ')} ${source}`)
		console.log(`  ${c.dim('Identity:')} ${runtime.identityMode}`)
		if (self.buildName) console.log(`  ${c.dim('Build:  ')} ${self.buildName} ${self.buildVersion}`)
		console.log(c.dim('\nPress Ctrl+C to stop\n'))
	})
}

// ── share ─────────────────────────────────────────────────────────────────────

export interface ShareCommandOptions {
	port: number
	auth?: boolean
	token?: string
	allow?: string
	config?: string
}

export async function runShare(opts: ShareCommandOptions): Promise<never> {
	const config = loadConfig(opts.config)
	const runtime = await resolveRuntimeProject(opts.config, config)
	const mgr = new ShareManager()
	const allowKeys = parseAllowKeys(opts.allow)
	const authEnabled = opts.auth ?? config.auth.enabled
	const token = opts.token ?? resolveAuthToken(runtime.localSettings.authToken)

	const cleanup = async () => {
		removePid(runtime.pidPath)
		await mgr.stop()
	}

	return runPersistentCommand(`Sharing port ${opts.port}...`, cleanup, async () => {
		const result = await mgr.start(
			config,
			{
				port: opts.port,
				auth: authEnabled,
				...(authEnabled && token ? { token } : {}),
				allowKeys,
			},
			{
				confPath: runtime.confPath,
				runtimeConfPath: runtime.runtimeConfPath,
			},
		)
		writePid(runtime.pidPath)

		console.log(c.bold(`\nSharing port ${opts.port} over Yggdrasil\n`))
		console.log(`  ${c.dim('URL:     ')} ${c.cyan(result.url)}`)
		console.log(`  ${c.dim('Identity:')} ${runtime.identityMode}`)
		if (result.token) {
			console.log(`  ${c.dim('Token:   ')} ${c.yellow(result.token)}`)
			console.log(c.dim('           Set Authorization: Bearer <token> on requests'))
		}
		if (allowKeys.length > 0) {
			console.log(`  ${c.dim('Allow:   ')} ${allowKeys.join(', ')}`)
		}
		console.log(c.dim('\nPress Ctrl+C to stop\n'))
	})
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
	const runtime = await resolveRuntimeProject(opts.config, config)
	const mgr = new ConnectManager()

	return runPersistentCommand(
		`Connecting to [${address}]:${remotePort}...`,
		() => mgr.stop(),
		async () => {
			const result = await mgr.start(
				config,
				{ remoteAddress: address, remotePort, localPort },
				{
					confPath: runtime.confPath,
					runtimeConfPath: runtime.runtimeConfPath,
				},
			)

			console.log(c.bold('\nPort forwarding active\n'))
			console.log(`  ${c.dim('Local:   ')} ${c.cyan(`localhost:${result.localPort}`)}`)
			console.log(`  ${c.dim('Remote:  ')} [${address}]:${remotePort}`)
			console.log(`  ${c.dim('Identity:')} ${runtime.identityMode}`)
			console.log(c.dim('\nPress Ctrl+C to stop\n'))
		},
	)
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

// ── local ────────────────────────────────────────────────────────────────────

export async function runLocalSet(
	key: string,
	value: string,
	configPath = CONFIG_FILENAME,
): Promise<void> {
	const paths = resolveProjectPaths(configPath)
	const normalizedKey = normalizeLocalKey(key)
	const normalizedValue = normalizedKey === 'identity-mode' ? normalizeIdentityMode(value) : value

	setLocalProjectValue(paths, normalizedKey, normalizedValue)
	console.log(c.green(`✓ Set local ${normalizedKey} for ${paths.projectId}`))
}

export async function runLocalGet(
	key: string,
	configPath = CONFIG_FILENAME,
	showSecret = false,
): Promise<void> {
	const paths = resolveProjectPaths(configPath)
	const normalizedKey = normalizeLocalKey(key)
	const value = getLocalProjectValue(paths, normalizedKey)

	if (!value) {
		console.log(c.yellow(`⚠  No local value set for ${normalizedKey}`))
		return
	}

	if (normalizedKey === 'auth-token' && !showSecret) {
		console.log(maskSecret(value))
		return
	}

	console.log(value)
}

export async function runLocalUnset(key: string, configPath = CONFIG_FILENAME): Promise<void> {
	const paths = resolveProjectPaths(configPath)
	const normalizedKey = normalizeLocalKey(key)
	unsetLocalProjectValue(paths, normalizedKey)
	console.log(c.green(`✓ Removed local ${normalizedKey} for ${paths.projectId}`))
}

export async function runLocalList(configPath = CONFIG_FILENAME): Promise<void> {
	const paths = resolveProjectPaths(configPath)
	const values = listLocalProjectValues(paths)

	if (values.length === 0) {
		console.log(c.dim('No local values set for this project'))
		return
	}

	for (const entry of values) {
		const renderedValue = entry.key === 'auth-token' ? maskSecret(entry.value) : entry.value
		console.log(`${entry.key}: ${renderedValue}`)
	}
}

// ── doctor ───────────────────────────────────────────────────────────────────

export async function runDoctor(configPath = CONFIG_FILENAME): Promise<void> {
	const paths = resolveProjectPaths(configPath)
	const localSettings = readLocalProjectSettings(paths)
	const configExists = existsSync(paths.configPath)
	const legacyDetected = existsSync(paths.legacyConfPath) || existsSync(paths.legacyPidPath)
	const identityMode: IdentityMode =
		localSettings.identityMode ?? (existsSync(paths.projectIdentityPath) ? 'project' : 'global')
	const activeIdentityPath =
		identityMode === 'project' ? paths.projectIdentityPath : paths.globalIdentityPath
	const envToken = process.env.YGGL_AUTH_TOKEN
	const tokenSource = envToken ? 'shell env' : localSettings.authToken ? 'local store' : 'none'

	console.log(c.bold('\nyggl doctor\n'))
	console.log(`  ${c.dim('Project config: ')} ${paths.configPath}`)
	console.log(`  ${c.dim('Config exists:  ')} ${configExists ? c.green('yes') : c.yellow('no')}`)
	console.log(`  ${c.dim('Project id:    ')} ${paths.projectId}`)
	console.log(`  ${c.dim('Local settings:')} ${paths.localSettingsPath}`)
	console.log(`  ${c.dim('Runtime dir:    ')} ${paths.runtimeDir}`)
	console.log(`  ${c.dim('Identity mode:  ')} ${identityMode}`)
	console.log(`  ${c.dim('Identity path:  ')} ${activeIdentityPath}`)
	console.log(
		`  ${c.dim('Legacy .yggl:   ')} ${legacyDetected ? c.yellow('detected') : c.green('none')}`,
	)
	console.log(`  ${c.dim('Auth token:     ')} ${tokenSource}`)

	if (envToken) {
		console.log(`  ${c.dim('Token value:    ')} ${maskSecret(envToken)}`)
	} else if (localSettings.authToken) {
		console.log(`  ${c.dim('Token value:    ')} ${maskSecret(localSettings.authToken)}`)
	}

	console.log()
}

// ── stop ─────────────────────────────────────────────────────────────────────

export async function runStop(configPath = CONFIG_FILENAME): Promise<void> {
	const paths = resolveProjectPaths(configPath)
	const pidPath = existsSync(paths.pidPath)
		? paths.pidPath
		: existsSync(paths.legacyPidPath)
			? paths.legacyPidPath
			: null

	if (!pidPath) {
		console.log(c.yellow('⚠  No yggl PID file found — is yggl running?'))
		console.log(c.dim('   If yggl is running in a terminal, press Ctrl+C to stop it.'))
		return
	}

	const pid = Number.parseInt(readFileSync(pidPath, 'utf8').trim(), 10)
	if (Number.isNaN(pid)) {
		rmSync(pidPath)
		throw new Error('PID file is corrupted — removed it')
	}

	try {
		process.kill(pid, 0)
	} catch {
		rmSync(pidPath)
		console.log(c.yellow(`⚠  Process ${pid} is not running (removed stale PID file)`))
		return
	}

	process.kill(pid, 'SIGTERM')
	rmSync(pidPath)
	console.log(c.green(`✓ Sent stop signal to yggl process ${pid}`))
}
