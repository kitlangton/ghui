import { parseColor, SyntaxStyle } from "@opentui/core"
import type { PullRequestItem } from "../domain.js"
import { colors } from "./colors.js"

export interface DiffFilePatch {
	readonly name: string
	readonly filetype: string | undefined
	readonly patch: string
}

export type PullRequestDiffState =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly patch: string; readonly files: readonly DiffFilePatch[] }
	| { readonly status: "error"; readonly error: string }

export const createDiffSyntaxStyle = () => SyntaxStyle.fromStyles({
	keyword: { fg: parseColor(colors.accent), bold: true },
	"keyword.import": { fg: parseColor(colors.accent), bold: true },
	string: { fg: parseColor(colors.inlineCode) },
	comment: { fg: parseColor(colors.muted), italic: true },
	number: { fg: parseColor(colors.status.review) },
	boolean: { fg: parseColor(colors.status.review) },
	constant: { fg: parseColor(colors.status.review) },
	function: { fg: parseColor(colors.status.passing) },
	"function.call": { fg: parseColor(colors.status.passing) },
	constructor: { fg: parseColor(colors.status.draft) },
	type: { fg: parseColor(colors.status.draft) },
	operator: { fg: parseColor(colors.status.failing) },
	variable: { fg: parseColor(colors.text) },
	property: { fg: parseColor(colors.status.review) },
	bracket: { fg: parseColor(colors.text) },
	punctuation: { fg: parseColor(colors.text) },
	default: { fg: parseColor(colors.text) },
})

const extensionFiletypes: Record<string, string> = {
	c: "c",
	cc: "cpp",
	cpp: "cpp",
	cs: "csharp",
	css: "css",
	go: "go",
	h: "c",
	hpp: "cpp",
	html: "html",
	java: "java",
	js: "javascript",
	jsx: "javascript",
	json: "json",
	kt: "kotlin",
	md: "markdown",
	mjs: "javascript",
	py: "python",
	rs: "rust",
	rb: "ruby",
	sh: "bash",
	svelte: "svelte",
	toml: "toml",
	ts: "typescript",
	tsx: "typescript",
	txt: "text",
	vue: "vue",
	yaml: "yaml",
	yml: "yaml",
	zig: "zig",
}

const filetypeForPath = (path: string) => {
	const basename = path.split("/").at(-1) ?? path
	if (basename === "Dockerfile") return "dockerfile"
	const extension = basename.includes(".") ? basename.split(".").at(-1)?.toLowerCase() : undefined
	return extension ? extensionFiletypes[extension] : undefined
}

