export const version = '0.1.0'
export type { AdminClientDeps, PeerInfo, SelfInfo, SessionInfo } from './admin.js'
export { AdminClient, AdminError } from './admin.js'
export type { BinaryResolverDeps, DaemonMode } from './binary.js'
export { BinaryNotFoundError, resolveBinary } from './binary.js'
export type { AdminSocketConfig, AuthConfig, YgglConfig } from './config.js'
export {
	CONFIG_FILENAME,
	ConfigError,
	DEFAULT_CONFIG,
	DEFAULT_PEERS,
	loadConfig,
	validateConfig,
	writeDefaultConfig,
} from './config.js'
export type { ConnectManagerDeps, ConnectOptions, ConnectResult } from './connect.js'
export { ConnectError, ConnectManager, parseConnectTarget } from './connect.js'
export type { DaemonSource, DetectionDeps, DetectionResult } from './daemon.js'
export {
	DaemonError,
	DaemonManager,
	detectDaemon,
	initYggstackConf,
	YGGL_DIR,
	YGGSTACK_CONF,
} from './daemon.js'
export type { ShareManagerDeps, ShareOptions, ShareResult } from './share.js'
export { createTokenProxy, generateToken, ShareError, ShareManager } from './share.js'
export type { MulticastInterface, YggstackConfig } from './yggstack-conf.js'
export {
	DEFAULT_MULTICAST_INTERFACE,
	mergeYggstackConfig,
	parseYggstackConfig,
} from './yggstack-conf.js'
