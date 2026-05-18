import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		exclude: ['**/node_modules/**', '**/dist/**', '**/integration/**'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html', 'lcov'],
			reportsDirectory: './coverage/unit',
			include: ['src/**/*.ts'],
			exclude: ['src/__tests__/**'],
		},
	},
})
