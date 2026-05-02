import { TextAttributes, type BoxRenderable, type MouseEvent } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { Fragment, useEffect, useMemo, useState } from "react"
import { formatRelativeDate } from "../date.js"
import type { CheckItem, PullRequestItem } from "../domain.js"
import { colors, type ThemeId } from "./colors.js"
import { diffStatText } from "./diff.js"
import { DiffStats } from "./diffStats.js"
import { centerCell, Divider, Filler, fitCell, PaddedRow, PlainLine, TextLine } from "./primitives.js"
import { labelColor, labelTextColor, reviewLabel, shortRepoName, statusColor } from "./pullRequests.js"

interface PreviewLine {
	readonly segments: ReadonlyArray<{
		readonly text: string
		readonly fg: string
		readonly bold?: boolean
		readonly underline?: boolean
		readonly url?: string
	}>
}

export interface DetailPlaceholderContent {
	readonly title: string
	readonly hint: string
}

export const DETAIL_BODY_LINES = 6
export const DETAIL_PLACEHOLDER_ROWS = 4
export const DETAIL_BODY_SCROLL_LIMIT = 1_000

const pullRequestReferencePattern = /(#[0-9]+)/g
const codeFencePattern = /^```\s*([a-zA-Z0-9_-]+)?/
const codeTokenPattern = /(\/\/.*|`(?:\\.|[^`])*`|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\b(?:async|await|break|case|catch|class|const|continue|default|else|export|extends|finally|for|from|function|if|import|interface|let|new|return|switch|throw|try|type|var|while|yield)\b|\b(?:true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b)/g
const codeFenceLine = (line: string) => line.trim().replace(/\\`/g, "`").match(codeFencePattern)
const linkOrUrlPattern = /\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()\[\]"'`]+)/g
const trailingUrlPunctuation = /[.,;:!?)>\]}"'`]+$/

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

const parseReferenceSegments = (text: string, fg: string, bold: boolean): PreviewLine["segments"] =>
	text
		.split(pullRequestReferencePattern)
		.filter((segment) => segment.length > 0)
		.map((segment) => ({
			text: segment,
			fg: segment.match(/^#[0-9]+$/) ? colors.count : fg,
			bold,
		}))

const parseLinkSegments = (text: string, fg: string, bold: boolean): PreviewLine["segments"] => {
	const segments: Array<PreviewLine["segments"][number]> = []
	let cursor = 0
	for (const match of text.matchAll(linkOrUrlPattern)) {
		if (match.index > cursor) {
			segments.push(...parseReferenceSegments(text.slice(cursor, match.index), fg, bold))
		}
		if (match[1] !== undefined && match[2] !== undefined) {
			segments.push({ text: match[1], fg: colors.link, bold, underline: true, url: match[2] })
		} else if (match[3] !== undefined) {
			const raw = match[3]
			const trail = raw.match(trailingUrlPunctuation)?.[0] ?? ""
			const url = trail.length > 0 ? raw.slice(0, raw.length - trail.length) : raw
			if (url.length > 0) {
				segments.push({ text: url, fg: colors.link, bold, underline: true, url })
			}
			if (trail.length > 0) {
				segments.push({ text: trail, fg, bold })
			}
		}
		cursor = match.index + match[0].length
	}
	if (cursor < text.length) {
		segments.push(...parseReferenceSegments(text.slice(cursor), fg, bold))
	}
	return segments
}

const parseInlineSegments = (text: string, fg: string, bold = false): PreviewLine["segments"] => {
	const parts = text.split(/(`[^`]+`)/g).filter((part) => part.length > 0)
	return parts.flatMap((part) => {
		if (part.startsWith("`") && part.endsWith("`")) {
			return [{ text: part.slice(1, -1), fg: colors.inlineCode, bold }]
		}
		return parseLinkSegments(part, fg, bold)
	})
}

const parseCodeSegments = (text: string): PreviewLine["segments"] => {
	const segments: Array<PreviewLine["segments"][number]> = []
	let index = 0
	for (const match of text.matchAll(codeTokenPattern)) {
		const start = match.index ?? 0
		if (start > index) segments.push({ text: text.slice(index, start), fg: colors.text })
		const token = match[0]
		const fg = token.startsWith("//")
			? colors.muted
			: token.startsWith("`") || token.startsWith("\"") || token.startsWith("'")
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
		segment.text.split(/(\s+)/).filter((token) => token.length > 0).map((token) => ({ ...segment, text: token })),
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

interface UrlPosition {
	readonly url: string
	readonly lineIndex: number
	readonly startCol: number
	readonly endCol: number
}

const computeUrlPositions = (lines: readonly PreviewLine[]): readonly UrlPosition[] => {
	const positions: UrlPosition[] = []
	lines.forEach((line, lineIndex) => {
		let col = 0
		for (const segment of line.segments) {
			if (segment.url !== undefined) {
				positions.push({
					url: segment.url,
					lineIndex,
					startCol: col,
					endCol: col + segment.text.length,
				})
			}
			col += segment.text.length
		}
	})
	return positions
}

const bodyPreview = (body: string, width: number, limit = DETAIL_BODY_LINES): Array<PreviewLine> => {
	const sourceLines = body.replace(/\r/g, "").split("\n")
	const preview: Array<PreviewLine> = []
	let inCodeBlock = false

	for (const rawLine of sourceLines) {
		if (preview.length >= limit) break

		const fence = codeFenceLine(rawLine)
		if (fence) {
			inCodeBlock = !inCodeBlock
			continue
		}

		const line = inCodeBlock ? rawLine.replace(/\t/g, "  ") : rawLine.trim()
		if (line.length === 0) continue

		let text = line
		let fg: string = colors.text
		let bold = false
		let indent = ""

		if (!inCodeBlock && /^#{1,6}\s+/.test(line)) {
			if (preview.length > 0) {
				preview.push({ segments: [{ text: "", fg: colors.muted }] })
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

const checksRowCount = (checks: readonly CheckItem[]) => {
	const unique = deduplicateChecks(checks)
	return Math.ceil(unique.length / 2)
}

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
				<span fg={colors.count} attributes={TextAttributes.BOLD}>Checks</span>
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
									) : <span>{" ".repeat(colWidth)}</span>}
								</Fragment>
							)
						})}
					</TextLine>
				)
			})}
		</box>
	)
}

