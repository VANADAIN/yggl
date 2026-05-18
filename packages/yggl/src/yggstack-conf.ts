import type { YgglConfig } from './config.js'

export interface MulticastInterface {
	Regex: string
	Beacon: boolean
	Listen: boolean
	Port: number
	Priority: number
	Password: string
}

export interface YggstackConfig {
	Peers: string[]
	Listen: string[]
	InterfacePeers: Record<string, string[]>
	AllowedPublicKeys: string[]
	PublicKey: string
	PrivateKey: string
	IfName: string
	IfMTU: number
	MulticastInterfaces: MulticastInterface[]
	NodeInfo: Record<string, unknown>
	NodeInfoPrivacy: boolean
	AdminListen: string
	Log: string
}

export const DEFAULT_MULTICAST_INTERFACE: MulticastInterface = {
	Regex: '.*',
	Beacon: true,
	Listen: true,
	Port: 0,
	Priority: 0,
	Password: '',
}

export function mergeYggstackConfig(base: YggstackConfig, yggl: YgglConfig): YggstackConfig {
	return {
		...base,
		Peers: yggl.peers,
		MulticastInterfaces: yggl.autoDiscover ? [DEFAULT_MULTICAST_INTERFACE] : [],
		AdminListen: `tcp://${yggl.adminSocket.host}:${yggl.adminSocket.port}`,
	}
}

export function parseYggstackConfig(raw: string): YggstackConfig {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		throw new Error('Failed to parse yggstack config: invalid JSON')
	}

	if (typeof parsed !== 'object' || parsed === null) {
		throw new Error('Failed to parse yggstack config: not an object')
	}

	const r = parsed as Record<string, unknown>

	if (typeof r.PrivateKey !== 'string' || r.PrivateKey.length === 0) {
		throw new Error('yggstack config missing PrivateKey — run `yggl init` to generate one')
	}

	return {
		Peers: Array.isArray(r.Peers) ? (r.Peers as string[]) : [],
		Listen: Array.isArray(r.Listen) ? (r.Listen as string[]) : [],
		InterfacePeers:
			typeof r.InterfacePeers === 'object' && r.InterfacePeers !== null
				? (r.InterfacePeers as Record<string, string[]>)
				: {},
		AllowedPublicKeys: Array.isArray(r.AllowedPublicKeys) ? (r.AllowedPublicKeys as string[]) : [],
		PublicKey: typeof r.PublicKey === 'string' ? r.PublicKey : '',
		PrivateKey: r.PrivateKey,
		IfName: typeof r.IfName === 'string' ? r.IfName : 'auto',
		IfMTU: typeof r.IfMTU === 'number' ? r.IfMTU : 65535,
		MulticastInterfaces: Array.isArray(r.MulticastInterfaces)
			? (r.MulticastInterfaces as MulticastInterface[])
			: [],
		NodeInfo:
			typeof r.NodeInfo === 'object' && r.NodeInfo !== null
				? (r.NodeInfo as Record<string, unknown>)
				: {},
		NodeInfoPrivacy: typeof r.NodeInfoPrivacy === 'boolean' ? r.NodeInfoPrivacy : false,
		AdminListen: typeof r.AdminListen === 'string' ? r.AdminListen : 'tcp://localhost:9001',
		Log: typeof r.Log === 'string' ? r.Log : 'stdout',
	}
}
