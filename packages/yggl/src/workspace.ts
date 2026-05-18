import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir as osHomedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import type { YgglConfig } from './config.js'
import { CONFIG_FILENAME } from './config.js'
import type { DaemonManagerDeps, InitYggstackConfDeps } from './daemon.js'
import { detectDaemon, initYggstackConf } from './daemon.js'

export type IdentityMode = 'global' | 'project'
export type LocalProjectValueKey = 'auth-token' | 'identity-mode'

export interface LocalProjectSettings {
	authToken?: string
	identityMode?: IdentityMode
}

export interface WorkspacePathDeps {
	env?: NodeJS.ProcessEnv
	platform?: NodeJS.Platform
	homedir?: string
}

export interface StorageRoots {
	configRoot: string
	stateRoot: string
}

export interface ProjectPaths extends StorageRoots {
	configPath: string
	projectDir: string
	projectId: string
	localSettingsPath: string
	globalIdentityPath: string
	projectIdentityPath: string
	runtimeDir: string
	runtimeConfPath: string
	pidPath: string
	legacyDir: string
	legacyConfPath: string
	legacyPidPath: string
}

export interface RuntimeProject extends ProjectPaths {
	confPath: string
	identityMode: IdentityMode
	localSettings: LocalProjectSettings
	detection: Awaited<ReturnType<typeof detectDaemon>>
}

export interface RuntimeProjectDeps
	extends WorkspacePathDeps,
		Pick<
			DaemonManagerDeps,
			'probeAdminSocket' | 'findBundled' | 'findInPath' | 'fileExists' | 'isExecutable'
		>,
		InitYggstackConfDeps {}

function getHomeDir(deps: WorkspacePathDeps): string {
	return deps.homedir ?? osHomedir()
}

function getPlatform(deps: WorkspacePathDeps): NodeJS.Platform {
	return deps.platform ?? process.platform
}

function normalizeProjectDir(projectDir: string, platform: NodeJS.Platform): string {
	const resolved = resolve(projectDir).replace(/\\/g, '/')
	return platform === 'win32' ? resolved.toLowerCase() : resolved
}

function sanitizeSegment(value: string): string {
	const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
	return sanitized || 'project'
}

function ensureParentDir(path: string): void {
	mkdirSync(dirname(path), { recursive: true })
}

function parseIdentityMode(raw: unknown): IdentityMode | undefined {
	return raw === 'global' || raw === 'project' ? raw : undefined
}

export function resolveStorageRoots(deps: WorkspacePathDeps = {}): StorageRoots {
	const env = deps.env ?? process.env
	const platform = getPlatform(deps)
	const home = getHomeDir(deps)

	if (platform === 'win32') {
		const localAppData = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
		const root = join(localAppData, 'yggl')
		return { configRoot: root, stateRoot: root }
	}

	if (platform === 'darwin') {
		if (env.XDG_CONFIG_HOME || env.XDG_STATE_HOME) {
			return {
				configRoot: join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'yggl'),
				stateRoot: join(env.XDG_STATE_HOME ?? join(home, '.local', 'state'), 'yggl'),
			}
		}
		const root = join(home, 'Library', 'Application Support', 'yggl')
		return { configRoot: root, stateRoot: root }
	}

	return {
		configRoot: join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'yggl'),
		stateRoot: join(env.XDG_STATE_HOME ?? join(home, '.local', 'state'), 'yggl'),
	}
}

export function resolveProjectPaths(
	configPath = CONFIG_FILENAME,
	deps: WorkspacePathDeps = {},
): ProjectPaths {
	const roots = resolveStorageRoots(deps)
	const platform = getPlatform(deps)
	const absoluteConfigPath = resolve(configPath)
	const projectDir = dirname(absoluteConfigPath)
	const normalizedProjectDir = normalizeProjectDir(projectDir, platform)
	const hash = createHash('sha256').update(normalizedProjectDir).digest('hex').slice(0, 12)
	const projectId = `${sanitizeSegment(basename(projectDir))}-${hash}`
	const projectConfigRoot = join(roots.configRoot, 'projects', projectId)
	const projectStateRoot = join(roots.stateRoot, 'projects', projectId)

	return {
		...roots,
		configPath: absoluteConfigPath,
		projectDir,
		projectId,
		localSettingsPath: join(projectConfigRoot, 'local.json'),
		globalIdentityPath: join(roots.stateRoot, 'identity', 'default', 'yggstack.conf'),
		projectIdentityPath: join(projectStateRoot, 'identity', 'yggstack.conf'),
		runtimeDir: join(projectStateRoot, 'runtime'),
		runtimeConfPath: join(projectStateRoot, 'runtime', 'yggstack.runtime.conf'),
		pidPath: join(projectStateRoot, 'runtime', 'yggl.pid'),
		legacyDir: join(projectDir, '.yggl'),
		legacyConfPath: join(projectDir, '.yggl', 'yggstack.conf'),
		legacyPidPath: join(projectDir, '.yggl', 'yggl.pid'),
	}
}

