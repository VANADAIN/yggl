import { defineConfig } from 'vite'

export default defineConfig({
	server: {
		// Proxy /api requests to the backend.
		// When using yggl connect, the backend is forwarded to localhost:3001.
		proxy: {
			'/api': 'http://localhost:3001',
		},
	},
})
