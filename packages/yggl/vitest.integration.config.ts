import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/__tests__/integration/**/*.test.ts'],
		testTimeout: 60_000,
		hookTimeout: 30_000,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html', 'lcov'],
			reportsDirectory: './coverage/integration',
			include: ['src/**/*.ts'],
			exclude: ['src/__tests__/**'],
		},
	},
})
