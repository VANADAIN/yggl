const output = document.getElementById('output')

async function fetchAndDisplay(path) {
	output.textContent = `fetching ${path}…`
	try {
		const res = await fetch(path)
		const data = await res.json()
		output.textContent = JSON.stringify(data, null, 2)
	} catch (err) {
		output.textContent = `Error: ${err.message}\n\nIs the backend connected? Run:\n  yggl connect [address]:3001`
	}
}

document.getElementById('hello').addEventListener('click', () => fetchAndDisplay('/api/hello'))
document.getElementById('items').addEventListener('click', () => fetchAndDisplay('/api/items'))
