import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'
import { ConnectManager } from '../../connect.js'
import { ShareManager } from '../../share.js'
import { createTestPair, getFreePort, getTestBinary } from './helpers.js'

const binary = getTestBinary()

it.skipIf(!binary)('routes HTTP requests from nodeB to nodeA backend', async () => {
	const pair = await createTestPair(binary!)

	const backend = createServer((_, res) => {
		res.writeHead(200)
		res.end('hello from A')
	})
	await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', () => resolve()))
	const backendPort = (backend.address() as AddressInfo).port

	const share = new ShareManager()
	const connect = new ConnectManager()

	try {
		const { address, port } = await share.start(
			pair.nodeA.config,
			{ port: backendPort },
			pair.nodeA.deps,
		)

		// Yggdrasil addresses are in 200::/7 — first byte 0x02–0x03
		expect(address).toMatch(/^[23][0-9a-f]{2}:/)
		expect(port).toBe(backendPort)

		const localPort = await getFreePort()
		await connect.start(
			pair.nodeB.config,
			{ remoteAddress: address, remotePort: backendPort, localPort },
			pair.nodeB.deps,
		)

		const res = await fetch(`http://127.0.0.1:${localPort}/`)
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('hello from A')
	} finally {
		await Promise.all([share.stop(), connect.stop()])
		await new Promise<void>((r) => backend.close(() => r()))
		pair.cleanup()
	}
})
