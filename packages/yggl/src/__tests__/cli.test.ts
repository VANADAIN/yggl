import { beforeEach, describe, expect, it, vi } from 'vitest'

const commandFns = vi.hoisted(() => ({
	runConnect: vi.fn(async () => {}),
	runInit: vi.fn(async () => {}),
	runPeersAdd: vi.fn(async () => {}),
	runPeersList: vi.fn(async () => {}),
	runPeersRemove: vi.fn(async () => {}),
	runShare: vi.fn(async () => {}),
	runStart: vi.fn(async () => {}),
	runStatus: vi.fn(async () => {}),
	runStop: vi.fn(async () => {}),
}))

vi.mock('../commands.js', () => commandFns)

import { guard, main } from '../cli.js'

type TestCommand = {
	run: (ctx?: { args?: Record<string, string | boolean> }) => Promise<void>
	subCommands?: Record<string, TestCommand>
}

const cli = main as unknown as TestCommand & {
	subCommands: Record<string, TestCommand>
}

describe('guard', () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it('passes through successful execution', async () => {
		const fn = vi.fn(async () => {})
		await guard(fn)()
		expect(fn).toHaveBeenCalled()
	})

	it('prints error and exits on failure', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

		await guard(async () => {
			throw new Error('boom')
		})()

		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'))
		expect(exitSpy).toHaveBeenCalledWith(1)
	})
})

describe('cli command wiring', () => {
	beforeEach(() => {
		Object.values(commandFns).forEach((fn) => {
			fn.mockClear()
		})
	})

	it('wires init command', async () => {
		await cli.subCommands.init.run({ args: { config: 'cfg.json' } })
		expect(commandFns.runInit).toHaveBeenCalledWith('cfg.json')
	})

	it('wires start command', async () => {
		await cli.subCommands.start.run({ args: { config: 'cfg.json' } })
		expect(commandFns.runStart).toHaveBeenCalledWith('cfg.json')
	})

	it('wires share command with parsed options', async () => {
		await cli.subCommands.share.run({
			args: {
				config: 'cfg.json',
				port: '3000',
				auth: true,
				token: 'abc',
				allow: 'k1,k2',
			},
		})

		expect(commandFns.runShare).toHaveBeenCalledWith({
			port: 3000,
			auth: true,
			token: 'abc',
			allow: 'k1,k2',
			config: 'cfg.json',
		})
	})

	it('wires connect command with parsed local port', async () => {
		await cli.subCommands.connect.run({
			args: { config: 'cfg.json', target: '[200::1]:9000', 'local-port': '8080' },
		})

		expect(commandFns.runConnect).toHaveBeenCalledWith({
			target: '[200::1]:9000',
			config: 'cfg.json',
			localPort: 8080,
		})
	})

	it('wires status and stop commands', async () => {
		await cli.subCommands.status.run({ args: { config: 'cfg.json' } })
		await cli.subCommands.stop.run()

		expect(commandFns.runStatus).toHaveBeenCalledWith('cfg.json')
		expect(commandFns.runStop).toHaveBeenCalled()
	})

	it('wires peers subcommands', async () => {
		const peers = cli.subCommands.peers.subCommands as Record<string, TestCommand>

		await peers.list.run({ args: { config: 'cfg.json' } })
		await peers.add.run({
			args: { config: 'cfg.json', uri: 'tls://peer:443' },
		})
		await peers.remove.run({
			args: { config: 'cfg.json', uri: 'tls://peer:443' },
		})

		expect(commandFns.runPeersList).toHaveBeenCalledWith('cfg.json')
		expect(commandFns.runPeersAdd).toHaveBeenCalledWith('cfg.json', 'tls://peer:443')
		expect(commandFns.runPeersRemove).toHaveBeenCalledWith('cfg.json', 'tls://peer:443')
	})
})
