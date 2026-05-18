import type { Server } from 'node:http'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../config.js'
import { createTokenProxy, generateToken, ShareError, ShareManager } from '../share.js'

const TOKEN = 'test-token-xyz'

// ── generateToken ────────────────────────────────────────────────────────────

describe('generateToken', () => {
	it('returns a non-empty string', () => {
		expect(typeof generateToken()).toBe('string')
		expect(generateToken().length).toBeGreaterThan(0)
	})

	it('generates unique tokens', () => {
		const tokens = new Set(Array.from({ length: 20 }, generateToken))
		expect(tokens.size).toBe(20)
	})

	it('returns base64url characters only', () => {
		for (let i = 0; i < 10; i++) {
			expect(generateToken()).toMatch(/^[A-Za-z0-9_-]+$/)
		}
	})
})

// ── createTokenProxy ─────────────────────────────────────────────────────────

describe('createTokenProxy', () => {
	let target: Server
	let proxy: Server
	let proxyPort: number
	let lastRequestHeaders: Record<string, string | string[] | undefined>

	beforeEach(async () => {
		lastRequestHeaders = {}
		target = createServer((req, res) => {
			lastRequestHeaders = req.headers as Record<string, string | string[] | undefined>
			res.setHeader('X-From-Target', 'yes')
			res.end('target body')
		})
		await new Promise<void>((r) => target.listen(0, '127.0.0.1', r))
		const targetPort = (target.address() as AddressInfo).port

		proxy = createTokenProxy(targetPort, TOKEN)
		await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r))
		proxyPort = (proxy.address() as AddressInfo).port
	})

	afterEach(async () => {
		await new Promise<void>((r) => proxy.close(() => r()))
		await new Promise<void>((r) => target.close(() => r()))
	})

	it('returns 401 with no Authorization header', async () => {
		const res = await fetch(`http://127.0.0.1:${proxyPort}/`)
		expect(res.status).toBe(401)
		expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="yggl"')
	})

	it('returns 401 with wrong token', async () => {
		const res = await fetch(`http://127.0.0.1:${proxyPort}/`, {
			headers: { Authorization: 'Bearer wrong-token' },
		})
		expect(res.status).toBe(401)
	})

	it('returns 401 for malformed Authorization header', async () => {
		const res = await fetch(`http://127.0.0.1:${proxyPort}/`, {
			headers: { Authorization: TOKEN },
		})
		expect(res.status).toBe(401)
	})

	it('proxies request with valid token', async () => {
		const res = await fetch(`http://127.0.0.1:${proxyPort}/`, {
			headers: { Authorization: `Bearer ${TOKEN}` },
		})
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('target body')
		expect(res.headers.get('X-From-Target')).toBe('yes')
	})

	it('strips Authorization header before forwarding to target', async () => {
		await fetch(`http://127.0.0.1:${proxyPort}/path?q=1`, {
			headers: { Authorization: `Bearer ${TOKEN}`, 'X-Custom': 'kept' },
		})
		expect(lastRequestHeaders.authorization).toBeUndefined()
		expect(lastRequestHeaders['x-custom']).toBe('kept')
	})

	it('forwards request path and query string', async () => {
		let receivedUrl = ''
		target.removeAllListeners('request')
		target.on('request', (req, res) => {
			receivedUrl = req.url ?? ''
			res.end('ok')
		})

		await fetch(`http://127.0.0.1:${proxyPort}/some/path?foo=bar`, {
			headers: { Authorization: `Bearer ${TOKEN}` },
		})
		expect(receivedUrl).toBe('/some/path?foo=bar')
	})

	it('returns 502 when target is unreachable', async () => {
		await new Promise<void>((r) => target.close(() => r()))
		const res = await fetch(`http://127.0.0.1:${proxyPort}/`, {
			headers: { Authorization: `Bearer ${TOKEN}` },
		})
		expect(res.status).toBe(502)
	})
})

// ── ShareManager ─────────────────────────────────────────────────────────────

describe('ShareManager', () => {
	it('throws ShareError when yggstack.conf does not exist', async () => {
		const mgr = new ShareManager()
		await expect(
			mgr.start(
				DEFAULT_CONFIG,
				{ port: 3000 },
				{
					probeAdminSocket: async () => false,
					findInPath: () => null,
					findBundled: () => '/fake/yggstack',
					confPath: '/nonexistent/path/yggstack.conf',
				},
			),
		).rejects.toThrow(ShareError)
		await expect(
			mgr.start(
				DEFAULT_CONFIG,
				{ port: 3000 },
				{
					probeAdminSocket: async () => false,
					findInPath: () => null,
					findBundled: () => '/fake/yggstack',
					confPath: '/nonexistent/path/yggstack.conf',
				},
			),
		).rejects.toThrow('yggl init')
	})

	it('throws ShareError when daemon is already running (adopted)', async () => {
		const mgr = new ShareManager()
		await expect(
			mgr.start(
				DEFAULT_CONFIG,
				{ port: 3000 },
				{
					probeAdminSocket: async () => true,
					confPath: '/nonexistent/path/yggstack.conf',
				},
			),
		).rejects.toThrow(ShareError)
	})

	it('stop() is safe to call when not started', async () => {
		const mgr = new ShareManager()
		await expect(mgr.stop()).resolves.toBeUndefined()
	})
})
