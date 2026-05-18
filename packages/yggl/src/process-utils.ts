import { type ChildProcess, spawn } from 'node:child_process'

export type SpawnProcess = (binaryPath: string, args: string[]) => ChildProcess

export function createSpawnProcess(spawnProcess?: SpawnProcess): SpawnProcess {
	return (
		spawnProcess ??
		((cmd: string, args: string[]) =>
			spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: false }))
	)
}

export function forwardChildOutput(proc: ChildProcess, label = 'yggstack'): void {
	proc.stdout?.on('data', (data: Buffer) => process.stderr.write(`[${label}] ${data}`))
	proc.stderr?.on('data', (data: Buffer) => process.stderr.write(`[${label}] ${data}`))
}

export async function stopChildProcess(
	proc: ChildProcess | null,
	timeoutMs = 5000,
): Promise<ChildProcess | null> {
	if (!proc) return null

	proc.kill('SIGTERM')
	await new Promise<void>((resolve) => {
		proc.once('exit', () => resolve())
		setTimeout(resolve, timeoutMs)
	})
	return null
}
