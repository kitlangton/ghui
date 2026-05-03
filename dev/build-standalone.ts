import { chmod, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

interface ReleaseTarget {
	readonly id: string
	readonly bunTarget: string
}

const targets: readonly ReleaseTarget[] = [
	{ id: "darwin-arm64", bunTarget: "bun-darwin-arm64" },
	{ id: "darwin-x64", bunTarget: "bun-darwin-x64" },
	{ id: "linux-arm64", bunTarget: "bun-linux-arm64" },
	{ id: "linux-x64", bunTarget: "bun-linux-x64" },
]

const root = process.cwd()
const requestedTargetId = process.argv[2]
const releaseDir = process.argv[3] ?? join(root, "dist", "release")

const run = (cmd: readonly string[]) => {
	const proc = Bun.spawnSync({ cmd: [...cmd], cwd: root, stdout: "inherit", stderr: "inherit" })
	if (proc.exitCode !== 0) throw new Error(`Command failed (${proc.exitCode}): ${cmd.join(" ")}`)
}

const sha256 = async (path: string) => {
	const hasher = new Bun.CryptoHasher("sha256")
	hasher.update(await Bun.file(path).arrayBuffer())
	return hasher.digest("hex")
}

const currentTargetId = () => {
	const os = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : null
	const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : null
	return os && arch ? `${os}-${arch}` : null
}

const selectedTargets = () => {
	if (requestedTargetId === "all") return targets

	const targetId = requestedTargetId ?? currentTargetId()
	const target = targets.find((candidate) => candidate.id === targetId)
	if (!target) throw new Error(`Unsupported standalone target: ${targetId ?? "unknown"}`)
	return [target]
}

await rm(releaseDir, { recursive: true, force: true })
await mkdir(releaseDir, { recursive: true })

const checksums: string[] = []
const hostTargetId = currentTargetId()

for (const target of selectedTargets()) {
	const stageDir = join(releaseDir, target.id)
	const binaryPath = join(stageDir, "ghui")
	const assetName = `ghui-${target.id}.tar.gz`
	const assetPath = join(releaseDir, assetName)

	await mkdir(stageDir, { recursive: true })
	run(["bun", "build", "--compile", "--bytecode", "--format=esm", `--target=${target.bunTarget}`, `--outfile=${binaryPath}`, "src/standalone.ts"])
	await chmod(binaryPath, 0o755)

	if (target.id === hostTargetId) {
		const version = Bun.spawnSync({ cmd: [binaryPath, "--version"], cwd: root, stdout: "pipe", stderr: "pipe" })
		if (version.exitCode !== 0) throw new Error(`Standalone smoke failed for ${target.id}: ${version.stderr.toString()}`)
	}

	run(["tar", "-czf", assetPath, "-C", stageDir, "ghui"])
	const checksumLine = `${await sha256(assetPath)}  ${assetName}`
	checksums.push(checksumLine)
	await writeFile(join(releaseDir, `${assetName}.sha256`), `${checksumLine}\n`)
	await rm(stageDir, { recursive: true, force: true })
}

await writeFile(join(releaseDir, "checksums.txt"), `${checksums.join("\n")}\n`)
