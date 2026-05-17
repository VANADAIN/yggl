import { execSync } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type DaemonMode = 'auto' | 'bundled' | 'system' | (string & {})

export class BinaryNotFoundError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'BinaryNotFoundError'
	}
}

const PLATFORM_PACKAGES: Partial<Record<string, string>> = {
	'darwin-arm64': 'yggl-darwin-arm64',
	'darwin-x64': 'yggl-darwin-x64',
	'linux-x64': 'yggl-linux-x64',
	'linux-arm64': 'yggl-linux-arm64',
	'win32-x64': 'yggl-win32-x64',
}

export interface BinaryResolverDeps {
	platform?: string
	arch?: string
	findBundled?: (pkgName: string, binaryName: string) => string | null
	findInPath?: () => string | null
	fileExists?: (p: string) => boolean
	isExecutable?: (p: string) => boolean
}

function defaultFindBundled(pkgName: string, binaryName: string): string | null {
	const require = createRequire(import.meta.url)
	try {
		const pkgJsonPath = require.resolve(`${pkgName}/package.json`)
		const pkgDir = fileURLToPath(new URL('.', `file://${pkgJsonPath}`))
		const binPath = join(pkgDir, 'bin', binaryName)
		return existsSync(binPath) ? binPath : null
	} catch {
		return null
	}
}

function defaultFindInPath(): string | null {
	const cmd = process.platform === 'win32' ? 'where yggstack' : 'which yggstack'
	try {
		const result = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] })
		return result.toString().trim().split('\n')[0] ?? null
	} catch {
		return null
	}
}

function defaultIsExecutable(p: string): boolean {
	if (process.platform === 'win32') return true
	try {
		accessSync(p, constants.X_OK)
		return true
	} catch {
		return false
	}
}

export function resolveBinary(mode: DaemonMode = 'auto', deps: BinaryResolverDeps = {}): string {
	const platform = deps.platform ?? process.platform
	const arch = deps.arch ?? process.arch
	const findBundled = deps.findBundled ?? defaultFindBundled
	const findInPath = deps.findInPath ?? defaultFindInPath
	const fileExists = deps.fileExists ?? existsSync
	const isExecutable = deps.isExecutable ?? defaultIsExecutable

	const platformKey = `${platform}-${arch}`
	const pkgName = PLATFORM_PACKAGES[platformKey]
	const binaryName = platform === 'win32' ? 'yggstack.exe' : 'yggstack'

	if (mode === 'bundled') {
		if (!pkgName) {
			throw new BinaryNotFoundError(
				`No bundled binary available for platform: ${platformKey}\n` +
					`Supported: ${Object.keys(PLATFORM_PACKAGES).join(', ')}`,
			)
		}
		const path = findBundled(pkgName, binaryName)
		if (!path) {
			throw new BinaryNotFoundError(
				`Bundled yggstack not found. Install the platform package:\n  npm install ${pkgName}`,
			)
		}
		return path
	}

	if (mode === 'system') {
		const path = findInPath()
		if (!path) {
			throw new BinaryNotFoundError(
				`yggstack not found in PATH.\n` +
					`Install it from: https://github.com/yggdrasil-network/yggstack/releases`,
			)
		}
		return path
	}

	if (mode === 'auto') {
		if (pkgName) {
			const bundled = findBundled(pkgName, binaryName)
			if (bundled) return bundled
		}
		const system = findInPath()
		if (system) return system
		throw new BinaryNotFoundError(
			`yggstack not found. Either:\n` +
				`  1. Install yggl with npm/pnpm (includes bundled binary)\n` +
				`  2. Install yggstack manually: https://github.com/yggdrasil-network/yggstack/releases\n` +
				`  3. Set daemon path in yggl.config.json`,
		)
	}

	// Custom path
	if (!fileExists(mode)) {
		throw new BinaryNotFoundError(`Binary not found at: ${mode}`)
	}
	if (!isExecutable(mode)) {
		throw new BinaryNotFoundError(`File is not executable: ${mode}`)
	}
	return mode
}
