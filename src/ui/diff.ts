import { parseColor, pathToFiletype, SyntaxStyle } from "@opentui/core"
import { Data, Schema } from "effect"
import type { DiffCommentSide, PullRequestItem, PullRequestReviewComment } from "../domain.js"
import { colors } from "./colors.js"

export const DiffView = Schema.Literals(["unified", "split"])
export type DiffView = Schema.Schema.Type<typeof DiffView>

export const DiffWrapMode = Schema.Literals(["none", "word"])
export type DiffWrapMode = Schema.Schema.Type<typeof DiffWrapMode>

export const DiffWhitespaceMode = Schema.Literals(["ignore", "show"])
export type DiffWhitespaceMode = Schema.Schema.Type<typeof DiffWhitespaceMode>

export const DiffCommentKind = Schema.Literals(["addition", "deletion", "context"])
export type DiffCommentKind = Schema.Schema.Type<typeof DiffCommentKind>

export interface DiffFilePatch {
	readonly name: string
	readonly filetype: string | undefined
	readonly patch: string
}

export interface DiffFileStats {
	readonly additions: number
	readonly deletions: number
}

export interface StackedDiffFilePatch {
	readonly file: DiffFilePatch
	readonly index: number
	readonly headerLine: number
	readonly diffStartLine: number
	readonly diffHeight: number
}

export interface DiffCommentAnchor {
	readonly path: string
	readonly line: number
	readonly side: DiffCommentSide
	readonly kind: DiffCommentKind
	readonly renderLine: number
	readonly colorLine: number
	readonly text: string
}

export type StackedDiffCommentAnchor = DiffCommentAnchor & {
	readonly fileIndex: number
	readonly localRenderLine: number
}

export type PullRequestDiffState = Data.TaggedEnum<{
	Loading: {}
	Ready: { readonly patch: string; readonly files: readonly DiffFilePatch[] }
	Error: { readonly error: string }
}>

export const PullRequestDiffState = Data.taggedEnum<PullRequestDiffState>()

