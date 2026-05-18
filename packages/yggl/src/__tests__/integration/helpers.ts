import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveBinary } from '../../binary.js'
import type { YgglConfig } from '../../config.js'
import { DEFAULT_CONFIG } from '../../config.js'
import type { ConnectManagerDeps } from '../../connect.js'
import type { ShareManagerDeps } from '../../share.js'

export interface TestNode {
	config: YgglConfig
	publicKey: string
	deps: ShareManagerDeps & ConnectManagerDeps
}

export interface TestPair {
	nodeA: TestNode
	nodeB: TestNode
	cleanup: () => void
}

export function getTestBinary(): string | null {
	if (process.env.YGGL_TEST_BINARY) return process.env.YGGL_TEST_BINARY
	try {
		return resolveBinary('auto')
	} catch {
		return null
	}
}

export function getFreePort(): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		const srv = createServer()
		srv.listen(0, '127.0.0.1', () => {
			const { port } = srv.address() as AddressInfo
			srv.close((err) => (err ? reject(err) : resolve(port)))
		})
		srv.on('error', reject)
	})
}

export async function createTestPair(binaryPath: string): Promise<TestPair> {
	const dirA = mkdtempSync(join(tmpdir(), 'yggl-A-'))
	const dirB = mkdtempSync(join(tmpdir(), 'yggl-B-'))

	const rawA = JSON.parse(
		execSync(`"${binaryPath}" -genconf -json`, {
			stdio: ['ignore', 'pipe', 'ignore'],
		}).toString(),
	) as Record<string, unknown>
	const rawB = JSON.parse(
		execSync(`"${binaryPath}" -genconf -json`, {
			stdio: ['ignore', 'pipe', 'ignore'],
		}).toString(),
	) as Record<string, unknown>

	const [listenA, adminA, adminB] = await Promise.all([getFreePort(), getFreePort(), getFreePort()])

	// nodeA listens for peer connections; nodeB connects outward to nodeA only
	const confA = {
		...rawA,
		Listen: [`tcp://127.0.0.1:${listenA}`],
		AdminListen: `tcp://127.0.0.1:${adminA}`,
		Peers: [],
		MulticastInterfaces: [],
	}
	const confB = {
		...rawB,
		Listen: [],
		AdminListen: `tcp://127.0.0.1:${adminB}`,
		Peers: [`tcp://127.0.0.1:${listenA}`],
		MulticastInterfaces: [],
	}

	const confPathA = join(dirA, 'yggstack.conf')
	const confPathB = join(dirB, 'yggstack.conf')
	writeFileSync(confPathA, JSON.stringify(confA, null, '\t'))
	writeFileSync(confPathB, JSON.stringify(confB, null, '\t'))

	// Inject binary directly — skip PATH/bundled detection
	const binaryDeps = {
		probeAdminSocket: () => Promise.resolve(false),
		findInPath: () => null,
		findBundled: () => binaryPath,
	}

	const configA: YgglConfig = {
		...DEFAULT_CONFIG,
		peers: [],
		autoDiscover: false,
		adminSocket: { host: '127.0.0.1', port: adminA },
	}
	// configB.peers drives mergeYggstackConfig → sets Peers in the runtime conf
	const configB: YgglConfig = {
		...DEFAULT_CONFIG,
		peers: [`tcp://127.0.0.1:${listenA}`],
		autoDiscover: false,
		adminSocket: { host: '127.0.0.1', port: adminB },
	}

	const depsA: ShareManagerDeps & ConnectManagerDeps = {
		...binaryDeps,
		confPath: confPathA,
		runtimeConfPath: join(dirA, 'yggstack.runtime.conf'),
	}
	const depsB: ShareManagerDeps & ConnectManagerDeps = {
		...binaryDeps,
		confPath: confPathB,
		runtimeConfPath: join(dirB, 'yggstack.runtime.conf'),
	}

	return {
		nodeA: { config: configA, publicKey: String(rawA.PublicKey ?? ''), deps: depsA },
		nodeB: { config: configB, publicKey: String(rawB.PublicKey ?? ''), deps: depsB },
		cleanup: () => {
			rmSync(dirA, { recursive: true, force: true })
			rmSync(dirB, { recursive: true, force: true })
		},
	}
}
