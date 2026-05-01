#!/usr/bin/env bun

const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json()

const help = `ghui ${packageJson.version}

Terminal UI for GitHub pull requests.

Usage:
  ghui              Start the TUI
  ghui upgrade      Upgrade ghui to the latest npm release
  ghui -v, --version
                    Print the installed version
  ghui -h, --help   Show this help message
`

const args = Bun.argv.slice(2)
const command = args[0]
const commands = ["upgrade", "help", "version"]

const editDistance = (a, b) => {
	const distances = Array.from({ length: a.length + 1 }, (_, i) => [i])
	for (let j = 1; j <= b.length; j++) distances[0][j] = j

	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			distances[i][j] = Math.min(
				distances[i - 1][j] + 1,
				distances[i][j - 1] + 1,
				distances[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
			)
		}
	}

	return distances[a.length][b.length]
}

if (command === "-h" || command === "--help" || command === "help") {
	console.log(help)
	process.exit(0)
}

if (command === "-v" || command === "--version" || command === "version") {
	console.log(packageJson.version)
	process.exit(0)
}

if (command === "upgrade") {
	const proc = Bun.spawn({
		cmd: ["npm", "install", "-g", `${packageJson.name}@latest`],
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	})
	process.exit(await proc.exited)
}

if (command !== undefined) {
	const suggestion = commands.find((name) => editDistance(command, name) <= 2)
	console.error(`Unknown command: ${command}`)
	if (suggestion) console.error(`Did you mean: ghui ${suggestion}?`)
	console.error("Run `ghui --help` for usage.")
	process.exit(1)
}

await import("../src/index.tsx")
