#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineCommand, runMain } from 'citty'
import {
	runConnect,
	runDoctor,
	runInit,
	runLocalGet,
	runLocalList,
	runLocalSet,
	runLocalUnset,
	runPeersAdd,
	runPeersList,
	runPeersRemove,
	runShare,
	runStart,
	runStatus,
	runStop,
} from './commands.js'
import { CONFIG_FILENAME } from './config.js'
import { c } from './ui.js'

export function guard(fn: () => Promise<void>): () => Promise<void> {
	return async () => {
		try {
			await fn()
		} catch (err) {
			console.error(c.red(`✗ ${err instanceof Error ? err.message : String(err)}`))
			process.exit(1)
		}
	}
}

const configArg = {
	config: {
		type: 'string' as const,
		default: CONFIG_FILENAME,
		description: 'Path to yggl.config.json',
	},
}

export const main = defineCommand({
	meta: {
		name: 'yggl',
		version: '0.1.0',
		description: 'Shared developer environment over the Yggdrasil network',
	},
	subCommands: {
		init: defineCommand({
			meta: { description: 'Initialize yggl in the current directory' },
			args: configArg,
			run: ({ args }) => guard(() => runInit(args.config))(),
		}),

		start: defineCommand({
			meta: { description: 'Start the Yggdrasil daemon' },
			args: configArg,
			run: ({ args }) => guard(() => runStart(args.config))(),
		}),

		share: defineCommand({
			meta: { description: 'Share a local port over Yggdrasil' },
			args: {
				...configArg,
				port: {
					type: 'positional' as const,
					description: 'Local port to share',
					required: true,
				},
				auth: {
					type: 'boolean' as const,
					description: 'Enable bearer token authentication',
				},
				token: {
					type: 'string' as const,
					description: 'Bearer token (auto-generated if --auth and not provided)',
				},
				allow: {
					type: 'string' as const,
					description: 'Comma-separated Yggdrasil public keys to allowlist',
				},
			},
			run: ({ args }) =>
				guard(() =>
					runShare({
						port: Number(args.port),
						config: args.config,
						...(args.auth !== undefined ? { auth: args.auth } : {}),
						...(args.token ? { token: args.token } : {}),
						...(args.allow ? { allow: args.allow } : {}),
					}),
				)(),
		}),

		connect: defineCommand({
			meta: { description: 'Forward a remote Yggdrasil port to localhost' },
			args: {
				...configArg,
				target: {
					type: 'positional' as const,
					description: 'Remote address and port, e.g. [200:xxxx::1]:3000',
					required: true,
				},
				'local-port': {
					type: 'string' as const,
					description: 'Local port to listen on (defaults to remote port)',
				},
			},
			run: ({ args }) =>
				guard(() =>
					runConnect({
						target: args.target,
						config: args.config,
						...(args['local-port'] ? { localPort: Number(args['local-port']) } : {}),
					}),
				)(),
		}),

		status: defineCommand({
			meta: { description: 'Show Yggdrasil node status' },
			args: configArg,
			run: ({ args }) => guard(() => runStatus(args.config))(),
		}),

		peers: defineCommand({
			meta: { description: 'Manage peers' },
			subCommands: {
				list: defineCommand({
					meta: { description: 'List configured peers' },
					args: configArg,
					run: ({ args }) => guard(() => runPeersList(args.config))(),
				}),
				add: defineCommand({
					meta: { description: 'Add a peer URI' },
					args: {
						...configArg,
						uri: {
							type: 'positional' as const,
							description: 'Peer URI (e.g. tls://example.com:443)',
							required: true,
						},
					},
					run: ({ args }) => guard(() => runPeersAdd(args.config, args.uri))(),
				}),
				remove: defineCommand({
					meta: { description: 'Remove a peer URI' },
					args: {
						...configArg,
						uri: {
							type: 'positional' as const,
							description: 'Peer URI to remove',
							required: true,
						},
					},
					run: ({ args }) => guard(() => runPeersRemove(args.config, args.uri))(),
				}),
			},
		}),

		stop: defineCommand({
			meta: { description: 'Stop the yggl daemon' },
			args: configArg,
			run: ({ args }) => guard(() => runStop(args.config))(),
		}),

		local: defineCommand({
			meta: { description: 'Manage local machine-only values for this project' },
			subCommands: {
				set: defineCommand({
					meta: { description: 'Set a local value' },
					args: {
						...configArg,
						key: {
							type: 'positional' as const,
							description: 'Local key (auth-token, identity-mode)',
							required: true,
						},
						value: {
							type: 'positional' as const,
							description: 'Value to store',
							required: true,
						},
					},
					run: ({ args }) => guard(() => runLocalSet(args.key, args.value, args.config))(),
				}),
				get: defineCommand({
					meta: { description: 'Get a local value' },
					args: {
						...configArg,
						key: {
							type: 'positional' as const,
							description: 'Local key (auth-token, identity-mode)',
							required: true,
						},
						'show-secret': {
							type: 'boolean' as const,
							default: false,
							description: 'Print secret values instead of masked output',
						},
					},
					run: ({ args }) => guard(() => runLocalGet(args.key, args.config, args['show-secret']))(),
				}),
				unset: defineCommand({
					meta: { description: 'Remove a local value' },
					args: {
						...configArg,
						key: {
							type: 'positional' as const,
							description: 'Local key (auth-token, identity-mode)',
							required: true,
						},
					},
					run: ({ args }) => guard(() => runLocalUnset(args.key, args.config))(),
				}),
				list: defineCommand({
					meta: { description: 'List local values for this project' },
					args: configArg,
					run: ({ args }) => guard(() => runLocalList(args.config))(),
				}),
			},
		}),

		doctor: defineCommand({
			meta: { description: 'Show effective paths and local configuration sources' },
			args: configArg,
			run: ({ args }) => guard(() => runDoctor(args.config))(),
		}),
	},
})

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	runMain(main)
}
