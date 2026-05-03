import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

type CommandResult = {
	readonly stdout: string
	readonly stderr: string
}

const root = process.cwd()
const rootPackageJson = (await Bun.file(join(root, "package.json")).json()) as { name: string; version: string }
const targetId = process.platform === "darwin" ? `darwin-${process.arch}` : process.platform === "linux" ? `linux-${process.arch}` : null
const binaryPackageName = targetId ? `${rootPackageJson.name}-${targetId}` : null

const run = async (cmd: readonly string[], cwd: string): Promise<CommandResult> => {
	const proc = Bun.spawnSync({ cmd: [...cmd], cwd, stdout: "pipe", stderr: "pipe" })
	const result = { stdout: proc.stdout.toString(), stderr: proc.stderr.toString() }
	if (proc.exitCode !== 0) {
		throw new Error(`Command failed (${proc.exitCode}): ${cmd.join(" ")}\n${result.stdout}${result.stderr}`)
	}
	return result
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}

const assertInstalledPackage = async (projectDir: string) => {
	const packageDir = join(projectDir, "node_modules", "@kitlangton", "ghui")
	const binaryPackageDir = binaryPackageName ? join(projectDir, "node_modules", "@kitlangton", `ghui-${targetId}`) : null
	const packageJson = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8")) as {
		dependencies?: Record<string, string>
		optionalDependencies?: Record<string, string>
		version: string
	}

	assert(packageJson.version === rootPackageJson.version, `Expected installed version ${rootPackageJson.version}, got ${packageJson.version}`)
	assert(!packageJson.dependencies?.["@ghui/keymap"], "Published package must not depend on private workspace @ghui/keymap")
	assert(binaryPackageName && packageJson.optionalDependencies?.[binaryPackageName] === rootPackageJson.version, `Published package must depend on ${binaryPackageName}`)
	assert(binaryPackageDir && (await Bun.file(join(binaryPackageDir, "bin", "ghui")).exists()), "Installed package must include the platform binary package")
	assert(!(await Bun.file(join(packageDir, "src", "index.tsx")).exists()), "Published package must not rely on src/index.tsx")

	const version = await run(["node_modules/.bin/ghui", "--version"], projectDir)
	assert(version.stdout.trim() === rootPackageJson.version, `Expected ghui --version to print ${rootPackageJson.version}, got ${JSON.stringify(version.stdout.trim())}`)
}

const tempRoot = await mkdtemp(join(tmpdir(), "ghui-package-smoke-"))
try {
	const packDir = join(tempRoot, "pack")
	const npmProject = join(tempRoot, "npm-install")
	const bunProject = join(tempRoot, "bun-install")
	await Promise.all([mkdir(packDir, { recursive: true }), mkdir(npmProject, { recursive: true }), mkdir(bunProject, { recursive: true })])

	assert(binaryPackageName, `Unsupported package smoke platform: ${process.platform}-${process.arch}`)
	await run(["bun", "run", "build:npm-packages"], root)

	const packPackage = async (cwd: string) => {
		const pack = await run(["npm", "pack", "--pack-destination", packDir], cwd)
		const packLines = pack.stdout.trim().split("\n")
		const tarballName = packLines[packLines.length - 1]
		assert(typeof tarballName === "string" && tarballName.endsWith(".tgz"), `Could not determine packed tarball from npm pack output: ${pack.stdout}`)
		return join(packDir, tarballName)
	}

	const binaryTarballPath = await packPackage(join(root, "dist", "npm", "binaries", targetId!))
	const mainTarballPath = await packPackage(join(root, "dist", "npm", "main"))

	await run(["npm", "install", binaryTarballPath, mainTarballPath], npmProject)
	await assertInstalledPackage(npmProject)

	await run(["bun", "add", binaryTarballPath, mainTarballPath], bunProject)
	await assertInstalledPackage(bunProject)
} finally {
	await rm(tempRoot, { recursive: true, force: true })
}