export const createDiffSyntaxStyle = () =>
	SyntaxStyle.fromStyles({
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

const unquoteDiffPath = (path: string) => path.replace(/^"|"$/g, "").replace(/^a\//, "").replace(/^b\//, "")

const readDiffPath = (value: string, start: number) => {
	if (value[start] === '"') {
		for (let index = start + 1; index < value.length; index++) {
			if (value[index] === '"' && value[index - 1] !== "\\") {
				const raw = value.slice(start, index + 1)
				try {
					return { path: JSON.parse(raw) as string, end: index + 1 }
				} catch {
					return { path: raw, end: index + 1 }
				}
			}
		}
	}

	const end = value.slice(start).search(/\s/)
	const pathEnd = end >= 0 ? start + end : value.length
	return { path: value.slice(start, pathEnd), end: pathEnd }
}

const parseDiffGitPaths = (line: string) => {
	const prefix = "diff --git "
	if (!line.startsWith(prefix)) return null
	const left = readDiffPath(line, prefix.length)
	const rightStart = line.slice(left.end).search(/\S/)
	if (rightStart < 0) return null
	const right = readDiffPath(line, left.end + rightStart)
	return [left.path, right.path] as const
}

const patchFileName = (patch: string) => {
	const diffLine = patch.split("\n").find((line) => line.startsWith("diff --git "))
	if (diffLine) {
		const paths = parseDiffGitPaths(diffLine)
		if (paths) {
			const next = unquoteDiffPath(paths[1])
			if (next !== "/dev/null") return next
			return unquoteDiffPath(paths[0])
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

const whitespaceComparableText = (text: string) => text.replace(/\s+/g, "")
const MAX_WHITESPACE_LCS_CELLS = 40_000

const linearWhitespaceEquivalentMatches = (deletions: readonly string[], additions: readonly string[]) => {
	const additionsByKey = new Map<string, number[]>()
	const cursors = new Map<string, number>()
	for (let index = 0; index < additions.length; index++) {
		const key = whitespaceComparableText(additions[index]!.slice(1))
		let bucket = additionsByKey.get(key)
		if (!bucket) {
			bucket = []
			additionsByKey.set(key, bucket)
		}
		bucket.push(index)
	}

	const matches: Array<{ readonly oldIndex: number; readonly newIndex: number }> = []
	let minimumNewIndex = 0
	for (let oldIndex = 0; oldIndex < deletions.length; oldIndex++) {
		const key = whitespaceComparableText(deletions[oldIndex]!.slice(1))
		const candidates = additionsByKey.get(key)
		if (!candidates) continue
		let cursor = cursors.get(key) ?? 0
		while (cursor < candidates.length && candidates[cursor]! < minimumNewIndex) cursor++
		const newIndex = candidates[cursor]
		if (newIndex === undefined) continue
		matches.push({ oldIndex, newIndex })
		cursors.set(key, cursor + 1)
		minimumNewIndex = newIndex + 1
	}
	return matches
}

const whitespaceEquivalentMatches = (deletions: readonly string[], additions: readonly string[]) => {
	if ((deletions.length + 1) * (additions.length + 1) > MAX_WHITESPACE_LCS_CELLS) {
		return linearWhitespaceEquivalentMatches(deletions, additions)
	}

	const oldKeys = deletions.map((line) => whitespaceComparableText(line.slice(1)))
	const newKeys = additions.map((line) => whitespaceComparableText(line.slice(1)))
	const lengths = Array.from({ length: oldKeys.length + 1 }, () => Array<number>(newKeys.length + 1).fill(0))

	for (let oldIndex = oldKeys.length - 1; oldIndex >= 0; oldIndex--) {
		for (let newIndex = newKeys.length - 1; newIndex >= 0; newIndex--) {
			lengths[oldIndex]![newIndex] =
				oldKeys[oldIndex] === newKeys[newIndex] ? lengths[oldIndex + 1]![newIndex + 1]! + 1 : Math.max(lengths[oldIndex + 1]![newIndex]!, lengths[oldIndex]![newIndex + 1]!)
		}
	}

	const matches: Array<{ readonly oldIndex: number; readonly newIndex: number }> = []
	let oldIndex = 0
	let newIndex = 0
	while (oldIndex < oldKeys.length && newIndex < newKeys.length) {
		if (oldKeys[oldIndex] === newKeys[newIndex]) {
			matches.push({ oldIndex, newIndex })
			oldIndex++
			newIndex++
		} else if (lengths[oldIndex + 1]![newIndex]! >= lengths[oldIndex]![newIndex + 1]!) {
			oldIndex++
		} else {
			newIndex++
		}
	}

	return matches
}

const mergeWhitespaceEquivalentChanges = (deletions: readonly string[], additions: readonly string[]) => {
	const matches = whitespaceEquivalentMatches(deletions, additions)
	const merged: string[] = []
	let oldCursor = 0
	let newCursor = 0

	for (const match of matches) {
		while (oldCursor < match.oldIndex) merged.push(deletions[oldCursor++]!)
		while (newCursor < match.newIndex) merged.push(additions[newCursor++]!)
		merged.push(` ${additions[match.newIndex]!.slice(1)}`)
		oldCursor = match.oldIndex + 1
		newCursor = match.newIndex + 1
	}

	while (oldCursor < deletions.length) merged.push(deletions[oldCursor++]!)
	while (newCursor < additions.length) merged.push(additions[newCursor++]!)
	return merged
}

const minimizeWhitespaceHunk = (header: string, body: readonly string[]) => {
	const minimized: string[] = []
	let deletions: string[] = []
	let additions: string[] = []

	const flushChangeBlock = () => {
		if (deletions.length === 0 && additions.length === 0) return
		minimized.push(...mergeWhitespaceEquivalentChanges(deletions, additions))
		deletions = []
		additions = []
	}

	for (const line of body) {
		const firstChar = line[0]
		if (firstChar === "-") {
			deletions.push(line)
			continue
		}

		if (firstChar === "+") {
			additions.push(line)
			continue
		}

		flushChangeBlock()
		minimized.push(line)
	}

	flushChangeBlock()
	return minimized.some((line) => line[0] === "-" || line[0] === "+") ? [header, ...minimized] : []
}

export const minimizeWhitespacePatch = (patch: string) => {
	const lines = patch.split("\n")
	const minimized: string[] = []

	for (let index = 0; index < lines.length; ) {
		const line = lines[index]!
		if (!line.match(hunkHeaderPattern)) {
			minimized.push(line)
			index++
			continue
		}

		let end = index + 1
		while (end < lines.length && !lines[end]!.match(hunkHeaderPattern) && !lines[end]!.startsWith("diff --git ")) end++
		minimized.push(...minimizeWhitespaceHunk(line, lines.slice(index + 1, end)))
		index = end
	}

	return normalizeHunkLineCounts(minimized.join("\n")).trimEnd()
}

export const minimizeWhitespaceDiffFiles = (files: readonly DiffFilePatch[]): readonly DiffFilePatch[] =>
	files.flatMap((file) => {
		const patch = minimizeWhitespacePatch(file.patch)
		if (file.patch.split("\n").some((line) => line.match(hunkHeaderPattern)) && !patch.split("\n").some((line) => line.match(hunkHeaderPattern))) return []
		return [{ ...file, patch }]
	})

export const splitPatchFiles = (patch: string): readonly DiffFilePatch[] => {
	const trimmed = patch.trimEnd()
	if (trimmed.length === 0) return []

	const matches = [...trimmed.matchAll(/^diff --git .+$/gm)]
	if (matches.length === 0) {
		return [{ name: "diff", filetype: undefined, patch: trimmed }]
	}

	return matches.map((match, index) => {
		const start = match.index ?? 0
		const end = index + 1 < matches.length ? (matches[index + 1]!.index ?? trimmed.length) : trimmed.length
		const filePatch = normalizeHunkLineCounts(trimmed.slice(start, end).trimEnd())
		const name = patchFileName(filePatch)
		return { name, filetype: pathToFiletype(name), patch: filePatch }
	})
}

export const pullRequestDiffKey = (pullRequest: PullRequestItem) => `${pullRequest.repository}#${pullRequest.number}:${pullRequest.headRefOid}`

export const safeDiffFileIndex = (files: readonly DiffFilePatch[], index: number) => (files.length > 0 ? Math.max(0, Math.min(index, files.length - 1)) : 0)

export const buildStackedDiffFiles = (
	files: readonly DiffFilePatch[],
	view: DiffView,
	wrapMode: DiffWrapMode,
	width: number,
	splitRatio = 0.5,
): readonly StackedDiffFilePatch[] => {
	let offset = 0
	return files.map((file, index) => {
		const diffHeight = patchRenderableLineCount(file.patch, view, wrapMode, width, splitRatio)
		const separatorBefore = index === 0 ? 0 : 1
		const headerLine = offset + separatorBefore
		const stackedFile = {
			file,
			index,
			headerLine,
			diffStartLine: headerLine + 2,
			diffHeight,
		} satisfies StackedDiffFilePatch
		offset += separatorBefore + 2 + diffHeight
		return stackedFile
	})
}

export const stackedDiffFileIndexAtLine = (stackedFiles: readonly StackedDiffFilePatch[], line: number) => {
	let low = 0
	let high = stackedFiles.length - 1
	let match = -1
	while (low <= high) {
		const mid = (low + high) >>> 1
		if (stackedFiles[mid]!.headerLine <= line) {
			match = mid
			low = mid + 1
		} else {
			high = mid - 1
		}
	}
	return match
}

export const stackedDiffFileAtLine = (stackedFiles: readonly StackedDiffFilePatch[], line: number) => stackedFiles[stackedDiffFileIndexAtLine(stackedFiles, line)]

export const diffStatText = (pullRequest: PullRequestItem) => {
	if (!pullRequest.detailLoaded) return "loading details"
	const files = pullRequest.changedFiles === 1 ? "1 file" : `${pullRequest.changedFiles} files`
	const stats = diffFileStatsText(pullRequest)
	return stats ? `${stats} ${files}` : files
}

export const diffCommentLocationKey = (location: Pick<PullRequestReviewComment, "path" | "side" | "line">) => `${location.path}:${location.side}:${location.line}`

export const diffCommentSideLabel = (anchor: Pick<DiffCommentAnchor, "side">) => (anchor.side === "RIGHT" ? "→" : "←")

export const diffCommentLineLabel = (anchor: Pick<DiffCommentAnchor, "side" | "line">) => `${anchor.side === "RIGHT" ? "+" : "-"}${anchor.line}`

export const diffCommentAnchorLabel = (anchor: Pick<DiffCommentAnchor, "side" | "line">) => `${diffCommentSideLabel(anchor)} ${diffCommentLineLabel(anchor)}`

type PendingDiffCommentAnchor = Omit<DiffCommentAnchor, "renderLine" | "colorLine">

const diffContentWidths = (lines: readonly string[], view: DiffView, width: number, splitRatio = 0.5) => {
	const lineNumberGutterWidth = patchLineNumberGutterWidth(lines)
	const splitLeftPaneWidth = Math.max(1, Math.floor(width * splitRatio) - lineNumberGutterWidth)
	const splitRightPaneWidth = Math.max(1, width - Math.floor(width * splitRatio) - lineNumberGutterWidth)
	const unifiedPaneWidth = Math.max(1, width - lineNumberGutterWidth)
	return {
		left: view === "split" ? splitLeftPaneWidth : unifiedPaneWidth,
		right: view === "split" ? splitRightPaneWidth : unifiedPaneWidth,
		unified: unifiedPaneWidth,
	}
}

export const diffFileStats = (file: DiffFilePatch): DiffFileStats => {
	let additions = 0
	let deletions = 0
	let inHunk = false

	for (const line of file.patch.split("\n")) {
		const hunk = line.match(hunkHeaderPattern)
		if (hunk) {
			inHunk = true
			continue
		}

		if (!inHunk) continue
		const firstChar = line[0]
		if (firstChar === "+") additions++
		else if (firstChar === "-") deletions++
	}

	return { additions, deletions }
}

export const diffFileStatsText = (stats: DiffFileStats) => {
	return [stats.additions > 0 ? `+${stats.additions}` : null, stats.deletions > 0 ? `-${stats.deletions}` : null].filter((part): part is string => part !== null).join(" ")
}

export const getDiffCommentAnchors = (
	file: DiffFilePatch,
	view: DiffView = "unified",
	wrapMode: DiffWrapMode = "none",
	width = 120,
	splitRatio = 0.5,
): readonly DiffCommentAnchor[] => {
	const anchors: DiffCommentAnchor[] = []
	const lines = file.patch.split("\n")
	const contentWidths = diffContentWidths(lines, view, width, splitRatio)
	let oldLine = 0
	let newLine = 0
	let renderLine = 0
	let colorLine = 0
	let leftColorLine = 0
	let rightColorLine = 0
	let leftVisualLine = 0
	let rightVisualLine = 0
	let inHunk = false
	let deletions: Array<PendingDiffCommentAnchor & { readonly height: number }> = []
	let additions: Array<PendingDiffCommentAnchor & { readonly height: number }> = []

	const alignSplitSides = () => {
		if (leftVisualLine < rightVisualLine) {
			const pad = rightVisualLine - leftVisualLine
			leftColorLine += pad
			leftVisualLine += pad
		} else if (rightVisualLine < leftVisualLine) {
			const pad = leftVisualLine - rightVisualLine
			rightColorLine += pad
			rightVisualLine += pad
		}
		renderLine = Math.max(leftVisualLine, rightVisualLine)
	}

	const pushSplitRow = (
		deletion: (PendingDiffCommentAnchor & { readonly height: number }) | undefined,
		addition: (PendingDiffCommentAnchor & { readonly height: number }) | undefined,
	) => {
		alignSplitSides()
		if (deletion) anchors.push({ path: deletion.path, line: deletion.line, side: deletion.side, kind: deletion.kind, text: deletion.text, renderLine, colorLine: leftColorLine })
		if (addition) anchors.push({ path: addition.path, line: addition.line, side: addition.side, kind: addition.kind, text: addition.text, renderLine, colorLine: rightColorLine })
		leftColorLine++
		rightColorLine++
		leftVisualLine += deletion?.height ?? 1
		rightVisualLine += addition?.height ?? 1
		renderLine = Math.max(leftVisualLine, rightVisualLine)
	}

	const pushSplitContext = (anchor: PendingDiffCommentAnchor & { readonly height: number }) => {
		alignSplitSides()
		anchors.push({ path: anchor.path, line: anchor.line, side: anchor.side, kind: anchor.kind, text: anchor.text, renderLine, colorLine: rightColorLine })
		leftColorLine++
		rightColorLine++
		leftVisualLine += anchor.height
		rightVisualLine += anchor.height
		renderLine = Math.max(leftVisualLine, rightVisualLine)
	}

	const flushChangeBlock = () => {
		if (deletions.length === 0 && additions.length === 0) return
		if (view === "split") {
			const rowCount = Math.max(deletions.length, additions.length)
			for (let index = 0; index < rowCount; index++) {
				pushSplitRow(deletions[index], additions[index])
			}
		} else {
			for (const deletion of deletions) {
				anchors.push({ path: deletion.path, line: deletion.line, side: deletion.side, kind: deletion.kind, text: deletion.text, renderLine, colorLine })
				renderLine += deletion.height
				colorLine++
			}
			for (const addition of additions) {
				anchors.push({ path: addition.path, line: addition.line, side: addition.side, kind: addition.kind, text: addition.text, renderLine, colorLine })
				renderLine += addition.height
				colorLine++
			}
		}
		deletions = []
		additions = []
	}

	for (const line of lines) {
		const hunk = line.match(hunkHeaderPattern)
		if (hunk) {
			flushChangeBlock()
			oldLine = Number(hunk[1])
			newLine = Number(hunk[3])
			inHunk = true
			continue
		}

		if (!inHunk) continue

		const firstChar = line[0]
		if (firstChar === "\\") continue

		if (firstChar === "+") {
			const text = line.slice(1)
			additions.push({ path: file.name, line: newLine, side: "RIGHT", kind: "addition", text, height: estimatedWrappedLineCount(text, contentWidths.right, wrapMode) })
			newLine++
			continue
		}

		if (firstChar === "-") {
			const text = line.slice(1)
			deletions.push({ path: file.name, line: oldLine, side: "LEFT", kind: "deletion", text, height: estimatedWrappedLineCount(text, contentWidths.left, wrapMode) })
			oldLine++
			continue
		}

		if (firstChar === " ") {
			flushChangeBlock()
			const text = line.slice(1)
			const height =
				view === "split"
					? Math.max(estimatedWrappedLineCount(text, contentWidths.left, wrapMode), estimatedWrappedLineCount(text, contentWidths.right, wrapMode))
					: estimatedWrappedLineCount(text, contentWidths.unified, wrapMode)
			const anchor = { path: file.name, line: newLine, side: "RIGHT", kind: "context", text, height } as const
			if (view === "split") {
				pushSplitContext(anchor)
			} else {
				anchors.push({ path: anchor.path, line: anchor.line, side: anchor.side, kind: anchor.kind, renderLine, colorLine, text: anchor.text })
				renderLine += anchor.height
				colorLine++
			}
			oldLine++
			newLine++
		}
	}

	flushChangeBlock()
	return anchors
}

export const getStackedDiffCommentAnchors = (
	stackedFiles: readonly StackedDiffFilePatch[],
	view: DiffView = "unified",
	wrapMode: DiffWrapMode = "none",
	width = 120,
	splitRatio = 0.5,
): readonly StackedDiffCommentAnchor[] =>
	stackedFiles.flatMap((stackedFile) =>
		getDiffCommentAnchors(stackedFile.file, view, wrapMode, width, splitRatio).map((anchor) => ({
			...anchor,
			fileIndex: stackedFile.index,
			localRenderLine: anchor.renderLine,
			renderLine: stackedFile.diffStartLine + anchor.renderLine,
		})),
	)

export const verticalDiffAnchor = <Anchor extends Pick<DiffCommentAnchor, "renderLine" | "side">>(
	anchors: readonly Anchor[],
	currentAnchor: Anchor | null,
	delta: number,
	preferredSide: DiffCommentSide | null = null,
) => {
	if (anchors.length === 0) return null
	const rows = [...new Set(anchors.map((anchor) => anchor.renderLine))].sort((left, right) => left - right)
	const current = currentAnchor && anchors.includes(currentAnchor) ? currentAnchor : anchors[0]!
	const currentRowIndex = Math.max(0, rows.indexOf(current.renderLine))
	const nextRow = rows[Math.max(0, Math.min(rows.length - 1, currentRowIndex + delta))]
	if (nextRow === undefined) return null
	const targetSide = preferredSide ?? current.side
	return anchors.find((anchor) => anchor.renderLine === nextRow && anchor.side === targetSide) ?? anchors.find((anchor) => anchor.renderLine === nextRow) ?? null
}

export const diffAnchorOnSide = <Anchor extends Pick<DiffCommentAnchor, "renderLine" | "side">>(anchors: readonly Anchor[], currentAnchor: Anchor | null, side: DiffCommentSide) =>
	currentAnchor ? (anchors.find((anchor) => anchor.renderLine === currentAnchor.renderLine && anchor.side === side) ?? null) : null

export const nearestDiffAnchorForLocation = <Anchor extends Pick<DiffCommentAnchor, "path" | "line" | "side" | "renderLine">>(
	anchors: readonly Anchor[],
	target: Anchor,
): Anchor | null => {
	const exact = anchors.find((anchor) => anchor.path === target.path && anchor.side === target.side && anchor.line === target.line)
	if (exact) return exact

	const nearestByLine = (candidates: readonly Anchor[]) =>
		candidates.reduce<Anchor | null>((nearest, anchor) => {
			if (!nearest) return anchor
			const distance = Math.abs(anchor.line - target.line)
			const nearestDistance = Math.abs(nearest.line - target.line)
			if (distance < nearestDistance) return anchor
			if (distance === nearestDistance && anchor.renderLine < nearest.renderLine) return anchor
			return nearest
		}, null)

	return (
		nearestByLine(anchors.filter((anchor) => anchor.path === target.path && anchor.side === target.side)) ??
		nearestByLine(anchors.filter((anchor) => anchor.path === target.path)) ??
		null
	)
}

export const nearestDiffCommentAnchorIndex = (anchors: readonly DiffCommentAnchor[], renderLine: number) => {
	if (anchors.length === 0) return 0
	const nextIndex = anchors.findIndex((anchor) => anchor.renderLine >= renderLine)
	return nextIndex >= 0 ? nextIndex : anchors.length - 1
}

export const scrollTopForVisibleLine = (currentTop: number, viewportHeight: number, line: number, margin = 1) => {
	const safeViewportHeight = Math.max(1, viewportHeight)
	if (line < currentTop + margin) return Math.max(0, line - margin)
	if (line >= currentTop + safeViewportHeight - margin) return Math.max(0, line - safeViewportHeight + margin + 1)
	return currentTop
}

const estimatedWrappedLineCount = (text: string, width: number, wrapMode: DiffWrapMode) => {
	if (wrapMode === "none") return 1
	return Math.max(1, Math.ceil(Bun.stringWidth(text) / Math.max(1, width)))
}

const patchLineNumberGutterWidth = (lines: readonly string[]) => {
	let maxLineNumber = 1
	let hasSigns = false
	let oldLine = 0
	let newLine = 0

	for (const line of lines) {
		const hunk = line.match(hunkHeaderPattern)
		if (hunk) {
			oldLine = Number(hunk[1])
			newLine = Number(hunk[3])
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

export const patchRenderableLineCount = (patch: string, view: DiffView, wrapMode: DiffWrapMode, width: number, splitRatio = 0.5) => {
	const lines = patch.split("\n")
	const contentWidths = diffContentWidths(lines, view, width, splitRatio)
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
			deletions.push(estimatedWrappedLineCount(line.slice(1), contentWidths.left, wrapMode))
			continue
		}

		if (firstChar === "+") {
			additions.push(estimatedWrappedLineCount(line.slice(1), contentWidths.right, wrapMode))
			continue
		}

		if (firstChar === " ") {
			flushChangeBlock()
			count +=
				view === "split"
					? Math.max(estimatedWrappedLineCount(line.slice(1), contentWidths.left, wrapMode), estimatedWrappedLineCount(line.slice(1), contentWidths.right, wrapMode))
					: estimatedWrappedLineCount(line.slice(1), contentWidths.unified, wrapMode)
		}
	}

	flushChangeBlock()
	return Math.max(1, count)
}