export const getDetailJunctionRows = (pullRequest: PullRequestItem | null, paneWidth: number, showChecks = false): readonly number[] => {
	if (!pullRequest) return [DETAIL_PLACEHOLDER_ROWS]
	const titleLines = wrapText(pullRequest.title, Math.max(1, paneWidth - 2)).length
	const detailDividerRow = 1 + titleLines + 1
	const checks = deduplicateChecks(pullRequest.checks)
	const checksDividerRow = checks.length > 0 ? detailDividerRow + 1 + checksRowCount(checks) + 1 : -1
	return showChecks && checks.length > 0 ? [detailDividerRow, checksDividerRow] : [detailDividerRow]
}

export const getDetailHeaderHeight = (pullRequest: PullRequestItem | null, paneWidth: number, showChecks = false) => {
	if (!pullRequest) return DETAIL_PLACEHOLDER_ROWS + 1
	const titleLines = wrapText(pullRequest.title, Math.max(1, paneWidth - 2)).length
	const checks = deduplicateChecks(pullRequest.checks)
	const checksHeight = showChecks && checks.length > 0 ? checksRowCount(checks) + 2 : 0
	return titleLines + 3 + checksHeight
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
}: {
	pullRequest: PullRequestItem | null
	contentWidth: number
	bodyLines?: number
	paneWidth?: number
	showChecks?: boolean
}) => pullRequest
	? getDetailHeaderHeight(pullRequest, paneWidth, showChecks) + getDetailBodyHeight(pullRequest, contentWidth, bodyLines)
	: bodyLines + DETAIL_PLACEHOLDER_ROWS + 1