const unquoteDiffPath = (path: string) => path.replace(/^"|"$/g, "").replace(/^a\//, "").replace(/^b\//, "")

const patchFileName = (patch: string) => {
	const diffLine = patch.split("\n").find((line) => line.startsWith("diff --git "))
	if (diffLine) {
		const match = diffLine.match(/^diff --git\s+(\S+)\s+(\S+)/)
		if (match) {
			const next = unquoteDiffPath(match[2]!)
			if (next !== "/dev/null") return next
			return unquoteDiffPath(match[1]!)
		}
	}

	const nextLine = patch.split("\n").find((line) => line.startsWith("+++ "))
	return nextLine ? unquoteDiffPath(nextLine.slice(4).trim()) : "diff"
}

const hunkHeaderPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

const formatHunkRange = (start: string, count: number) => `${start},${count}`

const normalizeHunkLineCounts = (patch: string) => {
	const lines = patch.split("\n")
	const normalized = [...lines]

	for (let index = 0; index < lines.length; index++) {
		const match = lines[index]!.match(hunkHeaderPattern)
		if (!match) continue

		let oldCount = 0
		let newCount = 0
		for (let lineIndex = index + 1; lineIndex < lines.length; lineIndex++) {
			const line = lines[lineIndex]!
			if (line.startsWith("@@ ") || line.startsWith("diff --git ")) break

			const prefix = line[0]
			if (prefix === " ") {
				oldCount += 1
				newCount += 1
			} else if (prefix === "-") {
				oldCount += 1
			} else if (prefix === "+") {
				newCount += 1
			}
		}

		normalized[index] = `@@ -${formatHunkRange(match[1]!, oldCount)} +${formatHunkRange(match[3]!, newCount)} @@${match[5]!}`
	}

	return normalized.join("\n")
}

export const splitPatchFiles = (patch: string): readonly DiffFilePatch[] => {
	const trimmed = patch.trimEnd()
	if (trimmed.length === 0) return []

	const matches = [...trimmed.matchAll(/^diff --git .+$/gm)]
	if (matches.length === 0) {
		return [{ name: "diff", filetype: undefined, patch: trimmed }]
	}

	return matches.map((match, index) => {
		const start = match.index ?? 0
		const end = index + 1 < matches.length ? matches[index + 1]!.index ?? trimmed.length : trimmed.length
		const filePatch = normalizeHunkLineCounts(trimmed.slice(start, end).trimEnd())
		const name = patchFileName(filePatch)
		return { name, filetype: filetypeForPath(name), patch: filePatch }
	})
}

export const pullRequestDiffKey = (pullRequest: PullRequestItem) => `${pullRequest.repository}#${pullRequest.number}`

export const diffStatText = (pullRequest: PullRequestItem) => {
	if (!pullRequest.detailLoaded) return "loading details"
	const files = pullRequest.changedFiles === 1 ? "1 file" : `${pullRequest.changedFiles} files`
	return [
		pullRequest.additions > 0 ? `+${pullRequest.additions}` : null,
		pullRequest.deletions > 0 ? `-${pullRequest.deletions}` : null,
		files,
	].filter((part): part is string => part !== null).join(" ")
}

const estimatedWrappedLineCount = (text: string, width: number, wrapMode: "none" | "word") => {
	if (wrapMode === "none") return 1
	return Math.max(1, Math.ceil(Bun.stringWidth(text) / Math.max(1, width)))
}

const patchLineNumberGutterWidth = (lines: readonly string[]) => {
	let maxLineNumber = 1
	let hasSigns = false
	let oldLine = 0
	let newLine = 0

	for (const line of lines) {
		const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
		if (hunk) {
			oldLine = Number(hunk[1])
			newLine = Number(hunk[2])
			maxLineNumber = Math.max(maxLineNumber, oldLine, newLine)
			continue
		}

		const firstChar = line[0]
		if (firstChar === "-") {
			hasSigns = true
			maxLineNumber = Math.max(maxLineNumber, oldLine)
			oldLine++
		} else if (firstChar === "+") {
			hasSigns = true
			maxLineNumber = Math.max(maxLineNumber, newLine)
			newLine++
		} else if (firstChar === " ") {
			maxLineNumber = Math.max(maxLineNumber, oldLine, newLine)
			oldLine++
			newLine++
		}
	}

	const digits = Math.floor(Math.log10(maxLineNumber)) + 1
	return Math.max(3, digits + 2) + (hasSigns ? 2 : 0)
}

export const patchRenderableLineCount = (patch: string, view: "unified" | "split", wrapMode: "none" | "word", width: number) => {
	const lines = patch.split("\n")
	const lineNumberGutterWidth = patchLineNumberGutterWidth(lines)
	const splitPaneWidth = Math.max(1, Math.floor(width / 2) - lineNumberGutterWidth)
	const unifiedPaneWidth = Math.max(1, width - lineNumberGutterWidth)
	const contentWidth = view === "split" ? splitPaneWidth : unifiedPaneWidth
	let count = 0
	let inHunk = false
	let deletions: number[] = []
	let additions: number[] = []

	const flushChangeBlock = () => {
		if (deletions.length === 0 && additions.length === 0) return
		if (view === "split") {
			const rows = Math.max(deletions.length, additions.length)
			for (let index = 0; index < rows; index++) {
				const deletionCount = index < deletions.length ? deletions[index]! : 1
				const additionCount = index < additions.length ? additions[index]! : 1
				count += Math.max(deletionCount, additionCount)
			}
		} else {
			for (const deletion of deletions) count += deletion
			for (const addition of additions) count += addition
		}
		deletions = []
		additions = []
	}

	for (const line of lines) {
		if (line.startsWith("@@")) {
			flushChangeBlock()
			inHunk = true
			continue
		}

		if (!inHunk) continue

		const firstChar = line[0]
		if (firstChar === "\\") continue

		if (firstChar === "-") {
			deletions.push(estimatedWrappedLineCount(line.slice(1), contentWidth, wrapMode))
			continue
		}

		if (firstChar === "+") {
			additions.push(estimatedWrappedLineCount(line.slice(1), contentWidth, wrapMode))
			continue
		}

		if (firstChar === " ") {
			flushChangeBlock()
			count += estimatedWrappedLineCount(line.slice(1), contentWidth, wrapMode)
		}
	}

	flushChangeBlock()
	return Math.max(1, count)
}
