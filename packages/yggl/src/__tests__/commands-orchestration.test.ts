import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
	return {
		adminGetSelf: vi.fn(),
		connectStart: vi.fn(),
		connectStop: vi.fn(),
		daemonDetect: vi.fn(),
		daemonStart: vi.fn(),
		daemonStop: vi.fn(),
		initYggstackConf: vi.fn(),
		loadConfig: vi.fn(),
		shareStart: vi.fn(),
		shareStop: vi.fn(),
		spinnerStart: vi.fn(),
		spinnerStop: vi.fn(),
		writeDefaultConfig: vi.fn(),
	}
})

vi.mock('../config.js', async () => {
	const actual = await vi.importActual<typeof import('../config.js')>('../config.js')
	return {
		...actual,
		loadConfig: mocks.loadConfig,
		writeDefaultConfig: mocks.writeDefaultConfig,
	}
})

vi.mock('../daemon.js', async () => {
	const actual = await vi.importActual<typeof import('../daemon.js')>('../daemon.js')
	class MockDaemonManager {
		source: string | null = 'spawned-bundled'
		start = mocks.daemonStart
		stop = mocks.daemonStop
	}
	return {
		...actual,
		detectDaemon: mocks.daemonDetect,
		initYggstackConf: mocks.initYggstackConf,
		DaemonManager: MockDaemonManager,
	}
})

vi.mock('../admin.js', async () => {
	const actual = await vi.importActual<typeof import('../admin.js')>('../admin.js')
	class MockAdminClient {
		getSelf = mocks.adminGetSelf
	}
	return {
		...actual,
		AdminClient: MockAdminClient,
	}
})

vi.mock('../share.js', async () => {
	const actual = await vi.importActual<typeof import('../share.js')>('../share.js')
	class MockShareManager {
		start = mocks.shareStart
		stop = mocks.shareStop
	}
	return {
		...actual,
		ShareManager: MockShareManager,
	}
})

vi.mock('../connect.js', async () => {
	const actual = await vi.importActual<typeof import('../connect.js')>('../connect.js')
	class MockConnectManager {
		start = mocks.connectStart
		stop = mocks.connectStop
	}
	return {
		...actual,
		ConnectManager: MockConnectManager,
	}
})

vi.mock('../ui.js', async () => {
	const actual = await vi.importActual<typeof import('../ui.js')>('../ui.js')
	class MockSpinner {
		start = mocks.spinnerStart
		stop = mocks.spinnerStop
	}
	return {
		...actual,
		Spinner: MockSpinner,
		c: {
			green: (s: string) => s,
			red: (s: string) => s,
			yellow: (s: string) => s,
			cyan: (s: string) => s,
			bold: (s: string) => s,
			dim: (s: string) => s,
		},
	}
})

import { runConnect, runInit, runShare, runStart } from '../commands.js'

const CONFIG = {
	daemon: 'auto',
	peers: [],
	autoDiscover: true,
	auth: { enabled: false, token: '' },
	adminSocket: { host: 'localhost', port: 9001 },
}

let tmpDir: string
let origCwd: string

describe('commands orchestration', () => {
	beforeEach(() => {
		tmpDir = join(tmpdir(), `yggl-orch-${Date.now()}`)
		mkdirSync(tmpDir, { recursive: true })
		origCwd = process.cwd()
		process.chdir(tmpDir)
		process.removeAllListeners('SIGINT')
		process.removeAllListeners('SIGTERM')
		vi.restoreAllMocks()
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

		mocks.adminGetSelf.mockReset()
		mocks.connectStart.mockReset()
		mocks.connectStop.mockReset()
		mocks.daemonDetect.mockReset()
		mocks.daemonStart.mockReset()
		mocks.daemonStop.mockReset()
		mocks.initYggstackConf.mockReset()
		mocks.loadConfig.mockReset()
		mocks.shareStart.mockReset()
		mocks.shareStop.mockReset()
		mocks.spinnerStart.mockReset()
		mocks.spinnerStop.mockReset()
		mocks.writeDefaultConfig.mockReset()

		mocks.loadConfig.mockReturnValue(CONFIG)
		mocks.daemonDetect.mockResolvedValue({ adopted: false, binaryPath: '/fake/yggstack' })
		mocks.daemonStart.mockResolvedValue('spawned-bundled')
		mocks.adminGetSelf.mockResolvedValue({
			address: '200:1234::1',
			publicKey: 'pub',
			buildName: 'yggstack',
			buildVersion: '1.0.5',
		})
		mocks.shareStart.mockResolvedValue({
			address: '200:1234::1',
			port: 3000,
			url: 'http://[200:1234::1]:3000',
			token: 'tok',
		})
		mocks.connectStart.mockResolvedValue({ localPort: 8080 })
	})

	afterEach(() => {
		process.chdir(origCwd)
		process.removeAllListeners('SIGINT')
		process.removeAllListeners('SIGTERM')
		rmSync(tmpDir, { recursive: true, force: true })
	})

	it('runInit writes config and initializes keys', async () => {
		await runInit('cfg.json')

		expect(mocks.writeDefaultConfig).toHaveBeenCalledWith('cfg.json')
		expect(mocks.daemonDetect).toHaveBeenCalledWith(CONFIG)
		expect(mocks.initYggstackConf).toHaveBeenCalledWith('/fake/yggstack')
		expect(mocks.spinnerStart).toHaveBeenCalled()
		expect(mocks.spinnerStop).toHaveBeenCalled()
		expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Config:'))
	})

	it('runInit rejects if daemon is already running', async () => {
		mocks.daemonDetect.mockResolvedValue({ adopted: true })
		await expect(runInit('cfg.json')).rejects.toThrow('A daemon is already running')
	})

	it('runStart prints status, writes pid, and cleans up on SIGINT', async () => {
		void runStart('cfg.json')
		await vi.waitFor(() =>
			expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Yggdrasil is running')),
		)
		expect(readFileSync(join('.yggl', 'yggl.pid'), 'utf8').trim()).toBe(String(process.pid))

		process.emit('SIGINT')
		await vi.waitFor(() => expect(mocks.daemonStop).toHaveBeenCalled())
	})

	it('runShare prints URL and token, writes pid, and cleans up on SIGTERM', async () => {
		void runShare({ port: 3000, auth: true, token: 'tok', allow: 'k1,k2', config: 'cfg.json' })
		await vi.waitFor(() =>
			expect(mocks.shareStart).toHaveBeenCalledWith(CONFIG, {
				port: 3000,
				auth: true,
				token: 'tok',
				allowKeys: ['k1', 'k2'],
			}),
		)
		expect(readFileSync(join('.yggl', 'yggl.pid'), 'utf8').trim()).toBe(String(process.pid))
		expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Sharing port 3000'))
		expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Token:'))

		process.emit('SIGTERM')
		await vi.waitFor(() => expect(mocks.shareStop).toHaveBeenCalled())
	})

	it('runConnect parses target and prints forwarding info', async () => {
		void runConnect({ target: '[200:abcd::1]:9000', localPort: 8080, config: 'cfg.json' })
		await vi.waitFor(() =>
			expect(mocks.connectStart).toHaveBeenCalledWith(CONFIG, {
				remoteAddress: '200:abcd::1',
				remotePort: 9000,
				localPort: 8080,
			}),
		)
		expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Port forwarding active'))

		process.emit('SIGINT')
		await vi.waitFor(() => expect(mocks.connectStop).toHaveBeenCalled())
	})
})
