const GITHUB_REMOTE_PATTERN = /^(?:https?:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/

export const parseGitRemoteUrl = (url: string): string | null => {
	const match = url.match(GITHUB_REMOTE_PATTERN)
	if (!match) return null
	const [, owner, repo] = match
	if (!owner || !repo) return null
	return `${owner}/${repo}`
}

const readGitConfig = async (): Promise<string> => {
	try {
		const file = Bun.file(".git/config")
		if (!(await file.exists())) return ""
		return await file.text()
	} catch {
		return ""
	}
}

const parseGitConfigRemotes = (content: string): Map<string, string> => {
	const remotes = new Map<string, string>()
	let currentRemote: string | null = null
	for (const raw of content.split("\n")) {
		const line = raw.trim()
		const sectionMatch = line.match(/^\[remote\s+"([^"]+)"\s*\]$/)
		if (sectionMatch) {
			currentRemote = sectionMatch[1]!
			continue
		}
		if (currentRemote && line.startsWith("[") && line.endsWith("]")) {
			currentRemote = null
			continue
		}
		const urlMatch = line.match(/^url\s*=\s*(.+)$/)
		if (urlMatch && currentRemote && !remotes.has(currentRemote)) {
			remotes.set(currentRemote, urlMatch[1]!.trim())
		}
	}
	return remotes
}

export const detectGitHubRemotes = async (): Promise<readonly string[]> => {
	const content = await readGitConfig()
	if (!content) return []

	const remotes = parseGitConfigRemotes(content)
	const found = new Map<string, string>() // repo -> remote name (first seen)
	for (const [remoteName, remoteUrl] of remotes) {
		const repo = parseGitRemoteUrl(remoteUrl)
		if (!repo) continue
		if (!found.has(repo)) found.set(repo, remoteName)
	}

	const entries = [...found.entries()]
	const priority = (name: string) => {
		if (name === "origin") return 0
		if (name === "upstream") return 1
		return 2
	}
	entries.sort(([, a], [, b]) => priority(a) - priority(b) || a.localeCompare(b))
	return entries.map(([repo]) => repo)
}
