#!/usr/bin/env node

import childProcess from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const requireFromHere = createRequire(import.meta.url)

const packageJson = requireFromHere("../package.json")

const platformMap = {
	darwin: "darwin",
	linux: "linux",
}

const archMap = {
	arm64: "arm64",
	x64: "x64",
}

const run = (target, args = process.argv.slice(2)) => {
	const result = childProcess.spawnSync(target, args, { stdio: "inherit" })
	if (result.error) {
		console.error(result.error.message)
		process.exit(1)
	}
	process.exit(typeof result.status === "number" ? result.status : 0)
}

if (process.env.GHUI_BIN_PATH) {
	run(process.env.GHUI_BIN_PATH)
}

if (process.argv[2] === "upgrade") {
	const result = childProcess.spawnSync("npm", ["install", "-g", `${packageJson.name}@latest`], { stdio: "inherit" })
	if (result.error) {
		console.error(result.error.message)
		process.exit(1)
	}
	process.exit(typeof result.status === "number" ? result.status : 0)
}

const scriptPath = fs.realpathSync(__filename)
const scriptDir = path.dirname(scriptPath)
const cached = path.join(scriptDir, ".ghui")

if (fs.existsSync(cached)) {
	run(cached)
}

const platform = platformMap[os.platform()]
const arch = archMap[os.arch()]

if (!platform || !arch) {
	console.error(`Unsupported platform for ${packageJson.name}: ${os.platform()}-${os.arch()}`)
	process.exit(1)
}

const packageName = `${packageJson.name}-${platform}-${arch}`

const resolveBinary = () => {
	try {
		const packageJsonPath = requireFromHere.resolve(`${packageName}/package.json`)
		return path.join(path.dirname(packageJsonPath), "bin", "ghui")
	} catch {
		return null
	}
}

const binaryPath = resolveBinary()

if (!binaryPath || !fs.existsSync(binaryPath)) {
	const sourceEntry = path.join(scriptDir, "..", "src", "standalone.ts")
	if (fs.existsSync(sourceEntry)) {
		run("bun", [sourceEntry, ...process.argv.slice(2)])
	}

	console.error(`Could not find the ${packageName} binary package for this platform.`)
	console.error(`Try reinstalling ${packageJson.name}, or install ${packageName} manually.`)
	process.exit(1)
}

run(binaryPath)
