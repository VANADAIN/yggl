#!/usr/bin/env node
/**
 * Downloads yggstack binaries from GitHub releases into platform packages.
 * Run: node scripts/download-binaries.mjs
 * Run (specific platform only): node scripts/download-binaries.mjs darwin-arm64
 */

import { chmodSync, createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const YGGSTACK_VERSION = '1.0.5'
const REPO = 'yggdrasil-network/yggstack'
const __dirname = dirname(fileURLToPath(import.meta.url))
const PACKAGES_DIR = join(__dirname, '..', 'packages')

const PLATFORMS = {
	'darwin-arm64': { asset: 'yggstack-darwin-arm64', binary: 'yggstack' },
	'darwin-x64': { asset: 'yggstack-darwin-amd64', binary: 'yggstack' },
	'linux-x64': { asset: 'yggstack-linux-amd64-static', binary: 'yggstack' },
	'linux-arm64': { asset: 'yggstack-linux-arm64-static', binary: 'yggstack' },
	'win32-x64': { asset: 'yggstack-windows-amd64.exe', binary: 'yggstack.exe' },
}

async function download(url, destPath) {
	let response = await fetch(url, { redirect: 'follow' })

	// Follow redirects manually if needed (GitHub → S3)
	while (response.status === 301 || response.status === 302 || response.status === 307) {
		const location = response.headers.get('location')
		if (!location) break
		response = await fetch(location, { redirect: 'follow' })
	}

	if (!response.ok) {
		throw new Error(`HTTP ${response.status} downloading ${url}`)
	}

	const file = createWriteStream(destPath)
	await pipeline(Readable.fromWeb(response.body), file)
}

async function downloadPlatform(platformKey) {
	const { asset, binary } = PLATFORMS[platformKey]
	const pkgName = `yggl-${platformKey}`
	const binDir = join(PACKAGES_DIR, pkgName, 'bin')
	const destPath = join(binDir, binary)

	if (existsSync(destPath)) {
		console.log(`  skip  ${pkgName} (already exists)`)
		return
	}

	mkdirSync(binDir, { recursive: true })

	const url = `https://github.com/${REPO}/releases/download/${YGGSTACK_VERSION}/${asset}`
	console.log(`  fetch ${pkgName} ← ${asset}`)

	await download(url, destPath)

	if (binary !== 'yggstack.exe') {
		chmodSync(destPath, 0o755)
	}

	console.log(`  done  ${pkgName}`)
}

const filter = process.argv[2]
const targets = filter ? Object.keys(PLATFORMS).filter((k) => k === filter) : Object.keys(PLATFORMS)

if (targets.length === 0) {
	console.error(`Unknown platform: ${filter}`)
	console.error(`Valid: ${Object.keys(PLATFORMS).join(', ')}`)
	process.exit(1)
}

console.log(`Downloading yggstack ${YGGSTACK_VERSION}...`)
for (const platform of targets) {
	await downloadPlatform(platform)
}
console.log('Done.')
