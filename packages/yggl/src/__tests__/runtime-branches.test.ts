import { EventEmitter } from 'node:events'
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createNetServer, type Server as NetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '../config.js'
import { ConnectManager } from '../connect.js'
import { DaemonManager, initYggstackConf } from '../daemon.js'
import { ShareManager } from '../share.js'

const MINIMAL_VALID_CONF = {
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

class FakeProc extends EventEmitter {
	stdout = new EventEmitter()
	stderr = new EventEmitter()
	kill = vi.fn(() => {
		setImmediate(() => this.emit('exit'))
		return true
	})
}

function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createNetServer()
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address()
			if (!addr || typeof addr === 'string') {
				server.close()
				reject(new Error('failed to resolve free port'))
				return
			}
			const { port } = addr
			server.close((err) => (err ? reject(err) : resolve(port)))
		})
	})
}

async function createAdminServer(port: number): Promise<NetServer> {
	const server = createNetServer((socket) => {
		socket.on('data', () => {
			socket.write(
				`${JSON.stringify({
					status: 'success',
					response: {
						address: '200:aaaa::1',
						key: 'pubkey',
						build_name: 'yggstack',
						build_version: '1.0.5',
					},
				})}\n`,
			)
			socket.end()
		})
	})

	await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()))
	return server
}

describe('runtime branches', () => {
	let tmpDir: string
	let origCwd: string

	beforeEach(() => {
		tmpDir = join(tmpdir(), `yggl-runtime-${Date.now()}`)
		mkdirSync(join(tmpDir, '.yggl'), { recursive: true })
		origCwd = process.cwd()
		process.chdir(tmpDir)
		vi.restoreAllMocks()
	})

	afterEach(() => {
		process.chdir(origCwd)
		rmSync(tmpDir, { recursive: true, force: true })
	})

	it('DaemonManager.start writes runtime config, maps bundled source, and stop kills proc', async () => {
		writeFileSync(join(tmpDir, '.yggl', 'yggstack.conf'), JSON.stringify(MINIMAL_VALID_CONF))
		const fakeBinary = join(tmpDir, 'fake-yggstack.sh')
		writeFileSync(
			fakeBinary,
			'#!/bin/sh\ntrap "exit 0" TERM INT\nwhile :; do sleep 1; done\n',
			'utf8',
		)
		chmodSync(fakeBinary, 0o755)

		const mgr = new DaemonManager()
		;(mgr.isRunning as unknown as ReturnType<typeof vi.fn>) = vi.fn(async () => false)
		;(mgr as unknown as { waitForSocket: () => Promise<void> }).waitForSocket = vi.fn(
			async () => {},
		)

		const source = await mgr.start({ ...DEFAULT_CONFIG, daemon: fakeBinary })

		expect(source).toBe('spawned-custom')
		expect(mgr.source).toBe('spawned-custom')
		expect(readFileSync(join(tmpDir, '.yggl', 'yggstack.runtime.conf'), 'utf8')).toContain(
			'"AdminListen": "tcp://localhost:9001"',
		)

		await mgr.stop()
		expect(mgr.source).toBeNull()
	})

	it('DaemonManager.stop throws for adopted daemon', async () => {
		const mgr = new DaemonManager()
		;(mgr as unknown as { _source: string })._source = 'adopted'
		await expect(mgr.stop()).rejects.toThrow('will not be stopped')
	})

	it('initYggstackConf writes generated config and rejects overwrite', () => {
		const fakeBinary = join(tmpDir, 'genconf.sh')
		writeFileSync(
			fakeBinary,
			'#!/bin/sh\nif [ "$1" = "-genconf" ] && [ "$2" = "-json" ]; then echo \'{"PrivateKey":"abc"}\'; fi\n',
			'utf8',
		)
		chmodSync(fakeBinary, 0o755)

		initYggstackConf(fakeBinary)
		expect(readFileSync(join(tmpDir, '.yggl', 'yggstack.conf'), 'utf8')).toContain('"PrivateKey"')
		expect(() => initYggstackConf(fakeBinary)).toThrow('already exists')
	})

	it('ConnectManager.start writes runtime config, waits for local port, and stop kills proc', async () => {
		const confPath = join(tmpDir, '.yggl', 'yggstack.conf')
		const runtimeConfPath = join(tmpDir, '.yggl', 'connect.runtime.conf')
		writeFileSync(confPath, JSON.stringify(MINIMAL_VALID_CONF))
		const localPort = await getFreePort()
		const proc = new FakeProc()
		proc.kill = vi.fn(() => {
			setImmediate(() => proc.emit('exit'))
			return true
		})

		const mgr = new ConnectManager()
		const result = await mgr.start(
			DEFAULT_CONFIG,
			{ remoteAddress: '200:bbbb::1', remotePort: 3000, localPort },
			{
				probeAdminSocket: async () => false,
				findInPath: () => null,
				findBundled: () => '/fake/yggstack',
				confPath,
				runtimeConfPath,
				waitForLocalPort: async () => {},
				spawnProcess: (_cmd, args) => {
					expect(args).toContain(`-local-tcp`)
					expect(args).toContain(`${localPort}:[200:bbbb::1]:3000`)
					return proc as never
				},
			},
		)

		expect(result.localPort).toBe(localPort)
		expect(readFileSync(runtimeConfPath, 'utf8')).toContain('"AdminListen": "tcp://localhost:9001"')

		await mgr.stop()
		expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
	})

	it('ShareManager.start applies allowlist and returns auth token when enabled', async () => {
		const confPath = join(tmpDir, '.yggl', 'yggstack.conf')
		const runtimeConfPath = join(tmpDir, '.yggl', 'share.runtime.conf')
		writeFileSync(confPath, JSON.stringify(MINIMAL_VALID_CONF))
		const adminPort = await getFreePort()
		const config = {
			...DEFAULT_CONFIG,
			adminSocket: { host: '127.0.0.1', port: adminPort },
		}
		const adminServer = await createAdminServer(adminPort)
		const proc = new FakeProc()

		const mgr = new ShareManager()
		try {
			const result = await mgr.start(
				config,
				{ port: 3000, allowKeys: ['key1', 'key2'] },
				{
					probeAdminSocket: async () => false,
					findInPath: () => null,
					findBundled: () => '/fake/yggstack',
					confPath,
					runtimeConfPath,
					waitForAdminSocket: async () => {},
					spawnProcess: () => proc as never,
				},
			)

			expect(result.address).toBe('200:aaaa::1')
			expect(result.url).toBe('http://[200:aaaa::1]:3000')
			expect(result.token).toBeUndefined()
			expect(readFileSync(runtimeConfPath, 'utf8')).toContain('"AllowedPublicKeys": [')
			expect(readFileSync(runtimeConfPath, 'utf8')).toContain('"key1"')
			expect(readFileSync(runtimeConfPath, 'utf8')).toContain('"key2"')
		} finally {
			await mgr.stop()
			await new Promise<void>((resolve) => adminServer.close(() => resolve()))
		}

		expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
	})
})
