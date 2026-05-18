import express from 'express'

const PORT = process.env.PORT ?? 3001

const app = express()

app.get('/api/hello', (req, res) => {
	res.json({
		message: 'Hello from the shared backend!',
		timestamp: new Date().toISOString(),
		host: req.hostname,
	})
})

app.get('/api/items', (_req, res) => {
	res.json([
		{ id: 1, name: 'Widget' },
		{ id: 2, name: 'Gadget' },
		{ id: 3, name: 'Doohickey' },
	])
})

app.listen(PORT, () => {
	console.log(`Backend running on http://localhost:${PORT}`)
})
