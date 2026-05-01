import { TextAttributes } from "@opentui/core"
import { Fragment, useMemo } from "react"
import { formatRelativeDate } from "../date.js"
import type { CheckItem, PullRequestItem } from "../domain.js"
import { colors, type ThemeId } from "./colors.js"
import { diffStatText } from "./diff.js"
import { centerCell, Divider, fitCell, PlainLine, TextLine } from "./primitives.js"
import { labelColor, labelTextColor, reviewLabel, shortRepoName, statusColor } from "./pullRequests.js"

export interface PreviewLine {
	readonly segments: ReadonlyArray<{
		readonly text: string
		readonly fg: string
		readonly bold?: boolean
	}>
}

export interface DetailPlaceholderContent {
	readonly title: string
	readonly hint: string
}

export const DETAIL_BODY_LINES = 6
export const DETAIL_PLACEHOLDER_ROWS = 4

const pullRequestReferencePattern = /(#[0-9]+)/g

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

const parseInlineSegments = (text: string, fg: string, bold = false): PreviewLine["segments"] => {
	const parts = text.split(/(`[^`]+`)/g).filter((part) => part.length > 0)
	return parts.flatMap((part) => {
		if (part.startsWith("`") && part.endsWith("`")) {
			return [{ text: part.slice(1, -1), fg: colors.inlineCode, bold }]
		}

		return part
			.split(pullRequestReferencePattern)
			.filter((segment) => segment.length > 0)
			.map((segment) => ({
				text: segment,
				fg: segment.match(/^#[0-9]+$/) ? colors.count : fg,
				bold,
			}))
	})
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

export const bodyPreview = (body: string, width: number, limit = DETAIL_BODY_LINES): Array<PreviewLine> => {
	const sourceLines = body.replace(/\r/g, "").split("\n")
	const preview: Array<PreviewLine> = []
	let inCodeBlock = false

	for (const rawLine of sourceLines) {
		if (preview.length >= limit) break

		const line = rawLine.trim()
		if (line.startsWith("```")) {
			inCodeBlock = !inCodeBlock
			continue
		}
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
		} else if (inCodeBlock) {
			fg = colors.muted
		}

		const wrapped = wrapPreviewSegments(parseInlineSegments(text, fg, bold), Math.max(16, width), indent)
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

const BlankRow = () => <box height={1} />

const DiffStats = ({ pullRequest }: { pullRequest: PullRequestItem }) => {
	if (!pullRequest.detailLoaded) return <span fg={colors.muted}>loading details</span>
	const files = pullRequest.changedFiles === 1 ? "1 file" : `${pullRequest.changedFiles} files`
	type Part = { key: string; text: string; color: string }
	const rawParts: Array<Part | null> = [
		pullRequest.additions > 0 ? { key: "additions", text: `+${pullRequest.additions}`, color: colors.status.passing } : null,
		pullRequest.deletions > 0 ? { key: "deletions", text: `-${pullRequest.deletions}`, color: colors.status.failing } : null,
		{ key: "files", text: files, color: colors.muted },
	]
	const parts = rawParts.filter((part): part is Part => part !== null)

	return (
		<>
			{parts.map((part, index) => (
				<Fragment key={part.key}>
					{index > 0 ? <span fg={colors.muted}> </span> : null}
					<span fg={part.color}>{part.text}</span>
				</Fragment>
			))}
		</>
	)
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

const checkIcon = (check: CheckItem) => {
	if (check.status === "completed") {
		if (check.conclusion === "success" || check.conclusion === "neutral" || check.conclusion === "skipped") return "✓"
		if (check.conclusion === "failure") return "✗"
		return "·"
	}
	if (check.status === "in_progress") return "●"
	return "○"
}

const checkColor = (check: CheckItem) => {
	if (check.status === "completed") {
		if (check.conclusion === "success" || check.conclusion === "neutral" || check.conclusion === "skipped") return colors.status.passing
		if (check.conclusion === "failure") return colors.status.failing
		return colors.muted
	}
	if (check.status === "in_progress") return colors.status.pending
	return colors.muted
}

const checksRowCount = (checks: readonly CheckItem[]) => {
	const unique = deduplicateChecks(checks)
	return Math.ceil(unique.length / 2)
}

const ChecksSection = ({ checks, contentWidth }: { checks: readonly CheckItem[]; contentWidth: number }) => {
	const unique = deduplicateChecks(checks)
	if (unique.length === 0) return null

	const colWidth = Math.floor((contentWidth - 1) / 2)
	const nameCol = Math.max(4, colWidth - 2)
	const rows = Math.ceil(unique.length / 2)

	return (
		<box flexDirection="column">
			<TextLine>
				<span fg={colors.count} attributes={TextAttributes.BOLD}>Checks</span>
			</TextLine>
			{Array.from({ length: rows }, (_, rowIndex) => {
				const left = unique[rowIndex * 2]
				const right = unique[rowIndex * 2 + 1]
				return (
					<TextLine key={rowIndex}>
						{left ? (
							<>
								<span fg={checkColor(left)}>{checkIcon(left)} </span>
								<span fg={colors.text}>{fitCell(left.name, nameCol)}</span>
							</>
						) : null}
						{right ? (
							<>
								<span fg={colors.muted}> </span>
								<span fg={checkColor(right)}>{checkIcon(right)} </span>
								<span fg={colors.text}>{right.name}</span>
							</>
						) : null}
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
		: labels.length > 0
		? labels.reduce((total, label, index) => total + label.name.length + 2 + (index > 0 ? 1 : 0), 0)
		: "no labels".length
	const showStats = contentWidth - labelsWidth - statsText.length >= 2
	const statsGap = Math.max(2, contentWidth - labelsWidth - statsText.length)
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
			<box height={1} paddingLeft={1} paddingRight={1}>
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
			</box>
			<box height={wrappedTitle.length} flexDirection="column" paddingLeft={1} paddingRight={1}>
				{wrappedTitle.map((line, index) => (
					<PlainLine key={index} text={line} bold />
				))}
			</box>
			<box height={1} paddingLeft={1} paddingRight={1}>
				<TextLine>
					{!pullRequest.detailLoaded ? <span fg={colors.muted}>loading details...</span> : labels.length > 0 ? labels.map((label, index) => (
						<Fragment key={label.name}>
							{index > 0 ? <span fg={colors.muted}> </span> : null}
							<span bg={labelColor(label)} fg={labelTextColor(labelColor(label))}> {label.name} </span>
						</Fragment>
					)) : <span fg={colors.muted}>no labels</span>}
					{showStats ? (
						<>
							<span fg={colors.muted}>{" ".repeat(statsGap)}</span>
							<DiffStats pullRequest={pullRequest} />
						</>
					) : null}
				</TextLine>
			</box>
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
	loadingIndicator,
	themeId,
}: {
	pullRequest: PullRequestItem
	contentWidth: number
	bodyLines?: number
	loadingIndicator: string
	themeId: ThemeId
}) => {
	const previewLines = useMemo(
		() => bodyPreview(pullRequest.body, contentWidth, bodyLines),
		[pullRequest.body, contentWidth, bodyLines, themeId],
	)

	if (!pullRequest.detailLoaded) {
		const topRows = Math.max(0, Math.floor((bodyLines - 1) / 2))
		const bottomRows = Math.max(0, bodyLines - topRows - 1)
		return (
			<box flexDirection="column" paddingLeft={1} paddingRight={1} height={bodyLines}>
				{Array.from({ length: topRows }, (_, index) => <BlankRow key={`top-${index}`} />)}
				<PlainLine text={centerCell(`${loadingIndicator} Loading pull request details`, contentWidth)} fg={colors.muted} />
				{Array.from({ length: bottomRows }, (_, index) => <BlankRow key={`bottom-${index}`} />)}
			</box>
		)
	}

	return (
		<box flexDirection="column" paddingLeft={1} paddingRight={1}>
			{previewLines.map((line, index) => (
				<TextLine key={`${pullRequest.url}-${index}`}>
					{line.segments.map((segment, segmentIndex) => (
						("bold" in segment && segment.bold === true) ? (
							<span key={segmentIndex} fg={segment.fg} attributes={TextAttributes.BOLD}>
								{segment.text}
							</span>
						) : (
							<span key={segmentIndex} fg={segment.fg}>
								{segment.text}
							</span>
						)
					))}
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
			{Array.from({ length: topRows }, (_, index) => <BlankRow key={`top-${index}`} />)}
			<StatusCard content={content} width={width} />
			{Array.from({ length: bottomRows }, (_, index) => <BlankRow key={`bottom-${index}`} />)}
		</box>
	)
}

export const DetailsPane = ({
	pullRequest,
	viewerUsername,
	contentWidth,
	bodyLines = DETAIL_BODY_LINES,
	paneWidth = contentWidth + 2,
	showChecks = false,
	placeholderContent,
	loadingIndicator,
	themeId,
}: {
	pullRequest: PullRequestItem | null
	viewerUsername: string | null
	contentWidth: number
	bodyLines?: number
	paneWidth?: number
	showChecks?: boolean
	placeholderContent: DetailPlaceholderContent
	loadingIndicator: string
	themeId: ThemeId
}) => {
	const contentHeight = getDetailsPaneHeight({ pullRequest, contentWidth, bodyLines, paneWidth, showChecks })

	return (
		<box flexDirection="column" height={contentHeight}>
			{pullRequest ? (
				<>
					<DetailHeader pullRequest={pullRequest} viewerUsername={viewerUsername} contentWidth={contentWidth} paneWidth={paneWidth} showChecks={showChecks} />
					<DetailBody pullRequest={pullRequest} contentWidth={contentWidth} bodyLines={bodyLines} loadingIndicator={loadingIndicator} themeId={themeId} />
				</>
			) : (
				<>
					<DetailPlaceholder content={placeholderContent} paneWidth={paneWidth} />
					<box flexDirection="column" paddingLeft={1} paddingRight={1}>
						{Array.from({ length: bodyLines }, (_, index) => (
							<BlankRow key={index} />
						))}
					</box>
				</>
			)}
		</box>
	)
}
