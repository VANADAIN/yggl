import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminClient } from '../admin.js'
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
		const proc = new FakeProc()

		const mgr = new DaemonManager()
		;(mgr.isRunning as unknown as ReturnType<typeof vi.fn>) = vi.fn(async () => false)
		;(mgr as unknown as { waitForSocket: () => Promise<void> }).waitForSocket = vi.fn(
			async () => {},
		)

		const source = await mgr.start(
			{ ...DEFAULT_CONFIG, daemon: '/fake/yggstack' },
			{
				probeAdminSocket: async () => false,
				findInPath: () => null,
				findBundled: () => null,
				fileExists: () => true,
				isExecutable: () => true,
				spawnProcess: () => proc as never,
			},
		)

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
		const fakeGenconf = () => Buffer.from('{"PrivateKey":"abc"}')

		initYggstackConf('/fake/yggstack', { runGenconf: fakeGenconf })
		expect(readFileSync(join(tmpDir, '.yggl', 'yggstack.conf'), 'utf8')).toContain('"PrivateKey"')
		expect(() => initYggstackConf('/fake/yggstack', { runGenconf: fakeGenconf })).toThrow(
			'already exists',
		)
	})

	it('ConnectManager.start writes runtime config, waits for local port, and stop kills proc', async () => {
		const confPath = join(tmpDir, '.yggl', 'yggstack.conf')
		const runtimeConfPath = join(tmpDir, '.yggl', 'connect.runtime.conf')
		writeFileSync(confPath, JSON.stringify(MINIMAL_VALID_CONF))
		const localPort = 18080
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
		const proc = new FakeProc()
		const getSelfSpy = vi.spyOn(AdminClient.prototype, 'getSelf').mockResolvedValue({
			address: '200:aaaa::1',
			publicKey: 'pubkey',
			buildName: 'yggstack',
			buildVersion: '1.0.5',
		})

		const mgr = new ShareManager()
		try {
			const result = await mgr.start(
				DEFAULT_CONFIG,
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
			expect(getSelfSpy).toHaveBeenCalled()
		} finally {
			await mgr.stop()
			getSelfSpy.mockRestore()
		}

		expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
	})
})