export function readLocalProjectSettings(paths: ProjectPaths): LocalProjectSettings {
	if (!existsSync(paths.localSettingsPath)) return {}

	try {
		const raw = JSON.parse(readFileSync(paths.localSettingsPath, 'utf8')) as Record<string, unknown>
		const settings: LocalProjectSettings = {}
		if (typeof raw.authToken === 'string' && raw.authToken.length > 0) {
			settings.authToken = raw.authToken
		}
		const identityMode = parseIdentityMode(raw.identityMode)
		if (identityMode) settings.identityMode = identityMode
		return settings
	} catch {
		throw new Error(`Failed to parse local settings file: ${paths.localSettingsPath}`)
	}
}

export function writeLocalProjectSettings(
	paths: ProjectPaths,
	settings: LocalProjectSettings,
): void {
	const normalized: Record<string, string> = {}
	if (settings.authToken) normalized.authToken = settings.authToken
	if (settings.identityMode) normalized.identityMode = settings.identityMode

	ensureParentDir(paths.localSettingsPath)
	if (Object.keys(normalized).length === 0) {
		rmSync(paths.localSettingsPath, { force: true })
		return
	}

	writeFileSync(paths.localSettingsPath, JSON.stringify(normalized, null, '\t'), 'utf8')
}

export function setLocalProjectValue(
	paths: ProjectPaths,
	key: LocalProjectValueKey,
	value: string,
): void {
	const settings = readLocalProjectSettings(paths)

	if (key === 'auth-token') {
		if (!value) throw new Error('auth-token value cannot be empty')
		settings.authToken = value
	} else if (value === 'global' || value === 'project') {
		settings.identityMode = value
	} else {
		throw new Error('identity-mode must be one of: global, project')
	}

	writeLocalProjectSettings(paths, settings)
}

export function unsetLocalProjectValue(paths: ProjectPaths, key: LocalProjectValueKey): void {
	const settings = readLocalProjectSettings(paths)

	if (key === 'auth-token') delete settings.authToken
	else delete settings.identityMode

	writeLocalProjectSettings(paths, settings)
}

export function getLocalProjectValue(
	paths: ProjectPaths,
	key: LocalProjectValueKey,
): string | undefined {
	const settings = readLocalProjectSettings(paths)
	return key === 'auth-token' ? settings.authToken : settings.identityMode
}

export function listLocalProjectValues(
	paths: ProjectPaths,
): Array<{ key: LocalProjectValueKey; value: string }> {
	const settings = readLocalProjectSettings(paths)
	const values: Array<{ key: LocalProjectValueKey; value: string }> = []

	if (settings.authToken) values.push({ key: 'auth-token', value: settings.authToken })
	if (settings.identityMode) values.push({ key: 'identity-mode', value: settings.identityMode })

	return values
}

export function maskSecret(value: string): string {
	if (value.length <= 4) return '****'
	return `${value.slice(0, 2)}…${value.slice(-2)}`
}

function migrateLegacyIdentity(paths: ProjectPaths): void {
	if (!existsSync(paths.legacyConfPath) || existsSync(paths.projectIdentityPath)) return

	ensureParentDir(paths.projectIdentityPath)
	copyFileSync(paths.legacyConfPath, paths.projectIdentityPath)
	rmSync(paths.legacyConfPath, { force: true })
}

export async function prepareRuntimeProject(
	config: YgglConfig,
	configPath = CONFIG_FILENAME,
	deps: RuntimeProjectDeps = {},
): Promise<RuntimeProject> {
	const paths = resolveProjectPaths(configPath, deps)
	const localSettings = readLocalProjectSettings(paths)
	let identityMode: IdentityMode = localSettings.identityMode ?? 'global'

	if (existsSync(paths.legacyConfPath) && !localSettings.identityMode) {
		migrateLegacyIdentity(paths)
		identityMode = 'project'
		writeLocalProjectSettings(paths, { ...localSettings, identityMode })
	}

	const confPath = identityMode === 'project' ? paths.projectIdentityPath : paths.globalIdentityPath
	const detection = await detectDaemon(config, deps)

	if (!detection.adopted && !existsSync(confPath)) {
		initYggstackConf(detection.binaryPath, {
			...(deps.runGenconf ? { runGenconf: deps.runGenconf } : {}),
			confPath,
		})
	}

	mkdirSync(paths.runtimeDir, { recursive: true })

	return {
		...paths,
		confPath,
		identityMode,
		localSettings:
			identityMode === localSettings.identityMode
				? localSettings
				: { ...localSettings, identityMode },
		detection,
	}
}
