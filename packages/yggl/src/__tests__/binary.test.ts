import { describe, expect, it } from 'vitest'
import { BinaryNotFoundError, resolveBinary } from '../binary.js'

const BUNDLED_PATH = '/fake/node_modules/yggl-darwin-arm64/bin/yggstack'
const SYSTEM_PATH = '/usr/local/bin/yggstack'

const found = (path: string) => () => path
const missing = () => null
const exists = () => true
const notExists = () => false
const executable = () => true
const notExecutable = () => false

const darwinArm64 = { platform: 'darwin', arch: 'arm64' }

describe('resolveBinary — bundled mode', () => {
	it('returns bundled path when package is installed', () => {
		const result = resolveBinary('bundled', {
			...darwinArm64,
			findBundled: found(BUNDLED_PATH),
		})
		expect(result).toBe(BUNDLED_PATH)
	})

	it('throws when bundled package is missing', () => {
		expect(() =>
			resolveBinary('bundled', {
				...darwinArm64,
				findBundled: missing,
			}),
		).toThrow(BinaryNotFoundError)
	})

	it('throws for unsupported platform', () => {
		expect(() =>
			resolveBinary('bundled', {
				platform: 'freebsd',
				arch: 'x64',
				findBundled: found(BUNDLED_PATH),
			}),
		).toThrow(BinaryNotFoundError)
	})
})

describe('resolveBinary — system mode', () => {
	it('returns system path when found in PATH', () => {
		const result = resolveBinary('system', {
			...darwinArm64,
			findInPath: found(SYSTEM_PATH),
		})
		expect(result).toBe(SYSTEM_PATH)
	})

	it('throws when not found in PATH', () => {
		expect(() =>
			resolveBinary('system', {
				...darwinArm64,
				findInPath: missing,
			}),
		).toThrow(BinaryNotFoundError)
	})
})

describe('resolveBinary — auto mode', () => {
	it('prefers bundled over system', () => {
		const result = resolveBinary('auto', {
			...darwinArm64,
			findBundled: found(BUNDLED_PATH),
			findInPath: found(SYSTEM_PATH),
		})
		expect(result).toBe(BUNDLED_PATH)
	})

	it('falls back to system when bundled missing', () => {
		const result = resolveBinary('auto', {
			...darwinArm64,
			findBundled: missing,
			findInPath: found(SYSTEM_PATH),
		})
		expect(result).toBe(SYSTEM_PATH)
	})

	it('throws when both bundled and system are missing', () => {
		expect(() =>
			resolveBinary('auto', {
				...darwinArm64,
				findBundled: missing,
				findInPath: missing,
			}),
		).toThrow(BinaryNotFoundError)
	})

	it('skips bundled lookup on unsupported platform, falls back to system', () => {
		const result = resolveBinary('auto', {
			platform: 'freebsd',
			arch: 'x64',
			findBundled: found(BUNDLED_PATH),
			findInPath: found(SYSTEM_PATH),
		})
		expect(result).toBe(SYSTEM_PATH)
	})
})

describe('resolveBinary — custom path mode', () => {
	it('returns custom path when file exists and is executable', () => {
		const result = resolveBinary('/custom/yggstack', {
			fileExists: exists,
			isExecutable: executable,
		})
		expect(result).toBe('/custom/yggstack')
	})

	it('throws when custom path does not exist', () => {
		expect(() =>
			resolveBinary('/custom/yggstack', {
				fileExists: notExists,
				isExecutable: executable,
			}),
		).toThrow(BinaryNotFoundError)
	})

	it('throws when custom path is not executable', () => {
		expect(() =>
			resolveBinary('/custom/yggstack', {
				fileExists: exists,
				isExecutable: notExecutable,
			}),
		).toThrow(BinaryNotFoundError)
	})
})

describe('resolveBinary — binary name', () => {
	it('uses .exe suffix on win32', () => {
		let capturedBinaryName = ''
		resolveBinary('bundled', {
			platform: 'win32',
			arch: 'x64',
			findBundled: (_, name) => {
				capturedBinaryName = name
				return '/fake/yggstack.exe'
			},
		})
		expect(capturedBinaryName).toBe('yggstack.exe')
	})

	it('uses no suffix on unix', () => {
		let capturedBinaryName = ''
		resolveBinary('bundled', {
			...darwinArm64,
			findBundled: (_, name) => {
				capturedBinaryName = name
				return BUNDLED_PATH
			},
		})
		expect(capturedBinaryName).toBe('yggstack')
	})
})