export const DetailHeader = ({
	pullRequest,
	viewerUsername,
	contentWidth,
	paneWidth,
	showChecks = false,
}: {
	pullRequest: PullRequestItem
	viewerUsername: string | null
	contentWidth: number
	paneWidth: number
	showChecks?: boolean
}) => {
	const labels = pullRequest.labels
	const wrappedTitle = wrapText(pullRequest.title, Math.max(1, paneWidth - 2))
	const unique = deduplicateChecks(pullRequest.checks)
	const checkRows = checksRowCount(unique)
	const statsText = diffStatText(pullRequest)
	const labelsWidth = !pullRequest.detailLoaded
		? "loading details...".length
		: labels.reduce((total, label, index) => total + label.name.length + 2 + (index > 0 ? 1 : 0), 0)
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
					{!pullRequest.detailLoaded ? <span fg={colors.muted}>loading details...</span> : labels.length > 0 ? labels.map((label, index) => (
						<Fragment key={label.name}>
							{index > 0 ? <span fg={colors.muted}> </span> : null}
							<span bg={labelColor(label)} fg={labelTextColor(labelColor(label))}> {label.name} </span>
						</Fragment>
					)) : null}
					{showStats ? (
						<>
							{statsGap > 0 ? <span fg={colors.muted}>{" ".repeat(statsGap)}</span> : null}
							<DiffStats pullRequest={pullRequest} />
						</>
					) : null}
				</TextLine>
			</PaddedRow>
			<box height={1}><Divider width={paneWidth} /></box>
			{showChecks && unique.length > 0 ? (
				<>
					<box height={checkRows + 1} paddingLeft={1} paddingRight={1}>
						<ChecksSection checks={pullRequest.checks} contentWidth={contentWidth} />
					</box>
					<box height={1}><Divider width={paneWidth} /></box>
				</>
			) : null}
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
	onLinkOpen,
}: {
	pullRequest: PullRequestItem
	contentWidth: number
	bodyLines?: number
	bodyLineLimit?: number
	loadingIndicator: string
	themeId: ThemeId
	onLinkOpen?: (url: string) => void
}) => {
	const renderer = useRenderer()
	const [hoveredUrl, setHoveredUrl] = useState<string | null>(null)

	const previewLines = useMemo(
		() => bodyPreview(pullRequest.body, contentWidth, bodyLineLimit),
		[pullRequest.body, contentWidth, bodyLineLimit, themeId],
	)

	const urlPositions = useMemo(() => computeUrlPositions(previewLines), [previewLines])

	useEffect(() => {
		if (urlPositions.length === 0) return
		renderer.setMousePointer(hoveredUrl !== null ? "pointer" : "default")
		return () => renderer.setMousePointer("default")
	}, [hoveredUrl, urlPositions.length, renderer])

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
		const localX = event.x - this.x - 1
		const localY = event.y - this.y
		const hit = urlPositions.find(
			(position) =>
				position.lineIndex === localY &&
				localX >= position.startCol &&
				localX < position.endCol,
		)
		const next = hit?.url ?? null
		if (next !== hoveredUrl) {
			setHoveredUrl(next)
		}
	}

	const handleMouseOut = () => {
		if (hoveredUrl !== null) setHoveredUrl(null)
	}

	const handleMouseDown = function (this: BoxRenderable, event: MouseEvent) {
		if (!onLinkOpen || hoveredUrl === null || event.button !== 0) return
		event.stopPropagation()
		onLinkOpen(hoveredUrl)
	}

	return (
		<box
			flexDirection="column"
			paddingLeft={1}
			paddingRight={1}
			height={previewLines.length}
			onMouseMove={handleMouseMove}
			onMouseOut={handleMouseOut}
			onMouseDown={handleMouseDown}
		>
			{previewLines.map((line, index) => (
				<TextLine key={`${pullRequest.url}-${index}`}>
					{line.segments.map((segment, segmentIndex) => {
						const isHoveredLink = segment.url === hoveredUrl && hoveredUrl !== null
						const attrs =
							(segment.bold ? TextAttributes.BOLD : 0) |
							(segment.underline ? TextAttributes.UNDERLINE : 0)
						return (
							<span
								key={segmentIndex}
								fg={isHoveredLink ? colors.accent : segment.fg}
								{...(attrs !== 0 ? { attributes: attrs } : {})}
								{...(segment.url ? { link: { url: segment.url } } : {})}
							>
								{segment.text}
							</span>
						)
					})}
				</TextLine>
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
				<span fg={fg} attributes={TextAttributes.BOLD}>{centerCell(text, cardInnerWidth)}</span>
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
		<box height={1}><Divider width={paneWidth} /></box>
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
	placeholderContent,
	loadingIndicator,
	themeId,
	onLinkOpen,
}: {
	pullRequest: PullRequestItem | null
	viewerUsername: string | null
	contentWidth: number
	bodyLines?: number
	bodyLineLimit?: number
	paneWidth?: number
	showChecks?: boolean
	placeholderContent: DetailPlaceholderContent
	loadingIndicator: string
	themeId: ThemeId
	onLinkOpen?: (url: string) => void
}) => {
	const contentHeight = getDetailsPaneHeight({ pullRequest, contentWidth, bodyLines: bodyLineLimit, paneWidth, showChecks })

	return (
		<box flexDirection="column" height={contentHeight}>
			{pullRequest ? (
				<>
					<DetailHeader pullRequest={pullRequest} viewerUsername={viewerUsername} contentWidth={contentWidth} paneWidth={paneWidth} showChecks={showChecks} />
					<DetailBody pullRequest={pullRequest} contentWidth={contentWidth} bodyLines={bodyLines} bodyLineLimit={bodyLineLimit} loadingIndicator={loadingIndicator} themeId={themeId} {...(onLinkOpen ? { onLinkOpen } : {})} />
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
