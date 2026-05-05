import { TextAttributes, type BoxRenderable, type MouseEvent } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { Fragment, useEffect, useMemo, useState } from "react"
import { formatRelativeDate } from "../date.js"
import type { CheckItem, PullRequestComment, PullRequestItem } from "../domain.js"
import { colors, type ThemeId } from "./colors.js"
import { commentCountText, CommentSegmentsLine, type CommentSegment } from "./comments.js"
import { diffStatText } from "./diff.js"
import { DiffStats } from "./diffStats.js"
import { collectUrlPositions, findUrlAt, inlineSegments, type InlinePalette } from "./inlineSegments.js"
import { centerCell, Divider, Filler, fitCell, PaddedRow, PlainLine, TextLine } from "./primitives.js"
import { labelColor, labelTextColor, reviewLabel, shortRepoName, statusColor } from "./pullRequests.js"

const inlinePalette = (): InlinePalette => ({ text: colors.text, inlineCode: colors.inlineCode, link: colors.link, count: colors.count })

// Pixel-column conversion accounts for the body box's paddingLeft={1}.
const BODY_PADDING_LEFT = 1

interface PreviewLine {
	readonly segments: readonly CommentSegment[]
}

export interface DetailPlaceholderContent {
	readonly title: string
	readonly hint: string
}

export const DETAIL_BODY_LINES = 6
export const DETAIL_PLACEHOLDER_ROWS = 4
export const DETAIL_BODY_SCROLL_LIMIT = 1_000

export type DetailCommentsStatus = "idle" | "loading" | "ready"

