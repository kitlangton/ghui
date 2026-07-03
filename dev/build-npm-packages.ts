import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { binaryPackageName, currentReleaseTargetId, findReleaseTarget, releaseTargets, type ReleaseTarget } from "./release-targets.js"

const root = process.cwd()
const rootPackage = (await Bun.file(join(root, "package.json")).json()) as {
	readonly name: string
	readonly version: string
	readonly description: string
	readonly license: string
	readonly repository: { readonly type: string; readonly url: string }
	readonly bugs: { readonly url: string }
	readonly homepage: string
}

const outDir = join(root, "dist", "npm")
const requested = process.argv[2]

const run = (cmd: readonly string[]) => {
	const proc = Bun.spawnSync({ cmd: [...cmd], cwd: root, stdout: "inherit", stderr: "inherit" })
	if (proc.exitCode !== 0) throw new Error(`Command failed (${proc.exitCode}): ${cmd.join(" ")}`)
}

const reuseReleaseBinary = process.env.GHUI_REUSE_RELEASE_BINARY === "1"

const selectedTargets = () => {
	if (requested === "main") return []
	if (requested === "all") return releaseTargets

	const targetId = requested ?? currentReleaseTargetId()
	const target = findReleaseTarget(targetId)
	if (!target) throw new Error(`Unsupported npm binary target: ${targetId ?? "unknown"}`)
	return [target]
}

const writeJson = (path: string, value: unknown) => writeFile(path, `${JSON.stringify(value, null, "\t")}\n`)

const packageMetadata = (target: ReleaseTarget) => ({
	name: binaryPackageName(rootPackage.name, target),
	version: rootPackage.version,
	description: `${rootPackage.description} (${target.id} binary)`,
	license: rootPackage.license,
	repository: rootPackage.repository,
	bugs: rootPackage.bugs,
	homepage: rootPackage.homepage,
	os: [target.os],
	cpu: [target.cpu],
	...(target.os === "linux" ? { libc: ["glibc"] } : {}),
	files: ["bin", "LICENSE"],
	publishConfig: {
		access: "public",
		provenance: true,
		registry: "https://registry.npmjs.org/",
	},
})

const buildBinaryPackage = async (target: ReleaseTarget) => {
	const packageDir = join(outDir, "binaries", target.id)
	const binDir = join(packageDir, "bin")
	const binaryPath = join(binDir, "ghui")
	const releaseBinaryPath = join(root, "dist", "release", target.id, "ghui")

	await rm(packageDir, { recursive: true, force: true })
	await mkdir(binDir, { recursive: true })
	if (reuseReleaseBinary && (await Bun.file(releaseBinaryPath).exists())) {
		await cp(releaseBinaryPath, binaryPath)
	} else {
		run(["bun", "build", "--compile", "--bytecode", "--minify", "--format=esm", `--target=${target.bunTarget}`, `--outfile=${binaryPath}`, "src/standalone.ts"])
	}
	await chmod(binaryPath, 0o755)
	await cp(join(root, "LICENSE"), join(packageDir, "LICENSE"))

	await writeJson(join(packageDir, "package.json"), packageMetadata(target))

	if (target.id === currentReleaseTargetId()) {
		const version = Bun.spawnSync({ cmd: [binaryPath, "--version"], cwd: root, stdout: "pipe", stderr: "pipe" })
		if (version.exitCode !== 0) throw new Error(`Binary package smoke failed for ${target.id}: ${version.stderr.toString()}`)
	}
}

const buildMainPackage = async () => {
	const packageDir = join(outDir, "main")
	await rm(packageDir, { recursive: true, force: true })
	await mkdir(join(packageDir, "bin"), { recursive: true })
	await cp(join(root, "bin", "ghui.js"), join(packageDir, "bin", "ghui.js"))
	await cp(join(root, "README.md"), join(packageDir, "README.md"))
	await cp(join(root, "LICENSE"), join(packageDir, "LICENSE"))

	await writeJson(join(packageDir, "package.json"), {
		name: rootPackage.name,
		version: rootPackage.version,
		description: rootPackage.description,
		type: "module",
		license: rootPackage.license,
		repository: rootPackage.repository,
		bugs: rootPackage.bugs,
		homepage: rootPackage.homepage,
		keywords: ["github", "pull-requests", "terminal", "tui"],
		bin: { ghui: "bin/ghui.js" },
		files: ["bin", "README.md", "LICENSE"],
		optionalDependencies: Object.fromEntries(releaseTargets.map((target) => [binaryPackageName(rootPackage.name, target), rootPackage.version])),
		publishConfig: {
			access: "public",
			provenance: true,
			registry: "https://registry.npmjs.org/",
		},
	})
}

if (requested === undefined) await rm(outDir, { recursive: true, force: true })

for (const target of selectedTargets()) {
	await buildBinaryPackage(target)
}

if (requested === undefined || requested === "main") {
	await buildMainPackage()
}
