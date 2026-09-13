const GITHUB_REMOTE_PATTERN = /^(?:https?:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/

export const parseGitRemoteUrl = (url: string): string | null => {
	const match = url.trim().match(GITHUB_REMOTE_PATTERN)
	if (!match) return null
	const owner = match[1]
	const repo = match[2]
	if (!owner || !repo) return null
	return `${owner}/${repo}`
}

export const detectCurrentGitHubRepository = (): string | null => {
	if (typeof Bun === "undefined" || !Bun.spawnSync) return null
	const remotes = Bun.spawnSync({ cmd: ["git", "remote"], stdout: "pipe", stderr: "pipe" })
	if (remotes.exitCode !== 0) return null
	const names = remotes.stdout
		.toString()
		.split("\n")
		.map((name) => name.trim())
		.filter(Boolean)
	const orderedNames = [...names].sort((left, right) => (left === "origin" ? -1 : right === "origin" ? 1 : left === "upstream" ? -1 : right === "upstream" ? 1 : 0))

	for (const name of orderedNames) {
		const url = Bun.spawnSync({ cmd: ["git", "remote", "get-url", name], stdout: "pipe", stderr: "pipe" })
		if (url.exitCode !== 0) continue
		const repository = parseGitRemoteUrl(url.stdout.toString())
		if (repository) return repository
	}

	return null
}
