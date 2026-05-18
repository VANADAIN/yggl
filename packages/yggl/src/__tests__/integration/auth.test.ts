import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'
import { ConnectManager } from '../../connect.js'
import { ShareManager } from '../../share.js'
import { createTestPair, getFreePort, getTestBinary } from './helpers.js'

const binary = getTestBinary()

it.skipIf(!binary)('enforces Bearer token auth over Yggdrasil tunnel', async () => {
	const pair = await createTestPair(binary!)

	const backend = createServer((_, res) => {
		res.writeHead(200)
		res.end('protected')
	})
	await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', () => resolve()))
	const backendPort = (backend.address() as AddressInfo).port

	const share = new ShareManager()
	const connect = new ConnectManager()

	try {
		const { address, token } = await share.start(
			pair.nodeA.config,
			{ port: backendPort, auth: true },
			pair.nodeA.deps,
		)

		expect(token).toBeTruthy()

		const localPort = await getFreePort()
		await connect.start(
			pair.nodeB.config,
			{ remoteAddress: address, remotePort: backendPort, localPort },
			pair.nodeB.deps,
		)

		const noAuth = await fetch(`http://127.0.0.1:${localPort}/`)
		expect(noAuth.status).toBe(401)

		const wrongToken = await fetch(`http://127.0.0.1:${localPort}/`, {
			headers: { Authorization: 'Bearer wrong' },
		})
		expect(wrongToken.status).toBe(401)

		const goodAuth = await fetch(`http://127.0.0.1:${localPort}/`, {
			headers: { Authorization: `Bearer ${token}` },
		})
		expect(goodAuth.status).toBe(200)
		expect(await goodAuth.text()).toBe('protected')
	} finally {
		await Promise.all([share.stop(), connect.stop()])
		await new Promise<void>((r) => backend.close(() => r()))
		pair.cleanup()
	}
})