const codeFencePattern = /^```\s*([a-zA-Z0-9_-]+)?/
const codeTokenPattern =
	/(\/\/.*|`(?:\\.|[^`])*`|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\b(?:async|await|break|case|catch|class|const|continue|default|else|export|extends|finally|for|from|function|if|import|interface|let|new|return|switch|throw|try|type|var|while|yield)\b|\b(?:true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b)/g
const codeFenceLine = (line: string) => line.trim().replace(/\\`/g, "`").match(codeFencePattern)

export const wrapText = (text: string, width: number): string[] => {
	if (text.length === 0 || width <= 0) return [""]
	const words = text.split(/\s+/)
	const lines: string[] = []
	let current = ""
	for (const word of words) {
		const next = current.length > 0 ? `${current} ${word}` : word
		if (next.length > width && current.length > 0) {
			lines.push(current)
			current = word
		} else {
			current = next
		}
	}
	if (current.length > 0) lines.push(current)
	return lines.length > 0 ? lines : [""]
}

const parseInlineSegments = (text: string, fg: string, bold = false): readonly CommentSegment[] => inlineSegments(text, fg, bold, inlinePalette())

const parseCodeSegments = (text: string): PreviewLine["segments"] => {
	const segments: Array<PreviewLine["segments"][number]> = []
	let index = 0
	for (const match of text.matchAll(codeTokenPattern)) {
		const start = match.index ?? 0
		if (start > index) segments.push({ text: text.slice(index, start), fg: colors.text })
		const token = match[0]
		const fg = token.startsWith("//")
			? colors.muted
			: token.startsWith("`") || token.startsWith('"') || token.startsWith("'")
				? colors.inlineCode
				: /^\d/.test(token)
					? colors.status.review
					: token === "true" || token === "false" || token === "null" || token === "undefined"
						? colors.status.review
						: colors.accent
		segments.push({ text: token, fg, bold: fg === colors.accent })
		index = start + token.length
	}
	if (index < text.length) segments.push({ text: text.slice(index), fg: colors.text })
	return segments.length > 0 ? segments : [{ text: "", fg: colors.muted }]
}

const wrapPreviewSegments = (segments: PreviewLine["segments"], width: number, indent = ""): Array<PreviewLine> => {
	const tokens = segments.flatMap((segment) =>
		segment.text
			.split(/(\s+)/)
			.filter((token) => token.length > 0)
			.map((token) => ({ ...segment, text: token })),
	)

	const lines: Array<PreviewLine> = []
	let current: Array<PreviewLine["segments"][number]> = []
	let currentLength = 0

	const pushLine = () => {
		lines.push({ segments: current.length > 0 ? current : [{ text: "", fg: colors.muted }] })
		current = indent.length > 0 ? [{ text: indent, fg: colors.muted }] : []
		currentLength = indent.length
	}

	for (const token of tokens) {
		const tokenLength = token.text.length
		if (currentLength > 0 && currentLength + tokenLength > width) {
			pushLine()
		}
		current.push(token)
		currentLength += tokenLength
	}

	if (current.length > 0) {
		lines.push({ segments: current })
	}

	return lines
}

const TABLE_SEPARATOR_CELL = /^:?-{3,}:?$/

const splitTableCells = (line: string): readonly string[] | null => {
	let text = line.trim()
	if (!text.includes("|")) return null
	if (text.startsWith("|")) text = text.slice(1)
	if (text.endsWith("|")) text = text.slice(0, -1)
	const cells = text.split("|").map((cell) => cell.trim())
	return cells.length >= 2 ? cells : null
}

const isSeparatorCells = (cells: readonly string[] | null, columnCount: number) =>
	cells !== null && cells.length === columnCount && cells.every((cell) => TABLE_SEPARATOR_CELL.test(cell))

const markdownTableAt = (lines: readonly string[], index: number) => {
	const headerLine = lines[index] ?? ""
	if (!headerLine.includes("|")) return null
	const header = splitTableCells(headerLine)
	if (!header) return null
	const separatorCells = splitTableCells(lines[index + 1] ?? "")
	if (!isSeparatorCells(separatorCells, header.length)) return null
	const rows: string[][] = [Array.from(header)]
	let cursor = index + 2
	while (cursor < lines.length) {
		const cells = splitTableCells(lines[cursor] ?? "")
		if (!cells || isSeparatorCells(cells, header.length)) break
		const padded = cells.length === header.length ? cells.slice() : Array.from({ length: header.length }, (_, cellIndex) => cells[cellIndex] ?? "")
		rows.push(padded)
		cursor += 1
	}
	return { rows, nextIndex: cursor }
}

const segmentWidth = (segments: readonly CommentSegment[]) => segments.reduce((width, segment) => width + segment.text.length, 0)

const BLANK_PREVIEW_LINE: PreviewLine = { segments: [{ text: "", fg: colors.muted }] }

const padSegments = (segments: readonly CommentSegment[], width: number): readonly CommentSegment[] => {
	const padding = Math.max(0, width - segmentWidth(segments))
	return padding > 0 ? [...segments, { text: " ".repeat(padding), fg: colors.muted }] : segments
}

const tableColumnWidths = (rows: readonly (readonly string[])[], width: number) => {
	const columns = rows[0]?.length ?? 0
	const separatorWidth = Math.max(0, columns - 1) * 3
	const available = Math.max(columns, width - separatorWidth)
	const base = Math.max(1, Math.floor(available / columns))
	let remainder = Math.max(0, available - base * columns)
	return Array.from({ length: columns }, () => {
		const extra = remainder > 0 ? 1 : 0
		remainder -= extra
		return base + extra
	})
}

const tableDivider = (columnWidths: readonly number[]): PreviewLine => ({
	segments: columnWidths.flatMap((columnWidth, index) => [
		...(index === 0 ? [] : [{ text: "─┼─", fg: colors.separator }]),
		{ text: "─".repeat(columnWidth), fg: colors.separator },
	]),
})

const tableRows = (rows: readonly (readonly string[])[], width: number): Array<PreviewLine> => {
	const columnWidths = tableColumnWidths(rows, width)
	const output: Array<PreviewLine> = []
	rows.forEach((row, rowIndex) => {
		const isHeader = rowIndex === 0
		const wrappedCells = row.map((cell, cellIndex) =>
			wrapPreviewSegments(parseInlineSegments(cell, isHeader ? colors.count : colors.text, isHeader), Math.max(1, columnWidths[cellIndex] ?? 1)),
		)
		const rowHeight = Math.max(1, ...wrappedCells.map((cell) => cell.length))
		for (let lineIndex = 0; lineIndex < rowHeight; lineIndex++) {
			output.push({
				segments: wrappedCells.flatMap((cell, cellIndex) => [
					...(cellIndex === 0 ? [] : [{ text: " │ ", fg: colors.separator }]),
					...padSegments(cell[lineIndex]?.segments ?? [], columnWidths[cellIndex] ?? 1),
				]),
			})
		}
		if (isHeader) output.push(tableDivider(columnWidths))
	})
	return output
}

export const bodyPreview = (body: string, width: number, limit = DETAIL_BODY_LINES): Array<PreviewLine> => {
	const sourceLines = body.replace(/\r/g, "").split("\n")
	const preview: Array<PreviewLine> = []
	let inCodeBlock = false

	for (let index = 0; index < sourceLines.length; index++) {
		if (preview.length >= limit) break
		const rawLine = sourceLines[index] ?? ""

		const fence = codeFenceLine(rawLine)
		if (fence) {
			inCodeBlock = !inCodeBlock
			continue
		}

		const line = inCodeBlock ? rawLine.replace(/\t/g, "  ") : rawLine.trim()
		if (line.length === 0) continue

		if (!inCodeBlock && rawLine.includes("|")) {
			const table = markdownTableAt(sourceLines, index)
			if (table) {
				const previousIsBlank = segmentWidth(preview.at(-1)?.segments ?? []) === 0
				if (preview.length > 0 && !previousIsBlank && preview.length < limit) {
					preview.push(BLANK_PREVIEW_LINE)
				}
				if (preview.length >= limit) break
				preview.push(...tableRows(table.rows, Math.max(16, width)).slice(0, limit - preview.length))
				if (preview.length < limit) {
					preview.push(BLANK_PREVIEW_LINE)
				}
				index = table.nextIndex - 1
				continue
			}
		}

		let text = line
		let fg: string = colors.text
		let bold = false
		let indent = ""

		if (!inCodeBlock && /^#{1,6}\s+/.test(line)) {
			if (preview.length > 0) {
				preview.push(BLANK_PREVIEW_LINE)
				if (preview.length >= limit) break
			}
			text = line.replace(/^#{1,6}\s+/, "")
			fg = colors.count
			bold = true
		} else if (!inCodeBlock && /^[-*+]\s+\[(x|X| )\]\s+/.test(line)) {
			const checked = /^[-*+]\s+\[(x|X)\]\s+/.test(line)
			text = `${checked ? "☑" : "☐"} ${line.replace(/^[-*+]\s+\[(x|X| )\]\s+/, "")}`
			fg = checked ? colors.status.passing : colors.text
			indent = "  "
		} else if (!inCodeBlock && /^\[(x|X| )\]\s+/.test(line)) {
			const checked = /^\[(x|X)\]\s+/.test(line)
			text = `${checked ? "☑" : "☐"} ${line.replace(/^\[(x|X| )\]\s+/, "")}`
			fg = checked ? colors.status.passing : colors.text
			indent = "  "
		} else if (!inCodeBlock && /^[-*+]\s+/.test(line)) {
			text = `• ${line.replace(/^[-*+]\s+/, "")}`
			indent = "  "
		} else if (!inCodeBlock && /^\d+\.\s+/.test(line)) {
			text = line
			indent = "   "
		} else if (!inCodeBlock && /^>\s+/.test(line)) {
			text = `> ${line.replace(/^>\s+/, "")}`
			fg = colors.muted
			indent = "  "
		}

		const wrapped = wrapPreviewSegments(inCodeBlock ? parseCodeSegments(text) : parseInlineSegments(text, fg, bold), Math.max(16, width), indent)
		for (const wrappedLine of wrapped) {
			preview.push(wrappedLine)
			if (preview.length >= limit) break
		}
	}

	if (preview.length === 0) {
		return [{ segments: [{ text: "No description.", fg: colors.muted }] }]
	}

	return preview.slice(0, limit)
}

const truncateFromStart = (text: string, width: number) => {
	if (text.length <= width) return text
	if (width <= 1) return "…".slice(0, Math.max(0, width))
	return `…${text.slice(-(width - 1))}`
}

export const truncateConversationPath = (path: string, width: number) => {
	if (path.length <= width) return path
	if (width <= 1) return "…".slice(0, Math.max(0, width))
	const parts = path.split("/").filter((part) => part.length > 0)
	if (parts.length <= 2) return truncateFromStart(path, width)

	const prefixParts = parts[0] === "packages" && parts.length > 3 ? parts.slice(0, 2) : parts.slice(0, 1)
	const prefix = prefixParts.join("/")
	let suffixParts = [parts[parts.length - 1]!]
	let best = `${prefix}/…/${suffixParts.join("/")}`

	for (let index = parts.length - 2; index >= prefixParts.length; index--) {
		const nextSuffix = [parts[index]!, ...suffixParts]
		const candidate = `${prefix}/…/${nextSuffix.join("/")}`
		if (candidate.length > width) break
		suffixParts = nextSuffix
		best = candidate
	}

	if (best.length <= width) return best
	const suffixWidth = width - prefix.length - 3
	if (suffixWidth < 1) return truncateFromStart(path, width)
	return `${prefix}/…/${truncateFromStart(parts[parts.length - 1]!, suffixWidth)}`
}

const deduplicateChecks = (checks: readonly CheckItem[]): CheckItem[] => {
	const seen = new Map<string, CheckItem>()
	for (const check of checks) {
		const existing = seen.get(check.name)
		if (!existing || (check.status === "completed" && existing.status !== "completed")) {
			seen.set(check.name, check)
		}
	}
	return [...seen.values()]
}

type CheckKind = "passing" | "failing" | "in-progress" | "queued" | "missing"

const CHECK_DISPLAY: Record<CheckKind, { icon: string; color: string }> = {
	passing: { icon: "✓", color: colors.status.passing },
	failing: { icon: "✗", color: colors.status.failing },
	"in-progress": { icon: "●", color: colors.status.pending },
	queued: { icon: "○", color: colors.muted },
	missing: { icon: "·", color: colors.muted },
}

const checkKind = (check: CheckItem): CheckKind => {
	if (check.status === "completed") {
		if (check.conclusion === "success" || check.conclusion === "neutral" || check.conclusion === "skipped") return "passing"
		if (check.conclusion === "failure") return "failing"
		return "missing"
	}
	if (check.status === "in_progress") return "in-progress"
	return "queued"
}

const checkIcon = (check: CheckItem) => CHECK_DISPLAY[checkKind(check)].icon

const checkColor = (check: CheckItem) => CHECK_DISPLAY[checkKind(check)].color

const ChecksSection = ({ checks, contentWidth }: { checks: readonly CheckItem[]; contentWidth: number }) => {
	const unique = deduplicateChecks(checks)
	if (unique.length === 0) return null

	const columns = 2
	const colWidth = Math.floor((contentWidth - 1) / columns)
	const nameCol = Math.max(4, colWidth - 2)
	const rows = Math.ceil(unique.length / columns)

	return (
		<box flexDirection="column">
			<TextLine>
				<span fg={colors.count} attributes={TextAttributes.BOLD}>
					Checks
				</span>
			</TextLine>
			{Array.from({ length: rows }, (_, rowIndex) => {
				return (
					<TextLine key={rowIndex}>
						{Array.from({ length: columns }, (_, columnIndex) => {
							const check = unique[rowIndex * columns + columnIndex]
							return (
								<Fragment key={columnIndex}>
									{columnIndex > 0 ? <span fg={colors.muted}> </span> : null}
									{check ? (
										<>
											<span fg={checkColor(check)}>{checkIcon(check)} </span>
											<span fg={colors.text}>{fitCell(check.name, nameCol)}</span>
										</>
									) : (
										<span>{" ".repeat(colWidth)}</span>
									)}
								</Fragment>
							)
						})}
					</TextLine>
				)
			})}
		</box>
	)
}

const CommentsSummarySection = ({ count, contentWidth }: { count: number; contentWidth: number }) => {
	const label = "Comments"
	const countText = commentCountText(count)
	const hint = "press c to view all"
	const right = `${countText} · ${hint}`
	const gap = Math.max(1, contentWidth - label.length - right.length)
	return (
		<PaddedRow>
			<TextLine>
				<span fg={colors.count} attributes={TextAttributes.BOLD}>
					{label}
				</span>
				<span fg={colors.muted}>{" ".repeat(gap)}</span>
				<span fg={colors.muted}>{right}</span>
			</TextLine>
		</PaddedRow>
	)
}

interface DetailHeaderLayout {
	readonly titleLines: number
	readonly uniqueChecks: readonly CheckItem[]
	readonly hasChecks: boolean
	readonly showCommentsSummary: boolean
	readonly checkRowsCount: number
	readonly checksHeight: number
	readonly middleDividerHeight: number
	readonly commentsHeight: number
	readonly bottomDividerHeight: number
	readonly headerDividerRow: number
	readonly middleDividerRow: number
	readonly bottomDividerRow: number
	readonly headerHeight: number
}

const computeDetailHeaderLayout = (
	pullRequest: PullRequestItem,
	paneWidth: number,
	showChecks: boolean,
	comments: readonly PullRequestComment[],
	commentsStatus: DetailCommentsStatus,
): DetailHeaderLayout => {
	const titleLines = wrapText(pullRequest.title, Math.max(1, paneWidth - 2)).length
	const uniqueChecks = deduplicateChecks(pullRequest.checks)
	const hasChecks = showChecks && uniqueChecks.length > 0
	const showCommentsSummary = commentsStatus === "ready" && comments.length > 0
	const checkRowsCount = Math.ceil(uniqueChecks.length / 2)
	const checksHeight = hasChecks ? checkRowsCount + 1 : 0
	const middleDividerHeight = hasChecks && showCommentsSummary ? 1 : 0
	const commentsHeight = showCommentsSummary ? 1 : 0
	const bottomDividerHeight = hasChecks || showCommentsSummary ? 1 : 0
	const headerDividerRow = 1 + titleLines + 1
	const middleDividerRow = middleDividerHeight === 1 ? headerDividerRow + checksHeight + 1 : -1
	const bottomDividerRow = bottomDividerHeight === 1 ? headerDividerRow + checksHeight + middleDividerHeight + commentsHeight + 1 : -1
	const headerHeight = titleLines + 3 + checksHeight + middleDividerHeight + commentsHeight + bottomDividerHeight
	return {
		titleLines,
		uniqueChecks,
		hasChecks,
		showCommentsSummary,
		checkRowsCount,
		checksHeight,
		middleDividerHeight,
		commentsHeight,
		bottomDividerHeight,
		headerDividerRow,
		middleDividerRow,
		bottomDividerRow,
		headerHeight,
	}
}

export const getDetailJunctionRows = ({
	pullRequest,
	paneWidth,
	showChecks = false,
	comments = [],
	commentsStatus = "idle",
}: {
	readonly pullRequest: PullRequestItem | null
	readonly paneWidth: number
	readonly showChecks?: boolean
	readonly comments?: readonly PullRequestComment[]
	readonly commentsStatus?: DetailCommentsStatus
}): readonly number[] => {
	if (!pullRequest) return [DETAIL_PLACEHOLDER_ROWS]
	const layout = computeDetailHeaderLayout(pullRequest, paneWidth, showChecks, comments, commentsStatus)
	return [layout.headerDividerRow, layout.middleDividerRow, layout.bottomDividerRow].filter((row) => row >= 0)
}

export const getDetailHeaderHeight = (
	pullRequest: PullRequestItem | null,
	paneWidth: number,
	showChecks = false,
	comments: readonly PullRequestComment[] = [],
	commentsStatus: DetailCommentsStatus = "idle",
) => {
	if (!pullRequest) return DETAIL_PLACEHOLDER_ROWS + 1
	return computeDetailHeaderLayout(pullRequest, paneWidth, showChecks, comments, commentsStatus).headerHeight
}

export const getDetailBodyHeight = (pullRequest: PullRequestItem | null, contentWidth: number, bodyLines = DETAIL_BODY_LINES) => {
	if (!pullRequest) return bodyLines
	if (!pullRequest.detailLoaded) return bodyLines
	return bodyPreview(pullRequest.body, contentWidth, bodyLines).length
}

export const getScrollableDetailBodyHeight = (pullRequest: PullRequestItem | null, contentWidth: number) => {
	return getDetailBodyHeight(pullRequest, contentWidth, DETAIL_BODY_SCROLL_LIMIT)
}

export const getDetailsPaneHeight = ({
	pullRequest,
	contentWidth,
	bodyLines = DETAIL_BODY_LINES,
	paneWidth = contentWidth + 2,
	showChecks = false,
	comments = [],
	commentsStatus = "idle",
}: {
	pullRequest: PullRequestItem | null
	contentWidth: number
	bodyLines?: number
	paneWidth?: number
	showChecks?: boolean
	comments?: readonly PullRequestComment[]
	commentsStatus?: DetailCommentsStatus
}) =>
	pullRequest
		? getDetailHeaderHeight(pullRequest, paneWidth, showChecks, comments, commentsStatus) + getDetailBodyHeight(pullRequest, contentWidth, bodyLines)
		: bodyLines + DETAIL_PLACEHOLDER_ROWS + 1

export const DetailHeader = ({
	pullRequest,
	viewerUsername,
	contentWidth,
	paneWidth,
	showChecks = false,
	comments = [],
	commentsStatus = "idle",
}: {
	pullRequest: PullRequestItem
	viewerUsername: string | null
	contentWidth: number
	paneWidth: number
	showChecks?: boolean
	comments?: readonly PullRequestComment[]
	commentsStatus?: DetailCommentsStatus
}) => {
	const labels = pullRequest.labels
	const wrappedTitle = wrapText(pullRequest.title, Math.max(1, paneWidth - 2))
	const layout = computeDetailHeaderLayout(pullRequest, paneWidth, showChecks, comments, commentsStatus)
	const { hasChecks, showCommentsSummary, checkRowsCount, bottomDividerHeight, middleDividerHeight } = layout
	const statsText = diffStatText(pullRequest)
	const labelsWidth = pullRequest.detailLoaded ? labels.reduce((total, label, index) => total + label.name.length + 2 + (index > 0 ? 1 : 0), 0) : 0
	const hasLabelContent = labelsWidth > 0
	const showStats = contentWidth - labelsWidth - statsText.length >= (hasLabelContent ? 2 : 0)
	const statsGap = Math.max(hasLabelContent ? 2 : 0, contentWidth - labelsWidth - statsText.length)
	const opened = formatRelativeDate(pullRequest.createdAt)
	const repo = shortRepoName(pullRequest.repository)
	const author = viewerUsername && pullRequest.author !== viewerUsername ? ` by ${pullRequest.author}` : ""
	const number = String(pullRequest.number)
	const review = reviewLabel(pullRequest)
	const checks = pullRequest.checkSummary?.replace(/^checks\s+/, "")
	const statusParts = [review, checks].filter((part): part is string => Boolean(part))
	const rightSide = statusParts.length > 0 ? `${statusParts.join(" ")} ${opened}` : opened
	const leftWidth = 1 + number.length + 1 + repo.length + author.length
	const gap = Math.max(2, contentWidth - leftWidth - rightSide.length)

	return (
		<>
			<PaddedRow>
				<TextLine>
					<span fg={colors.count}>#{number}</span>
					<span fg={colors.muted}> {repo}</span>
					{author ? <span fg={colors.muted}>{author}</span> : null}
					<span fg={colors.muted}>{" ".repeat(gap)}</span>
					{review ? <span fg={statusColor(pullRequest.reviewStatus)}>{review}</span> : null}
					{review && checks ? <span fg={colors.muted}> </span> : null}
					{checks ? <span fg={statusColor(pullRequest.checkStatus)}>{checks}</span> : null}
					{statusParts.length > 0 ? <span fg={colors.muted}> </span> : null}
					<span fg={colors.muted}>{opened}</span>
				</TextLine>
			</PaddedRow>
			<box height={wrappedTitle.length} flexDirection="column" paddingLeft={1} paddingRight={1}>
				{wrappedTitle.map((line, index) => (
					<PlainLine key={index} text={line} bold />
				))}
			</box>
			<PaddedRow>
				<TextLine>
					{pullRequest.detailLoaded && labels.length > 0
						? labels.map((label, index) => (
								<Fragment key={label.name}>
									{index > 0 ? <span fg={colors.muted}> </span> : null}
									<span bg={labelColor(label)} fg={labelTextColor(labelColor(label))}>
										{" "}
										{label.name}{" "}
									</span>
								</Fragment>
							))
						: null}
					{showStats ? (
						<>
							{statsGap > 0 ? <span fg={colors.muted}>{" ".repeat(statsGap)}</span> : null}
							<DiffStats pullRequest={pullRequest} />
						</>
					) : null}
				</TextLine>
			</PaddedRow>
			<Divider width={paneWidth} />
			{hasChecks ? (
				<box height={checkRowsCount + 1} paddingLeft={1} paddingRight={1}>
					<ChecksSection checks={pullRequest.checks} contentWidth={contentWidth} />
				</box>
			) : null}
			{middleDividerHeight === 1 ? <Divider width={paneWidth} /> : null}
			{showCommentsSummary ? <CommentsSummarySection count={comments.length} contentWidth={contentWidth} /> : null}
			{bottomDividerHeight === 1 ? <Divider width={paneWidth} /> : null}
		</>
	)
}

export const DetailBody = ({
	pullRequest,
	contentWidth,
	bodyLines = DETAIL_BODY_LINES,
	bodyLineLimit = bodyLines,
	loadingIndicator,
	themeId,
	themeGeneration,
	onLinkOpen,
}: {
	pullRequest: PullRequestItem
	contentWidth: number
	bodyLines?: number
	bodyLineLimit?: number
	loadingIndicator: string
	themeId: ThemeId
	themeGeneration: number
	onLinkOpen?: (url: string) => void
}) => {
	const renderer = useRenderer()
	const [hoveredUrl, setHoveredUrl] = useState<string | null>(null)

	const previewLines = useMemo(() => bodyPreview(pullRequest.body, contentWidth, bodyLineLimit), [pullRequest, contentWidth, bodyLineLimit, themeId, themeGeneration])

	const urlPositions = useMemo(() => collectUrlPositions(previewLines), [previewLines])

	useEffect(() => {
		if (hoveredUrl === null) return
		renderer.setMousePointer("pointer")
		return () => renderer.setMousePointer("default")
	}, [hoveredUrl, renderer])

	if (!pullRequest.detailLoaded) {
		const topRows = Math.max(0, Math.floor((bodyLines - 1) / 2))
		const bottomRows = Math.max(0, bodyLines - topRows - 1)
		return (
			<box flexDirection="column" paddingLeft={1} paddingRight={1} height={bodyLines}>
				<Filler rows={topRows} prefix="top" />
				<PlainLine text={centerCell(`${loadingIndicator} Loading pull request details`, contentWidth)} fg={colors.muted} />
				<Filler rows={bottomRows} prefix="bottom" />
			</box>
		)
	}

	const handleMouseMove = function (this: BoxRenderable, event: MouseEvent) {
		if (urlPositions.length === 0) return
		const localX = event.x - this.x - BODY_PADDING_LEFT
		const localY = event.y - this.y
		const next = findUrlAt(urlPositions, localY, localX)
		if (next !== hoveredUrl) setHoveredUrl(next)
	}

	const handleMouseOut = () => {
		if (hoveredUrl !== null) setHoveredUrl(null)
	}

	const handleMouseDown = function (this: BoxRenderable, event: MouseEvent) {
		if (!onLinkOpen || event.button !== 0) return
		const localX = event.x - this.x - BODY_PADDING_LEFT
		const localY = event.y - this.y
		const url = findUrlAt(urlPositions, localY, localX)
		if (url === null) return
		event.stopPropagation()
		onLinkOpen(url)
	}

	return (
		<box flexDirection="column" height={previewLines.length} onMouseMove={handleMouseMove} onMouseOut={handleMouseOut} onMouseDown={handleMouseDown}>
			{previewLines.map((line, index) => (
				<PaddedRow key={`${pullRequest.url}-${index}`}>
					<CommentSegmentsLine segments={line.segments} hoveredUrl={hoveredUrl} />
				</PaddedRow>
			))}
		</box>
	)
}

export const StatusCard = ({ content, width }: { content: DetailPlaceholderContent; width: number }) => {
	const innerWidth = Math.max(1, width - 2)
	const cardWidth = Math.min(innerWidth, Math.max(28, content.title.length + 4, content.hint.length + 4))
	const offset = " ".repeat(Math.max(0, Math.floor((innerWidth - cardWidth) / 2)))
	const cardInnerWidth = Math.max(1, cardWidth - 2)
	const contentLine = (text: string, fg: string, bold = false) => (
		<TextLine>
			<span fg={colors.separator}>{offset}│</span>
			{bold ? (
				<span fg={fg} attributes={TextAttributes.BOLD}>
					{centerCell(text, cardInnerWidth)}
				</span>
			) : (
				<span fg={fg}>{centerCell(text, cardInnerWidth)}</span>
			)}
			<span fg={colors.separator}>│</span>
		</TextLine>
	)

	return (
		<box flexDirection="column" paddingLeft={1} paddingRight={1}>
			<PlainLine text={`${offset}┌${"─".repeat(cardInnerWidth)}┐`} fg={colors.separator} />
			{contentLine(content.title, colors.count, true)}
			{contentLine(content.hint, colors.muted)}
			<PlainLine text={`${offset}└${"─".repeat(cardInnerWidth)}┘`} fg={colors.separator} />
		</box>
	)
}

export const DetailPlaceholder = ({ content, paneWidth }: { content: DetailPlaceholderContent; paneWidth: number }) => (
	<box flexDirection="column">
		<StatusCard content={content} width={paneWidth} />
		<Divider width={paneWidth} />
	</box>
)

export const LoadingPane = ({ content, width, height }: { content: DetailPlaceholderContent; width: number; height: number }) => {
	const topRows = Math.max(0, Math.floor((height - DETAIL_PLACEHOLDER_ROWS) / 2))
	const bottomRows = Math.max(0, height - topRows - DETAIL_PLACEHOLDER_ROWS)

	return (
		<box height={height} flexDirection="column">
			<Filler rows={topRows} prefix="top" />
			<StatusCard content={content} width={width} />
			<Filler rows={bottomRows} prefix="bottom" />
		</box>
	)
}

export const DetailsPane = ({
	pullRequest,
	viewerUsername,
	contentWidth,
	bodyLines = DETAIL_BODY_LINES,
	bodyLineLimit = bodyLines,
	paneWidth = contentWidth + 2,
	showChecks = false,
	comments = [],
	commentsStatus = "idle",
	placeholderContent,
	loadingIndicator,
	themeId,
	themeGeneration,
	onLinkOpen,
}: {
	pullRequest: PullRequestItem | null
	viewerUsername: string | null
	contentWidth: number
	bodyLines?: number
	bodyLineLimit?: number
	paneWidth?: number
	showChecks?: boolean
	comments?: readonly PullRequestComment[]
	commentsStatus?: DetailCommentsStatus
	placeholderContent: DetailPlaceholderContent
	loadingIndicator: string
	themeId: ThemeId
	themeGeneration: number
	onLinkOpen?: (url: string) => void
}) => {
	const contentHeight = getDetailsPaneHeight({ pullRequest, contentWidth, bodyLines: bodyLineLimit, paneWidth, showChecks, comments, commentsStatus })

	return (
		<box flexDirection="column" height={contentHeight}>
			{pullRequest ? (
				<>
					<DetailHeader
						pullRequest={pullRequest}
						viewerUsername={viewerUsername}
						contentWidth={contentWidth}
						paneWidth={paneWidth}
						showChecks={showChecks}
						comments={comments}
						commentsStatus={commentsStatus}
					/>
					<DetailBody
						pullRequest={pullRequest}
						contentWidth={contentWidth}
						bodyLines={bodyLines}
						bodyLineLimit={bodyLineLimit}
						loadingIndicator={loadingIndicator}
						themeId={themeId}
						themeGeneration={themeGeneration}
						{...(onLinkOpen ? { onLinkOpen } : {})}
					/>
				</>
			) : (
				<>
					<DetailPlaceholder content={placeholderContent} paneWidth={paneWidth} />
					<box flexDirection="column" paddingLeft={1} paddingRight={1}>
						<Filler rows={bodyLines} prefix="empty" />
					</box>
				</>
			)}
		</box>
	)
}
