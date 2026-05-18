import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../config.js'
import type { YggstackConfig } from '../yggstack-conf.js'
import {
	DEFAULT_MULTICAST_INTERFACE,
	mergeYggstackConfig,
	parseYggstackConfig,
} from '../yggstack-conf.js'

const MINIMAL_VALID: YggstackConfig = {
	Peers: [],
	Listen: [],
	InterfacePeers: {},
	AllowedPublicKeys: [],
	PublicKey: 'abc',
	PrivateKey: '0000000000000000000000000000000000000000000000000000000000000001',
	IfName: 'auto',
	IfMTU: 65535,
	MulticastInterfaces: [],
	NodeInfo: {},
	NodeInfoPrivacy: false,
	AdminListen: 'tcp://localhost:9001',
	Log: 'stdout',
}

describe('parseYggstackConfig', () => {
	it('parses a valid config with PrivateKey', () => {
		const parsed = parseYggstackConfig(JSON.stringify(MINIMAL_VALID))
		expect(parsed.PrivateKey).toBe(MINIMAL_VALID.PrivateKey)
		expect(parsed.PublicKey).toBe('abc')
	})

	it('throws on invalid JSON', () => {
		expect(() => parseYggstackConfig('{ bad json')).toThrow('invalid JSON')
	})

	it('throws when PrivateKey missing', () => {
		const { PrivateKey: _, ...noKey } = MINIMAL_VALID
		expect(() => parseYggstackConfig(JSON.stringify(noKey))).toThrow('PrivateKey')
	})

	it('throws when PrivateKey is empty string', () => {
		expect(() => parseYggstackConfig(JSON.stringify({ ...MINIMAL_VALID, PrivateKey: '' }))).toThrow(
			'PrivateKey',
		)
	})

	it('falls back to defaults for missing optional fields', () => {
		const raw = { PrivateKey: MINIMAL_VALID.PrivateKey }
		const parsed = parseYggstackConfig(JSON.stringify(raw))
		expect(parsed.Peers).toEqual([])
		expect(parsed.Listen).toEqual([])
		expect(parsed.InterfacePeers).toEqual({})
		expect(parsed.IfName).toBe('auto')
		expect(parsed.IfMTU).toBe(65535)
		expect(parsed.AdminListen).toBe('tcp://localhost:9001')
		expect(parsed.Log).toBe('stdout')
		expect(parsed.NodeInfoPrivacy).toBe(false)
	})
})

describe('mergeYggstackConfig', () => {
	it('sets Peers from yggl config', () => {
		const merged = mergeYggstackConfig(MINIMAL_VALID, {
			...DEFAULT_CONFIG,
			peers: ['tls://example.com:443'],
		})
		expect(merged.Peers).toEqual(['tls://example.com:443'])
	})

	it('sets MulticastInterfaces when autoDiscover true', () => {
		const merged = mergeYggstackConfig(MINIMAL_VALID, { ...DEFAULT_CONFIG, autoDiscover: true })
		expect(merged.MulticastInterfaces).toEqual([DEFAULT_MULTICAST_INTERFACE])
	})

	it('clears MulticastInterfaces when autoDiscover false', () => {
		const merged = mergeYggstackConfig(MINIMAL_VALID, { ...DEFAULT_CONFIG, autoDiscover: false })
		expect(merged.MulticastInterfaces).toEqual([])
	})

	it('sets AdminListen from adminSocket', () => {
		const merged = mergeYggstackConfig(MINIMAL_VALID, {
			...DEFAULT_CONFIG,
			adminSocket: { host: '127.0.0.1', port: 9002 },
		})
		expect(merged.AdminListen).toBe('tcp://127.0.0.1:9002')
	})

	it('preserves other fields from base', () => {
		const merged = mergeYggstackConfig(MINIMAL_VALID, DEFAULT_CONFIG)
		expect(merged.PrivateKey).toBe(MINIMAL_VALID.PrivateKey)
		expect(merged.IfMTU).toBe(MINIMAL_VALID.IfMTU)
	})

	it('preserves Listen from base', () => {
		const base = { ...MINIMAL_VALID, Listen: ['tcp://127.0.0.1:12345'] }
		const merged = mergeYggstackConfig(base, DEFAULT_CONFIG)
		expect(merged.Listen).toEqual(['tcp://127.0.0.1:12345'])
	})
})
