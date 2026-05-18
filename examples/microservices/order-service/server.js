import { createServer, request as httpRequest } from 'node:http'

const PORT = process.env.PORT ?? 3001
const USER_SERVICE_URL = process.env.USER_SERVICE_URL ?? 'http://localhost:3000'

const ORDERS = [
	{ id: 1, userId: 1, item: 'Widget', quantity: 2 },
	{ id: 2, userId: 2, item: 'Gadget', quantity: 1 },
	{ id: 3, userId: 1, item: 'Doohickey', quantity: 5 },
]

function fetchUser(userId) {
	const url = new URL(`/users/${userId}`, USER_SERVICE_URL)
	return new Promise((resolve, reject) => {
		const req = httpRequest(url, (res) => {
			let body = ''
			res.on('data', (chunk) => {
				body += chunk
			})
			res.on('end', () => {
				try {
					resolve(JSON.parse(body))
				} catch {
					reject(new Error('Failed to parse user response'))
				}
			})
		})
		req.on('error', reject)
		req.end()
	})
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url, `http://localhost`)

	res.setHeader('Content-Type', 'application/json')

	try {
		if (req.method === 'GET' && url.pathname === '/orders') {
			// Enrich orders with user data from the user service
			const enriched = await Promise.all(
				ORDERS.map(async (order) => {
					const user = await fetchUser(order.userId)
					return { ...order, user }
				}),
			)
			res.writeHead(200)
			res.end(JSON.stringify(enriched))
			return
		}

		const match = url.pathname.match(/^\/orders\/(\d+)$/)
		if (req.method === 'GET' && match) {
			const order = ORDERS.find((o) => o.id === Number(match[1]))
			if (!order) {
				res.writeHead(404)
				res.end(JSON.stringify({ error: 'Order not found' }))
				return
			}
			const user = await fetchUser(order.userId)
			res.writeHead(200)
			res.end(JSON.stringify({ ...order, user }))
			return
		}

		res.writeHead(404)
		res.end(JSON.stringify({ error: 'Not found' }))
	} catch (err) {
		res.writeHead(502)
		res.end(
			JSON.stringify({
				error: 'Failed to reach user service',
				detail: err.message,
				hint: `Is USER_SERVICE_URL correct? (currently: ${USER_SERVICE_URL})`,
			}),
		)
	}
})

server.listen(PORT, () => {
	console.log(`Order service running on http://localhost:${PORT}`)
	console.log(`  User service: ${USER_SERVICE_URL}`)
	console.log('  GET /orders      — list orders (enriched with user data)')
	console.log('  GET /orders/:id  — get order by id')
})
