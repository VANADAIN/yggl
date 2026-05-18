import { beforeEach, describe, expect, it, vi } from 'vitest'

const commandFns = vi.hoisted(() => ({
	runDoctor: vi.fn(async () => {}),
	runConnect: vi.fn(async () => {}),
	runInit: vi.fn(async () => {}),
	runLocalGet: vi.fn(async () => {}),
	runLocalList: vi.fn(async () => {}),
	runLocalSet: vi.fn(async () => {}),
	runLocalUnset: vi.fn(async () => {}),
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

function getCommand(command: TestCommand | undefined, name: string): TestCommand {
	expect(command, `Missing CLI command: ${name}`).toBeDefined()
	return command as TestCommand
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
		await getCommand(cli.subCommands.init, 'init').run({ args: { config: 'cfg.json' } })
		expect(commandFns.runInit).toHaveBeenCalledWith('cfg.json')
	})

	it('wires start command', async () => {
		await getCommand(cli.subCommands.start, 'start').run({ args: { config: 'cfg.json' } })
		expect(commandFns.runStart).toHaveBeenCalledWith('cfg.json')
	})

	it('wires share command with parsed options', async () => {
		await getCommand(cli.subCommands.share, 'share').run({
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
		await getCommand(cli.subCommands.connect, 'connect').run({
			args: { config: 'cfg.json', target: '[200::1]:9000', 'local-port': '8080' },
		})

		expect(commandFns.runConnect).toHaveBeenCalledWith({
			target: '[200::1]:9000',
			config: 'cfg.json',
			localPort: 8080,
		})
	})

	it('wires status and stop commands', async () => {
		await getCommand(cli.subCommands.status, 'status').run({ args: { config: 'cfg.json' } })
		await getCommand(cli.subCommands.stop, 'stop').run({ args: { config: 'cfg.json' } })

		expect(commandFns.runStatus).toHaveBeenCalledWith('cfg.json')
		expect(commandFns.runStop).toHaveBeenCalledWith('cfg.json')
	})

	it('wires peers subcommands', async () => {
		const peersCommand = getCommand(cli.subCommands.peers, 'peers')
		const peers = (peersCommand.subCommands ?? {}) as Record<string, TestCommand>

		await getCommand(peers.list, 'peers.list').run({ args: { config: 'cfg.json' } })
		await getCommand(peers.add, 'peers.add').run({
			args: { config: 'cfg.json', uri: 'tls://peer:443' },
		})
		await getCommand(peers.remove, 'peers.remove').run({
			args: { config: 'cfg.json', uri: 'tls://peer:443' },
		})

		expect(commandFns.runPeersList).toHaveBeenCalledWith('cfg.json')
		expect(commandFns.runPeersAdd).toHaveBeenCalledWith('cfg.json', 'tls://peer:443')
		expect(commandFns.runPeersRemove).toHaveBeenCalledWith('cfg.json', 'tls://peer:443')
	})

	it('wires local subcommands and doctor', async () => {
		const localCommand = getCommand(cli.subCommands.local, 'local')
		const local = (localCommand.subCommands ?? {}) as Record<string, TestCommand>

		await getCommand(local.set, 'local.set').run({
			args: { config: 'cfg.json', key: 'auth-token', value: 'secret' },
		})
		await getCommand(local.get, 'local.get').run({
			args: { config: 'cfg.json', key: 'auth-token', 'show-secret': true },
		})
		await getCommand(local.unset, 'local.unset').run({
			args: { config: 'cfg.json', key: 'auth-token' },
		})
		await getCommand(local.list, 'local.list').run({ args: { config: 'cfg.json' } })
		await getCommand(cli.subCommands.doctor, 'doctor').run({ args: { config: 'cfg.json' } })

		expect(commandFns.runLocalSet).toHaveBeenCalledWith('auth-token', 'secret', 'cfg.json')
		expect(commandFns.runLocalGet).toHaveBeenCalledWith('auth-token', 'cfg.json', true)
		expect(commandFns.runLocalUnset).toHaveBeenCalledWith('auth-token', 'cfg.json')
		expect(commandFns.runLocalList).toHaveBeenCalledWith('cfg.json')
		expect(commandFns.runDoctor).toHaveBeenCalledWith('cfg.json')
	})
})
