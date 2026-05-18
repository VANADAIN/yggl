const CSI = '\x1b['

export const c = {
	green: (s: string) => `${CSI}32m${s}${CSI}0m`,
	red: (s: string) => `${CSI}31m${s}${CSI}0m`,
	yellow: (s: string) => `${CSI}33m${s}${CSI}0m`,
	cyan: (s: string) => `${CSI}36m${s}${CSI}0m`,
	bold: (s: string) => `${CSI}1m${s}${CSI}0m`,
	dim: (s: string) => `${CSI}2m${s}${CSI}0m`,
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export class Spinner {
	private iv: ReturnType<typeof setInterval> | null = null
	private i = 0

	start(text: string): void {
		this.i = 0
		this.iv = setInterval(() => {
			process.stdout.write(`\r${FRAMES[this.i++ % FRAMES.length]}  ${text}`)
		}, 80)
	}

	stop(finalLine?: string): void {
		if (this.iv) {
			clearInterval(this.iv)
			this.iv = null
		}
		process.stdout.write(`\r${CSI}K`)
		if (finalLine) console.log(finalLine)
	}
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n}B`
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
	return `${(n / 1024 / 1024).toFixed(1)}MB`
}

export function formatUptime(seconds: number): string {
	const s = Math.floor(seconds)
	if (s < 60) return `${s}s`
	if (s < 3600) return `${Math.floor(s / 60)}m`
	return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
}
