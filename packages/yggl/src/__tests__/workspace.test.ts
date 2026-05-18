import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../config.js'
import {
	prepareRuntimeProject,
	readLocalProjectSettings,
	resolveProjectPaths,
	resolveStorageRoots,
	setLocalProjectValue,
	unsetLocalProjectValue,
} from '../workspace.js'

let tmpDir: string

beforeEach(() => {
	tmpDir = join(tmpdir(), `yggl-workspace-${Date.now()}`)
	mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true })
})

describe('resolveStorageRoots', () => {
	it('uses XDG roots on linux', () => {
		const roots = resolveStorageRoots({
			platform: 'linux',
			homedir: '/home/tester',
			env: {
				XDG_CONFIG_HOME: '/tmp/xdg-config',
				XDG_STATE_HOME: '/tmp/xdg-state',
			},
		})

		expect(roots.configRoot).toBe('/tmp/xdg-config/yggl')
		expect(roots.stateRoot).toBe('/tmp/xdg-state/yggl')
	})

	it('uses Application Support on macOS', () => {
		const roots = resolveStorageRoots({
			platform: 'darwin',
			homedir: '/Users/tester',
			env: {},
		})

		expect(roots.configRoot).toBe('/Users/tester/Library/Application Support/yggl')
		expect(roots.stateRoot).toBe('/Users/tester/Library/Application Support/yggl')
	})

	it('uses LOCALAPPDATA on Windows', () => {
		const roots = resolveStorageRoots({
			platform: 'win32',
			homedir: 'C:\\Users\\tester',
			env: { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' },
		})

		expect(roots.configRoot).toBe('C:\\Users\\tester\\AppData\\Local/yggl')
		expect(roots.stateRoot).toBe('C:\\Users\\tester\\AppData\\Local/yggl')
	})
})

describe('local project settings', () => {
	it('stores and removes local values outside the project tree', () => {
		const configPath = join(tmpDir, 'repo', 'yggl.config.json')
		mkdirSync(join(tmpDir, 'repo'), { recursive: true })
		const paths = resolveProjectPaths(configPath, {
			platform: 'linux',
			homedir: tmpDir,
			env: {
				XDG_CONFIG_HOME: join(tmpDir, '.config'),
				XDG_STATE_HOME: join(tmpDir, '.state'),
			},
		})

		setLocalProjectValue(paths, 'auth-token', 'secret')
		setLocalProjectValue(paths, 'identity-mode', 'project')

		expect(paths.localSettingsPath.startsWith(join(tmpDir, '.config'))).toBe(true)
		expect(readLocalProjectSettings(paths)).toEqual({
			authToken: 'secret',
			identityMode: 'project',
		})

		unsetLocalProjectValue(paths, 'auth-token')
		expect(readLocalProjectSettings(paths)).toEqual({ identityMode: 'project' })
	})
})

describe('prepareRuntimeProject', () => {
	it('creates global identity outside the project by default', async () => {
		const configPath = join(tmpDir, 'repo', 'yggl.config.json')
		mkdirSync(join(tmpDir, 'repo'), { recursive: true })
		const runtime = await prepareRuntimeProject(DEFAULT_CONFIG, configPath, {
			platform: 'linux',
			homedir: tmpDir,
			env: {
				XDG_CONFIG_HOME: join(tmpDir, '.config'),
				XDG_STATE_HOME: join(tmpDir, '.state'),
			},
			probeAdminSocket: async () => false,
			findInPath: () => null,
			findBundled: () => '/fake/yggstack',
			runGenconf: () => Buffer.from('{"PrivateKey":"abc"}'),
		})

		expect(runtime.identityMode).toBe('global')
		expect(runtime.confPath).toBe(runtime.globalIdentityPath)
		expect(existsSync(runtime.globalIdentityPath)).toBe(true)
		expect(runtime.globalIdentityPath.includes('/repo/.yggl/')).toBe(false)
		expect(existsSync(runtime.runtimeDir)).toBe(true)
	})

	it('migrates legacy project identity and switches the project to project mode', async () => {
		const repoDir = join(tmpDir, 'repo')
		const configPath = join(repoDir, 'yggl.config.json')
		const legacyDir = join(repoDir, '.yggl')
		mkdirSync(legacyDir, { recursive: true })
		writeFileSync(join(legacyDir, 'yggstack.conf'), '{"PrivateKey":"legacy"}', 'utf8')

		const runtime = await prepareRuntimeProject(DEFAULT_CONFIG, configPath, {
			platform: 'linux',
			homedir: tmpDir,
			env: {
				XDG_CONFIG_HOME: join(tmpDir, '.config'),
				XDG_STATE_HOME: join(tmpDir, '.state'),
			},
			probeAdminSocket: async () => false,
			findInPath: () => null,
			findBundled: () => '/fake/yggstack',
			runGenconf: () => Buffer.from('{"PrivateKey":"new"}'),
		})

		expect(runtime.identityMode).toBe('project')
		expect(runtime.confPath).toBe(runtime.projectIdentityPath)
		expect(readFileSync(runtime.projectIdentityPath, 'utf8')).toContain('"legacy"')
		expect(existsSync(join(legacyDir, 'yggstack.conf'))).toBe(false)
		expect(readLocalProjectSettings(runtime).identityMode).toBe('project')
	})
})
