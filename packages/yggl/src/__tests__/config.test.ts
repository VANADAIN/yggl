import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	ConfigError,
	DEFAULT_CONFIG,
	loadConfig,
	validateConfig,
	writeDefaultConfig,
} from '../config.js'

let tmpDir: string

beforeEach(() => {
	tmpDir = join(tmpdir(), `yggl-test-${Date.now()}`)
	mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true })
	// Clean up any env vars set during tests
	for (const key of [
		'YGGL_DAEMON',
		'YGGL_PEERS',
		'YGGL_AUTH_TOKEN',
		'YGGL_ADMIN_HOST',
		'YGGL_ADMIN_PORT',
	]) {
		delete process.env[key]
	}
})

describe('validateConfig', () => {
	it('returns defaults for empty object', () => {
		const config = validateConfig({})
		expect(config).toEqual(DEFAULT_CONFIG)
	})

	it('throws for non-object input', () => {
		expect(() => validateConfig(null)).toThrow(ConfigError)
		expect(() => validateConfig('string')).toThrow(ConfigError)
		expect(() => validateConfig(42)).toThrow(ConfigError)
	})

	it('accepts valid full config', () => {
		const raw = {
			daemon: 'bundled',
			peers: ['tls://example.com:443'],
			autoDiscover: false,
			auth: { enabled: true, token: 'secret' },
			adminSocket: { host: '127.0.0.1', port: 9002 },
		}
		const config = validateConfig(raw)
		expect(config.daemon).toBe('bundled')
		expect(config.peers).toEqual(['tls://example.com:443'])
		expect(config.autoDiscover).toBe(false)
		expect(config.auth.enabled).toBe(true)
		expect(config.auth.token).toBe('secret')
		expect(config.adminSocket.port).toBe(9002)
	})

	it('falls back to defaults for invalid field types', () => {
		const config = validateConfig({
			daemon: 42,
			peers: 'not-array',
			autoDiscover: 'yes',
			auth: 'invalid',
			adminSocket: null,
		})
		expect(config.daemon).toBe(DEFAULT_CONFIG.daemon)
		expect(config.peers).toEqual(DEFAULT_CONFIG.peers)
		expect(config.autoDiscover).toBe(DEFAULT_CONFIG.autoDiscover)
		expect(config.auth).toEqual(DEFAULT_CONFIG.auth)
		expect(config.adminSocket).toEqual(DEFAULT_CONFIG.adminSocket)
	})

	it('falls back to defaults for empty peers array', () => {
		const config = validateConfig({ peers: [] })
		expect(config.peers).toEqual(DEFAULT_CONFIG.peers)
	})

	it('ignores invalid adminSocket port', () => {
		const config = validateConfig({ adminSocket: { host: 'localhost', port: 99999 } })
		expect(config.adminSocket.port).toBe(DEFAULT_CONFIG.adminSocket.port)
	})
})

describe('loadConfig', () => {
	it('returns defaults when file does not exist', () => {
		const config = loadConfig(join(tmpDir, 'missing.json'))
		expect(config).toEqual(DEFAULT_CONFIG)
	})

	it('loads and parses a valid config file', () => {
		const path = join(tmpDir, 'yggl.config.json')
		writeFileSync(path, JSON.stringify({ daemon: 'system', autoDiscover: false }))
		const config = loadConfig(path)
		expect(config.daemon).toBe('system')
		expect(config.autoDiscover).toBe(false)
	})

	it('throws on malformed JSON', () => {
		const path = join(tmpDir, 'bad.json')
		writeFileSync(path, '{ invalid json }')
		expect(() => loadConfig(path)).toThrow(ConfigError)
	})

	it('applies YGGL_DAEMON env override', () => {
		process.env.YGGL_DAEMON = 'bundled'
		const config = loadConfig(join(tmpDir, 'missing.json'))
		expect(config.daemon).toBe('bundled')
	})

	it('applies YGGL_PEERS env override', () => {
		process.env.YGGL_PEERS = 'tls://a.com:443,tcp://b.com:80'
		const config = loadConfig(join(tmpDir, 'missing.json'))
		expect(config.peers).toEqual(['tls://a.com:443', 'tcp://b.com:80'])
	})

	it('applies YGGL_AUTH_TOKEN and enables auth', () => {
		process.env.YGGL_AUTH_TOKEN = 'mytoken'
		const config = loadConfig(join(tmpDir, 'missing.json'))
		expect(config.auth.token).toBe('mytoken')
		expect(config.auth.enabled).toBe(true)
	})

	it('applies YGGL_ADMIN_PORT env override', () => {
		process.env.YGGL_ADMIN_PORT = '9999'
		const config = loadConfig(join(tmpDir, 'missing.json'))
		expect(config.adminSocket.port).toBe(9999)
	})

	it('ignores non-numeric YGGL_ADMIN_PORT', () => {
		process.env.YGGL_ADMIN_PORT = 'abc'
		const config = loadConfig(join(tmpDir, 'missing.json'))
		expect(config.adminSocket.port).toBe(DEFAULT_CONFIG.adminSocket.port)
	})
})

describe('writeDefaultConfig', () => {
	it('writes a valid JSON config file', () => {
		const path = join(tmpDir, 'yggl.config.json')
		writeDefaultConfig(path)
		const config = loadConfig(path)
		expect(config).toEqual(DEFAULT_CONFIG)
	})

	it('throws if file already exists', () => {
		const path = join(tmpDir, 'yggl.config.json')
		writeFileSync(path, '{}')
		expect(() => writeDefaultConfig(path)).toThrow(ConfigError)
	})
})
