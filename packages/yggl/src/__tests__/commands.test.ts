import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runPeersAdd, runPeersList, runPeersRemove, runStatus, runStop } from '../commands.js'
import { DEFAULT_PEERS } from '../config.js'

let tmpDir: string

beforeEach(() => {
	tmpDir = join(tmpdir(), `yggl-cmd-test-${Date.now()}`)
	mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true })
	vi.restoreAllMocks()
})

// ── peers add ────────────────────────────────────────────────────────────────

describe('runPeersAdd', () => {
	it('adds peer to empty config', async () => {
		const configPath = join(tmpDir, 'yggl.config.json')
		writeFileSync(configPath, JSON.stringify({}))
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

		await runPeersAdd(configPath, 'tls://new.example.com:443')

		expect(spy).toHaveBeenCalledWith(expect.stringContaining('Added peer'))
		const raw = JSON.parse(require('node:fs').readFileSync(configPath, 'utf8'))
		expect(raw.peers).toContain('tls://new.example.com:443')
	})

	it('adds peer to existing peers list', async () => {
		const configPath = join(tmpDir, 'yggl.config.json')
		writeFileSync(configPath, JSON.stringify({ peers: ['tls://existing.com:443'] }))
		vi.spyOn(console, 'log').mockImplementation(() => {})

		await runPeersAdd(configPath, 'tls://new.example.com:443')

		const raw = JSON.parse(require('node:fs').readFileSync(configPath, 'utf8'))
		expect(raw.peers).toContain('tls://existing.com:443')
		expect(raw.peers).toContain('tls://new.example.com:443')
	})

	it('warns and does not duplicate existing peer', async () => {
		const configPath = join(tmpDir, 'yggl.config.json')
		const uri = 'tls://existing.com:443'
		writeFileSync(configPath, JSON.stringify({ peers: [uri] }))
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

		await runPeersAdd(configPath, uri)

		expect(spy).toHaveBeenCalledWith(expect.stringContaining('already in list'))
		const raw = JSON.parse(require('node:fs').readFileSync(configPath, 'utf8'))
		expect(raw.peers.filter((p: string) => p === uri)).toHaveLength(1)
	})

	it('uses DEFAULT_PEERS as base when config has no peers field', async () => {
		const configPath = join(tmpDir, 'yggl.config.json')
		writeFileSync(configPath, JSON.stringify({ daemon: 'auto' }))
		vi.spyOn(console, 'log').mockImplementation(() => {})

		await runPeersAdd(configPath, 'tls://new.example.com:443')

		const raw = JSON.parse(require('node:fs').readFileSync(configPath, 'utf8'))
		expect(raw.peers).toContain(DEFAULT_PEERS[0])
		expect(raw.peers).toContain('tls://new.example.com:443')
	})
})

// ── peers remove ─────────────────────────────────────────────────────────────

describe('runPeersRemove', () => {
	it('removes a peer from the list', async () => {
		const configPath = join(tmpDir, 'yggl.config.json')
		const uri = 'tls://remove-me.com:443'
		writeFileSync(configPath, JSON.stringify({ peers: ['tls://keep.com:443', uri] }))
		vi.spyOn(console, 'log').mockImplementation(() => {})

		await runPeersRemove(configPath, uri)

		const raw = JSON.parse(require('node:fs').readFileSync(configPath, 'utf8'))
		expect(raw.peers).not.toContain(uri)
		expect(raw.peers).toContain('tls://keep.com:443')
	})

	it('warns if peer not found', async () => {
		const configPath = join(tmpDir, 'yggl.config.json')
		writeFileSync(configPath, JSON.stringify({ peers: ['tls://other.com:443'] }))
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

		await runPeersRemove(configPath, 'tls://nothere.com:443')

		expect(spy).toHaveBeenCalledWith(expect.stringContaining('not found'))
	})
})

// ── peers list ───────────────────────────────────────────────────────────────

