import { describe, expect, it } from 'vitest'
import { version } from '../index.js'

describe('yggl', () => {
	it('exports version', () => {
		expect(version).toBe('0.1.0')
	})
})
