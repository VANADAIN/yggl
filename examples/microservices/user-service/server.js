import { createServer } from 'node:http'

const PORT = process.env.PORT ?? 3000

const USERS = [
	{ id: 1, name: 'Alice', email: 'alice@example.com' },
	{ id: 2, name: 'Bob', email: 'bob@example.com' },
]

const server = createServer((req, res) => {
	const url = new URL(req.url, `http://localhost`)

	res.setHeader('Content-Type', 'application/json')

	if (req.method === 'GET' && url.pathname === '/users') {
		res.writeHead(200)
		res.end(JSON.stringify(USERS))
		return
	}

	const match = url.pathname.match(/^\/users\/(\d+)$/)
	if (req.method === 'GET' && match) {
		const user = USERS.find((u) => u.id === Number(match[1]))
		if (user) {
			res.writeHead(200)
			res.end(JSON.stringify(user))
		} else {
			res.writeHead(404)
			res.end(JSON.stringify({ error: 'User not found' }))
		}
		return
	}

	res.writeHead(404)
	res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(PORT, () => {
	console.log(`User service running on http://localhost:${PORT}`)
	console.log('  GET /users       — list all users')
	console.log('  GET /users/:id   — get user by id')
})
