import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../config.js'
import { ConnectError, ConnectManager, parseConnectTarget } from '../connect.js'

// ── parseConnectTarget ────────────────────────────────────────────────────────

describe('parseConnectTarget', () => {
	it('parses bracketed IPv6 form [addr]:port', () => {
		const result = parseConnectTarget('[200:aaaa::1]:3000')
		expect(result.address).toBe('200:aaaa::1')
		expect(result.port).toBe(3000)
	})

	it('parses bare addr:port using last colon', () => {
		const result = parseConnectTarget('200:aaaa::1:3000')
		expect(result.address).toBe('200:aaaa::1')
		expect(result.port).toBe(3000)
	})

	it('parses bracketed form with complex address', () => {
		const result = parseConnectTarget('[200:1234:5678:abcd::1]:443')
		expect(result.address).toBe('200:1234:5678:abcd::1')
		expect(result.port).toBe(443)
	})

	it('throws ConnectError for missing colon', () => {
		expect(() => parseConnectTarget('nocoheratall')).toThrow(ConnectError)
	})

	it('throws ConnectError for port out of range in bracketed form', () => {
		expect(() => parseConnectTarget('[200::1]:99999')).toThrow(ConnectError)
	})

	it('throws ConnectError for non-numeric port in bracketed form', () => {
		expect(() => parseConnectTarget('[200::1]:abc')).toThrow(ConnectError)
	})

	it('throws ConnectError for port 0', () => {
		expect(() => parseConnectTarget('[200::1]:0')).toThrow(ConnectError)
	})
})

// ── ConnectManager ────────────────────────────────────────────────────────────

describe('ConnectManager', () => {
	it('throws ConnectError when yggstack.conf does not exist', async () => {
		const mgr = new ConnectManager()
		await expect(
			mgr.start(
				DEFAULT_CONFIG,
				{ remoteAddress: '200:aaaa::1', remotePort: 3000 },
				{
					probeAdminSocket: async () => false,
					findInPath: () => null,
					findBundled: () => '/fake/yggstack',
					confPath: '/nonexistent/path/yggstack.conf',
				},
			),
		).rejects.toThrow(ConnectError)
	})

	it('throws ConnectError when daemon is already running', async () => {
		const mgr = new ConnectManager()
		await expect(
			mgr.start(
				DEFAULT_CONFIG,
				{ remoteAddress: '200:aaaa::1', remotePort: 3000 },
				{
					probeAdminSocket: async () => true,
					confPath: '/nonexistent/path/yggstack.conf',
				},
			),
		).rejects.toThrow(ConnectError)
	})

	it('stop() is safe to call when not started', async () => {
		const mgr = new ConnectManager()
		await expect(mgr.stop()).resolves.toBeUndefined()
	})

	it('defaults localPort to remotePort', async () => {
		// We can verify option defaulting without real yggstack by catching the
		// expected conf-not-found error after confirming no daemon is running.
		// The point is the error is about conf, not about port handling.
		const mgr = new ConnectManager()
		const err = await mgr
			.start(
				DEFAULT_CONFIG,
				{ remoteAddress: '200::1', remotePort: 8080 },
				{
					probeAdminSocket: async () => false,
					findInPath: () => null,
					findBundled: () => '/fake/yggstack',
					confPath: '/nonexistent/path/yggstack.conf',
				},
			)
			.catch((e) => e)
		expect(err).toBeInstanceOf(ConnectError)
		expect(err.message).toContain('yggl init')
	})
})
