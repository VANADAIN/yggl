import { describe, expect, it } from 'vitest'
import type { AdminClientDeps } from '../admin.js'
import { AdminClient, AdminError } from '../admin.js'
import { DEFAULT_CONFIG } from '../config.js'

type MockResponse = { status: 'success' | 'error'; response?: unknown; error?: string }

function makeDeps(response: MockResponse): AdminClientDeps {
	return { sendRequest: async () => response }
}

const SELF_RESPONSE: MockResponse = {
	status: 'success',
	response: {
		address: '200:1234::1',
		key: 'abcdef',
		build_name: 'yggstack',
		build_version: '1.0.5',
	},
}

describe('AdminClient.getSelf', () => {
	it('parses address and public key', async () => {
		const client = new AdminClient(DEFAULT_CONFIG, makeDeps(SELF_RESPONSE))
		const self = await client.getSelf()
		expect(self.address).toBe('200:1234::1')
		expect(self.publicKey).toBe('abcdef')
		expect(self.buildName).toBe('yggstack')
		expect(self.buildVersion).toBe('1.0.5')
	})

	it('throws AdminError on error status', async () => {
		const client = new AdminClient(
			DEFAULT_CONFIG,
			makeDeps({ status: 'error', error: 'not ready' }),
		)
		await expect(client.getSelf()).rejects.toThrow(AdminError)
		await expect(client.getSelf()).rejects.toThrow('not ready')
	})

	it('throws AdminError when error field missing', async () => {
		const client = new AdminClient(DEFAULT_CONFIG, makeDeps({ status: 'error' }))
		await expect(client.getSelf()).rejects.toThrow(AdminError)
	})

	it('falls back to empty strings for missing fields', async () => {
		const client = new AdminClient(DEFAULT_CONFIG, makeDeps({ status: 'success', response: {} }))
		const self = await client.getSelf()
		expect(self.address).toBe('')
		expect(self.publicKey).toBe('')
		expect(self.buildName).toBe('')
		expect(self.buildVersion).toBe('')
	})
})

describe('AdminClient.getPeers', () => {
	it('parses full peer list', async () => {
		const client = new AdminClient(
			DEFAULT_CONFIG,
			makeDeps({
				status: 'success',
				response: {
					peers: [
						{
							address: '200:aaaa::1',
							key: 'peer1key',
							remote: 'tls://example.com:443',
							uptime: 120.5,
							rx_bytes: 1000,
							tx_bytes: 2000,
							latency: 15.3,
						},
					],
				},
			}),
		)
		const peers = await client.getPeers()
		expect(peers).toHaveLength(1)
		const peer = peers[0]!
		expect(peer.address).toBe('200:aaaa::1')
		expect(peer.publicKey).toBe('peer1key')
		expect(peer.remote).toBe('tls://example.com:443')
		expect(peer.uptime).toBe(120.5)
		expect(peer.rxBytes).toBe(1000)
		expect(peer.txBytes).toBe(2000)
		expect(peer.latency).toBe(15.3)
	})

	it('returns empty array when peers list is empty', async () => {
		const client = new AdminClient(
			DEFAULT_CONFIG,
			makeDeps({ status: 'success', response: { peers: [] } }),
		)
		expect(await client.getPeers()).toEqual([])
	})

	it('returns empty array when peers field missing', async () => {
		const client = new AdminClient(DEFAULT_CONFIG, makeDeps({ status: 'success', response: {} }))
		expect(await client.getPeers()).toEqual([])
	})

	it('falls back to zero for missing numeric fields', async () => {
		const client = new AdminClient(
			DEFAULT_CONFIG,
			makeDeps({ status: 'success', response: { peers: [{ address: '200::1', key: 'k' }] } }),
		)
		const peers = await client.getPeers()
		const peer = peers[0]!
		expect(peer.uptime).toBe(0)
		expect(peer.rxBytes).toBe(0)
		expect(peer.latency).toBe(0)
	})
})

describe('AdminClient.getSessions', () => {
	it('parses session list', async () => {
		const client = new AdminClient(
			DEFAULT_CONFIG,
			makeDeps({
				status: 'success',
				response: {
					sessions: [
						{
							address: '200:bbbb::1',
							key: 'sess1key',
							uptime: 60.0,
							rx_bytes: 500,
							tx_bytes: 800,
						},
					],
				},
			}),
		)
		const sessions = await client.getSessions()
		expect(sessions).toHaveLength(1)
		const session = sessions[0]!
		expect(session.address).toBe('200:bbbb::1')
		expect(session.publicKey).toBe('sess1key')
		expect(session.uptime).toBe(60.0)
		expect(session.rxBytes).toBe(500)
		expect(session.txBytes).toBe(800)
	})

	it('returns empty array when no sessions', async () => {
		const client = new AdminClient(
			DEFAULT_CONFIG,
			makeDeps({ status: 'success', response: { sessions: [] } }),
		)
		expect(await client.getSessions()).toEqual([])
	})

	it('returns empty array when sessions field missing', async () => {
		const client = new AdminClient(DEFAULT_CONFIG, makeDeps({ status: 'success', response: {} }))
		expect(await client.getSessions()).toEqual([])
	})
})

describe('AdminClient.waitForReady', () => {
	it('resolves immediately when API responds', async () => {
		const client = new AdminClient(DEFAULT_CONFIG, makeDeps(SELF_RESPONSE))
		await expect(client.waitForReady(1000)).resolves.toBeUndefined()
	})

	it('throws AdminError after timeout when API never responds', async () => {
		const client = new AdminClient(DEFAULT_CONFIG, {
			sendRequest: async () => {
				throw new Error('connection refused')
			},
		})
		await expect(client.waitForReady(300)).rejects.toThrow(AdminError)
		await expect(client.waitForReady(300)).rejects.toThrow('not ready')
	})

	it('resolves once API becomes available after initial failure', async () => {
		let attempts = 0
		const client = new AdminClient(DEFAULT_CONFIG, {
			sendRequest: async () => {
				attempts++
				if (attempts < 3) throw new Error('not yet')
				return SELF_RESPONSE
			},
		})
		await expect(client.waitForReady(2000)).resolves.toBeUndefined()
		expect(attempts).toBeGreaterThanOrEqual(3)
	})
})