describe('runPeersList', () => {
	it('prints peers from config', async () => {
		const configPath = join(tmpDir, 'yggl.config.json')
		writeFileSync(configPath, JSON.stringify({ peers: ['tls://a.com:443', 'tls://b.com:443'] }))
		const lines: string[] = []
		vi.spyOn(console, 'log').mockImplementation((...args) => lines.push(args.join(' ')))

		await runPeersList(configPath)

		expect(lines.some((l) => l.includes('tls://a.com:443'))).toBe(true)
		expect(lines.some((l) => l.includes('tls://b.com:443'))).toBe(true)
	})

	it('falls back to DEFAULT_PEERS when no config file', async () => {
		const configPath = join(tmpDir, 'missing.json')
		const lines: string[] = []
		vi.spyOn(console, 'log').mockImplementation((...args) => lines.push(args.join(' ')))

		await runPeersList(configPath)

		expect(lines.some((l) => l.includes(DEFAULT_PEERS[0] ?? ''))).toBe(true)
	})
})

// ── status ───────────────────────────────────────────────────────────────────

describe('runStatus', () => {
	it('prints node info when daemon is running', async () => {
		const lines: string[] = []
		vi.spyOn(console, 'log').mockImplementation((...args) => lines.push(args.join(' ')))

		const configPath = join(tmpDir, 'missing.json')
		await runStatus(configPath, () => ({
			getSelf: async () => ({
				address: '200:1234::1',
				publicKey: 'abcdef',
				buildName: 'yggstack',
				buildVersion: '1.0.5',
			}),
			getPeers: async () => [],
			getSessions: async () => [],
		}))

		expect(lines.some((l) => l.includes('200:1234::1'))).toBe(true)
		expect(lines.some((l) => l.includes('running'))).toBe(true)
	})

	it('prints error and sets exitCode when daemon not running', async () => {
		const lines: string[] = []
		vi.spyOn(console, 'log').mockImplementation((...args) => lines.push(args.join(' ')))
		const origExitCode = process.exitCode

		const configPath = join(tmpDir, 'missing.json')
		await runStatus(configPath, () => ({
			getSelf: async () => {
				throw new Error('connection refused')
			},
			getPeers: async () => [],
			getSessions: async () => [],
		}))

		expect(process.exitCode).toBe(1)
		expect(lines.some((l) => l.includes('not running'))).toBe(true)
		process.exitCode = origExitCode
	})

	it('shows peers when connected', async () => {
		const lines: string[] = []
		vi.spyOn(console, 'log').mockImplementation((...args) => lines.push(args.join(' ')))

		const configPath = join(tmpDir, 'missing.json')
		await runStatus(configPath, () => ({
			getSelf: async () => ({
				address: '200:1234::1',
				publicKey: 'abc',
				buildName: 'yggstack',
				buildVersion: '1.0.5',
			}),
			getPeers: async () => [
				{
					address: '200:aaaa::1',
					publicKey: 'peerkey',
					remote: 'tls://example.com:443',
					uptime: 120,
					rxBytes: 1024,
					txBytes: 512,
					latency: 10,
				},
			],
			getSessions: async () => [],
		}))

		expect(lines.some((l) => l.includes('200:aaaa::1'))).toBe(true)
		expect(lines.some((l) => l.includes('Peers'))).toBe(true)
	})
})

// ── stop ─────────────────────────────────────────────────────────────────────

describe('runStop', () => {
	it('warns when no PID file exists', async () => {
		// Run from a clean tmpDir where .yggl/yggl.pid does not exist
		const origCwd = process.cwd()
		process.chdir(tmpDir)
		const lines: string[] = []
		vi.spyOn(console, 'log').mockImplementation((...args) => lines.push(args.join(' ')))

		try {
			await runStop()
		} finally {
			process.chdir(origCwd)
		}

		expect(lines.some((l) => l.includes('No yggl PID file'))).toBe(true)
	})
})
