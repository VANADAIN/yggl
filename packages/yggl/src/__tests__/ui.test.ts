import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { c, formatBytes, formatUptime, Spinner } from '../ui.js'

describe('ui colors', () => {
	it('wraps text with ANSI escape codes', () => {
		expect(c.green('ok')).toBe('\x1b[32mok\x1b[0m')
		expect(c.red('bad')).toBe('\x1b[31mbad\x1b[0m')
		expect(c.yellow('warn')).toBe('\x1b[33mwarn\x1b[0m')
		expect(c.cyan('info')).toBe('\x1b[36minfo\x1b[0m')
		expect(c.bold('x')).toBe('\x1b[1mx\x1b[0m')
		expect(c.dim('x')).toBe('\x1b[2mx\x1b[0m')
	})
})

describe('formatBytes', () => {
	it('formats bytes below 1KB', () => {
		expect(formatBytes(0)).toBe('0B')
		expect(formatBytes(999)).toBe('999B')
	})

	it('formats kilobytes and megabytes', () => {
		expect(formatBytes(1024)).toBe('1.0KB')
		expect(formatBytes(1536)).toBe('1.5KB')
		expect(formatBytes(1024 * 1024)).toBe('1.0MB')
	})
})

describe('formatUptime', () => {
	it('formats seconds, minutes, and hours', () => {
		expect(formatUptime(59)).toBe('59s')
		expect(formatUptime(60)).toBe('1m')
		expect(formatUptime(3599)).toBe('59m')
		expect(formatUptime(3600)).toBe('1h0m')
		expect(formatUptime(3661)).toBe('1h1m')
	})
})

describe('Spinner', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it('writes frames on start and clears on stop', () => {
		const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const spinner = new Spinner()

		spinner.start('Working')
		vi.advanceTimersByTime(160)
		spinner.stop('Done')

		expect(writeSpy).toHaveBeenCalledWith('\r⠋  Working')
		expect(writeSpy).toHaveBeenCalledWith('\r⠙  Working')
		expect(writeSpy).toHaveBeenCalledWith('\r\x1b[K')
		expect(logSpy).toHaveBeenCalledWith('Done')
	})

	it('stops without final line', () => {
		const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const spinner = new Spinner()

		spinner.start('Working')
		spinner.stop()

		expect(writeSpy).toHaveBeenCalledWith('\r\x1b[K')
		expect(logSpy).not.toHaveBeenCalled()
	})
})
