import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useAtom, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { Cause, Effect, Layer, Schedule } from "effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { config } from "./config.js"
import type { CheckItem, PullRequestItem, PullRequestLabel, PullRequestMergeAction } from "./domain.js"
import { formatRelativeDate, formatShortDate, formatTimestamp } from "./date.js"
import { Observability } from "./observability.js"
import { GitHubService } from "./services/GitHubService.js"
import { colors } from "./ui/colors.js"
import { diffStatText, diffSyntaxStyle, patchRenderableLineCount, pullRequestDiffKey, splitPatchFiles, type PullRequestDiffState } from "./ui/diff.js"
import { FooterHints, type RetryProgress } from "./ui/FooterHints.js"
import { centerCell, Divider, fitCell, PlainLine, SeparatorColumn, TextLine } from "./ui/primitives.js"
import { initialLabelModalState, initialMergeModalState, LabelModal, MergeModal, mergeActionPastTense, mergeModalOptions } from "./ui/modals.js"
import { groupBy, labelColor, labelTextColor, reviewLabel, shortRepoName, statusColor } from "./ui/pullRequests.js"
import { PullRequestList } from "./ui/PullRequestList.js"

const githubRuntime = Atom.runtime(GitHubService.layer.pipe(Layer.provideMerge(Observability.layer)))

type LoadStatus = "loading" | "ready" | "error"

interface PullRequestLoad {
	readonly data: readonly PullRequestItem[]
	readonly fetchedAt: Date | null
}

interface PreviewLine {
	readonly segments: ReadonlyArray<{
		readonly text: string
		readonly fg: string
		readonly bold?: boolean
	}>
}

interface DetailPlaceholderContent {
	readonly title: string
	readonly hint: string
}

interface DetailPlaceholderInput {
	readonly status: LoadStatus
	readonly retryProgress: RetryProgress | null
	readonly loadingIndicator: string
	readonly visibleCount: number
	readonly filterText: string
}

const pullRequestReferencePattern = /(#[0-9]+)/g
const PR_FETCH_RETRIES = 6
const DETAIL_PLACEHOLDER_ROWS = 4
const LOADING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

const retryProgressAtom = Atom.make<RetryProgress | null>(null).pipe(Atom.keepAlive)
const pullRequestsAtom = githubRuntime.atom(
	GitHubService.use((github) =>
		Effect.gen(function*() {
			yield* Atom.set(retryProgressAtom, null)
			const data = yield* github.listOpenPullRequests().pipe(
				Effect.tapError(() =>
					Atom.update(retryProgressAtom, (current) => ({
						attempt: Math.min((current?.attempt ?? 0) + 1, PR_FETCH_RETRIES),
						max: PR_FETCH_RETRIES,
					}))
				),
				Effect.retry({ times: PR_FETCH_RETRIES, schedule: Schedule.exponential("300 millis", 2) }),
				Effect.tapError(() => Atom.set(retryProgressAtom, null)),
			)

			yield* Atom.set(retryProgressAtom, null)
			return { data, fetchedAt: new Date() } satisfies PullRequestLoad
		})
	),
).pipe(Atom.keepAlive)
const selectedIndexAtom = Atom.make(0).pipe(Atom.keepAlive)
const noticeAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive)
const filterQueryAtom = Atom.make("").pipe(Atom.keepAlive)
const filterDraftAtom = Atom.make("").pipe(Atom.keepAlive)
const filterModeAtom = Atom.make(false).pipe(Atom.keepAlive)
const pendingGAtom = Atom.make(false).pipe(Atom.keepAlive)
const detailFullViewAtom = Atom.make(false).pipe(Atom.keepAlive)
const detailScrollOffsetAtom = Atom.make(0).pipe(Atom.keepAlive)
const diffFullViewAtom = Atom.make(false).pipe(Atom.keepAlive)
const diffFileIndexAtom = Atom.make(0).pipe(Atom.keepAlive)
const diffRenderViewAtom = Atom.make<"unified" | "split">("split").pipe(Atom.keepAlive)
const diffWrapModeAtom = Atom.make<"none" | "word">("none").pipe(Atom.keepAlive)
const pullRequestDiffCacheAtom = Atom.make<Record<string, PullRequestDiffState>>({}).pipe(Atom.keepAlive)

const labelModalAtom = Atom.make(initialLabelModalState).pipe(Atom.keepAlive)
const mergeModalAtom = Atom.make(initialMergeModalState).pipe(Atom.keepAlive)
const labelCacheAtom = Atom.make<Record<string, readonly PullRequestLabel[]>>({}).pipe(Atom.keepAlive)
const pullRequestOverridesAtom = Atom.make<Record<string, PullRequestItem>>({}).pipe(Atom.keepAlive)
const usernameAtom = githubRuntime.atom(
	config.author === "@me"
		? GitHubService.use((github) => github.getAuthenticatedUser())
		: Effect.succeed(config.author.replace(/^@/, "")),
).pipe(Atom.keepAlive)

const listRepoLabelsAtom = githubRuntime.fn<string>()((repository) =>
	GitHubService.use((github) => github.listRepoLabels(repository))
)
const listOpenPullRequestDetailsAtom = githubRuntime.fn<void>()(() =>
	GitHubService.use((github) => github.listOpenPullRequestDetails())
)
const addPullRequestLabelAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly label: string }>()((input) =>
	GitHubService.use((github) => github.addPullRequestLabel(input.repository, input.number, input.label))
)
const removePullRequestLabelAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly label: string }>()((input) =>
	GitHubService.use((github) => github.removePullRequestLabel(input.repository, input.number, input.label))
)
const toggleDraftAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly isDraft: boolean }>()((input) =>
	GitHubService.use((github) => github.toggleDraftStatus(input.repository, input.number, input.isDraft))
)
const getPullRequestDiffAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number }>()((input) =>
	GitHubService.use((github) => github.getPullRequestDiff(input.repository, input.number))
)
const getPullRequestMergeInfoAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number }>()((input) =>
	GitHubService.use((github) => github.getPullRequestMergeInfo(input.repository, input.number))
)
const mergePullRequestAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly action: PullRequestMergeAction }>()((input) =>
	GitHubService.use((github) => github.mergePullRequest(input.repository, input.number, input.action))
)

const BlankRow = () => <box height={1} />
const DETAIL_BODY_LINES = 6

const wrapText = (text: string, width: number): string[] => {
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

const deleteLastWord = (value: string) => value.replace(/\s*\S+\s*$/, "")

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

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

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

const isShiftG = (key: { readonly name: string; readonly shift?: boolean }) => key.name === "G" || key.name === "g" && key.shift

const getDetailPlaceholderContent = ({
	status,
	retryProgress,
	loadingIndicator,
	visibleCount,
	filterText,
}: DetailPlaceholderInput): DetailPlaceholderContent => {
	if (status === "loading") {
		return {
			title: `${loadingIndicator} Loading pull requests`,
			hint: retryProgress ? `Retry ${retryProgress.attempt}/${retryProgress.max}` : "Fetching latest open PRs",
		}
	}

	if (status === "error") {
		return {
			title: "Could not load pull requests",
			hint: "Press r to retry",
		}
	}

	if (visibleCount === 0 && filterText.length > 0) {
		return {
			title: "No matching pull requests",
			hint: "Press esc to clear the filter",
		}
	}

	if (visibleCount === 0) {
		return {
			title: "No open pull requests",
			hint: "Press r to refresh",
		}
	}

	return {
		title: "Select a pull request",
		hint: "Use up/down to move",
	}
}

const bodyPreview = (body: string, width: number, limit = DETAIL_BODY_LINES): Array<PreviewLine> => {
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

const copyPullRequestMetadata = async (pullRequest: PullRequestItem) => {
	const lines = [
		pullRequest.title,
		`${pullRequest.repository} #${pullRequest.number}`,
		pullRequest.url,
	]

	const review = reviewLabel(pullRequest)
	if (review) {
		lines.push(`review: ${review}`)
	}
	if (pullRequest.checkSummary) {
		lines.push(pullRequest.checkSummary)
	}

	const proc = Bun.spawn({
		cmd: ["pbcopy"],
		stdin: "pipe",
		stdout: "ignore",
		stderr: "pipe",
	})

	if (!proc.stdin) {
		throw new Error("Clipboard is not available")
	}

	proc.stdin.write(lines.join("\n"))
	proc.stdin.end()

	const exitCode = await proc.exited
	if (exitCode !== 0) {
		const stderr = await Bun.readableStreamToText(proc.stderr)
		throw new Error(stderr.trim() || "Could not copy PR metadata")
	}
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

	const colWidth = Math.floor((contentWidth - 1) / 2) // -1 for gap between columns
	const nameCol = Math.max(4, colWidth - 2) // -2 for icon + space
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

const DetailHeader = ({
	pullRequest,
	contentWidth,
	paneWidth,
	showChecks = false,
}: {
	pullRequest: PullRequestItem
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

	return (
		<>
			<box height={1} paddingLeft={1} paddingRight={1}>
			{(() => {
				const opened = formatRelativeDate(pullRequest.createdAt)
				const repo = shortRepoName(pullRequest.repository)
				const number = String(pullRequest.number)
				const review = reviewLabel(pullRequest)
				const checks = pullRequest.checkSummary?.replace(/^checks\s+/, "")
				const statusParts = [review, checks].filter((part): part is string => Boolean(part))
				const rightSide = statusParts.length > 0 ? `${statusParts.join(" ")} ${opened}` : opened
				const leftWidth = 1 + number.length + 1 + repo.length
				const gap = Math.max(2, contentWidth - leftWidth - rightSide.length)

				return (
					<TextLine>
						<span fg={colors.count}>#{number}</span>
						<span fg={colors.muted}> {repo}</span>
						<span fg={colors.muted}>{" ".repeat(gap)}</span>
						{review ? <span fg={statusColor(pullRequest.reviewStatus)}>{review}</span> : null}
						{review && checks ? <span fg={colors.muted}> </span> : null}
						{checks ? <span fg={statusColor(pullRequest.checkStatus)}>{checks}</span> : null}
						{statusParts.length > 0 ? <span fg={colors.muted}> </span> : null}
						<span fg={colors.muted}>{opened}</span>
					</TextLine>
				)
			})()}
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

const DetailBody = ({
	pullRequest,
	contentWidth,
	bodyLines = DETAIL_BODY_LINES,
	loadingIndicator,
}: {
	pullRequest: PullRequestItem
	contentWidth: number
	bodyLines?: number
	loadingIndicator: string
}) => {
	const previewLines = useMemo(
		() => bodyPreview(pullRequest.body, contentWidth, bodyLines),
		[pullRequest.body, contentWidth, bodyLines],
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

const StatusCard = ({ content, width }: { content: DetailPlaceholderContent; width: number }) => {
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

const DetailPlaceholder = ({ content, paneWidth }: { content: DetailPlaceholderContent; paneWidth: number }) => (
	<box flexDirection="column">
		<StatusCard content={content} width={paneWidth} />
		<box height={1}><Divider width={paneWidth} /></box>
	</box>
)

const LoadingPane = ({ content, width, height }: { content: DetailPlaceholderContent; width: number; height: number }) => {
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

const DetailsPane = ({
	pullRequest,
	contentWidth,
	bodyLines = DETAIL_BODY_LINES,
	paneWidth = contentWidth + 2,
	showChecks = false,
	placeholderContent,
	loadingIndicator,
}: {
	pullRequest: PullRequestItem | null
	contentWidth: number
	bodyLines?: number
	paneWidth?: number
	showChecks?: boolean
	placeholderContent: DetailPlaceholderContent
	loadingIndicator: string
}) => {
	const titleLines = pullRequest ? wrapText(pullRequest.title, Math.max(1, paneWidth - 2)).length : 1
	const uniqueChecks = pullRequest ? deduplicateChecks(pullRequest.checks) : []
	const checkRows = checksRowCount(uniqueChecks)
	// checks heading (1) + grid rows + divider (1)
	const checksHeight = showChecks && uniqueChecks.length > 0 ? 1 + checkRows + 1 : 0
	const previewLines = useMemo(
		() => (pullRequest ? bodyPreview(pullRequest.body, contentWidth, bodyLines) : []),
		[pullRequest?.body, contentWidth, bodyLines],
	)
	const bodyHeight = pullRequest && !pullRequest.detailLoaded ? bodyLines : previewLines.length
	const contentHeight = pullRequest ? titleLines + 2 + 1 + checksHeight + bodyHeight : bodyLines + DETAIL_PLACEHOLDER_ROWS + 1

	return (
		<box flexDirection="column" height={contentHeight}>
			{pullRequest ? (
				<>
					<DetailHeader pullRequest={pullRequest} contentWidth={contentWidth} paneWidth={paneWidth} showChecks={showChecks} />
					<DetailBody pullRequest={pullRequest} contentWidth={contentWidth} bodyLines={bodyLines} loadingIndicator={loadingIndicator} />
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

const PullRequestDiffPane = ({
	pullRequest,
	diffState,
	fileIndex,
	view,
	wrapMode,
	paneWidth,
	height,
	loadingIndicator,
	scrollRef,
}: {
	pullRequest: PullRequestItem | null
	diffState: PullRequestDiffState | undefined
	fileIndex: number
	view: "unified" | "split"
	wrapMode: "none" | "word"
	paneWidth: number
	height: number
	loadingIndicator: string
	scrollRef: React.Ref<ScrollBoxRenderable>
}) => {
	const readyFiles = diffState?.status === "ready" ? diffState.files : []
	const safeIndex = readyFiles.length > 0 ? Math.max(0, Math.min(fileIndex, readyFiles.length - 1)) : 0
	const file = readyFiles[safeIndex] ?? null
	const diffHeight = useMemo(
		() => file ? patchRenderableLineCount(file.patch, view, wrapMode, paneWidth) : 1,
		[file?.patch, view, wrapMode, paneWidth],
	)

	if (!pullRequest) {
		return <LoadingPane content={{ title: "No pull request selected", hint: "Press esc to go back" }} width={paneWidth} height={height} />
	}

	const stats = diffStatText(pullRequest)
	const headerWidth = Math.max(24, paneWidth - 2)
	const leftHeader = `#${pullRequest.number} ${shortRepoName(pullRequest.repository)}`
	const headerGap = Math.max(2, headerWidth - leftHeader.length - stats.length)

	if (!diffState || diffState.status === "loading") {
		return (
			<box height={height} flexDirection="column">
				<box height={1} paddingLeft={1} paddingRight={1}>
					<TextLine>
						<span fg={colors.count}>#{pullRequest.number}</span>
						<span fg={colors.muted}> {shortRepoName(pullRequest.repository)}</span>
						<span fg={colors.muted}>{" ".repeat(headerGap)}</span>
						<DiffStats pullRequest={pullRequest} />
					</TextLine>
				</box>
				<Divider width={paneWidth} />
				<LoadingPane content={{ title: `${loadingIndicator} Loading diff`, hint: "Fetching patch from GitHub" }} width={paneWidth} height={Math.max(1, height - 2)} />
			</box>
		)
	}

	if (diffState.status === "error") {
		return (
			<box height={height} flexDirection="column">
				<box height={1} paddingLeft={1} paddingRight={1}>
					<PlainLine text={`#${pullRequest.number} ${shortRepoName(pullRequest.repository)} diff`} fg={colors.count} bold />
				</box>
				<Divider width={paneWidth} />
				<StatusCard content={{ title: "Could not load diff", hint: diffState.error }} width={paneWidth} />
			</box>
		)
	}

	if (readyFiles.length === 0 || !file) {
		return <LoadingPane content={{ title: "No diff", hint: "This PR has no patch contents" }} width={paneWidth} height={height} />
	}

	const fileCounter = `${safeIndex + 1}/${readyFiles.length}`
	const fileNameWidth = Math.max(8, headerWidth - fileCounter.length - 2)

	return (
		<box height={height} flexDirection="column">
			<box height={1} paddingLeft={1} paddingRight={1}>
				<TextLine>
					<span fg={colors.count}>#{pullRequest.number}</span>
					<span fg={colors.muted}> {shortRepoName(pullRequest.repository)}</span>
					<span fg={colors.muted}>{" ".repeat(headerGap)}</span>
					<DiffStats pullRequest={pullRequest} />
				</TextLine>
			</box>
			<box height={1} paddingLeft={1} paddingRight={1}>
				<TextLine>
					<span fg={colors.text}>{fitCell(file.name, fileNameWidth)}</span>
					<span fg={colors.muted}>  {fileCounter}</span>
				</TextLine>
			</box>
			<Divider width={paneWidth} />
			<scrollbox ref={scrollRef} focused flexGrow={1} scrollY scrollX={false}>
				<diff
					key={`${pullRequest.url}-${safeIndex}-${view}-${wrapMode}`}
					diff={file.patch}
					view={view}
					syncScroll
					filetype={file.filetype ?? "text"}
					syntaxStyle={diffSyntaxStyle}
					showLineNumbers
					wrapMode={wrapMode}
					addedBg="#17351f"
					removedBg="#3a1e22"
					contextBg="transparent"
					addedSignColor={colors.status.passing}
					removedSignColor={colors.status.failing}
					lineNumberFg={colors.muted}
					lineNumberBg="#151515"
					addedLineNumberBg="#12301a"
					removedLineNumberBg="#35171b"
					selectionBg={colors.selectedBg}
					selectionFg={colors.selectedText}
					height={diffHeight}
					style={{ flexShrink: 0 }}
				/>
			</scrollbox>
		</box>
	)
}

export const App = () => {
	const renderer = useRenderer()
	const { width, height } = useTerminalDimensions()
	const pullRequestResult = useAtomValue(pullRequestsAtom)
	const refreshPullRequestsAtom = useAtomRefresh(pullRequestsAtom)
	const [selectedIndex, setSelectedIndex] = useAtom(selectedIndexAtom)
	const [notice, setNotice] = useAtom(noticeAtom)
	const [filterQuery, setFilterQuery] = useAtom(filterQueryAtom)
	const [filterDraft, setFilterDraft] = useAtom(filterDraftAtom)
	const [filterMode, setFilterMode] = useAtom(filterModeAtom)
	const [pendingG, setPendingG] = useAtom(pendingGAtom)
	const [detailFullView, setDetailFullView] = useAtom(detailFullViewAtom)
	const [_detailScrollOffset, setDetailScrollOffset] = useAtom(detailScrollOffsetAtom)
	const [diffFullView, setDiffFullView] = useAtom(diffFullViewAtom)
	const [diffFileIndex, setDiffFileIndex] = useAtom(diffFileIndexAtom)
	const [diffRenderView, setDiffRenderView] = useAtom(diffRenderViewAtom)
	const [diffWrapMode, setDiffWrapMode] = useAtom(diffWrapModeAtom)
	const [pullRequestDiffCache, setPullRequestDiffCache] = useAtom(pullRequestDiffCacheAtom)
	const [labelModal, setLabelModal] = useAtom(labelModalAtom)
	const [mergeModal, setMergeModal] = useAtom(mergeModalAtom)
	const [labelCache, setLabelCache] = useAtom(labelCacheAtom)
	const [pullRequestOverrides, setPullRequestOverrides] = useAtom(pullRequestOverridesAtom)
	const retryProgress = useAtomValue(retryProgressAtom)
	const [loadingFrame, setLoadingFrame] = useState(0)
	const usernameResult = useAtomValue(usernameAtom)
	const loadRepoLabels = useAtomSet(listRepoLabelsAtom, { mode: "promise" })
	const loadPullRequestDetails = useAtomSet(listOpenPullRequestDetailsAtom, { mode: "promise" })
	const addPullRequestLabel = useAtomSet(addPullRequestLabelAtom, { mode: "promise" })
	const removePullRequestLabel = useAtomSet(removePullRequestLabelAtom, { mode: "promise" })
	const toggleDraftStatus = useAtomSet(toggleDraftAtom, { mode: "promise" })
	const getPullRequestDiff = useAtomSet(getPullRequestDiffAtom, { mode: "promise" })
	const getPullRequestMergeInfo = useAtomSet(getPullRequestMergeInfoAtom, { mode: "promise" })
	const mergePullRequest = useAtomSet(mergePullRequestAtom, { mode: "promise" })
	const contentWidth = Math.max(60, width ?? 100)
	const isWideLayout = (width ?? 100) >= 100
	const splitGap = 1
	const sectionPadding = 1
	const leftPaneWidth = isWideLayout ? Math.max(44, Math.floor((contentWidth - splitGap) * 0.56)) : contentWidth
	const rightPaneWidth = isWideLayout ? Math.max(28, contentWidth - leftPaneWidth - splitGap) : contentWidth
	const dividerJunctionAt = Math.max(1, leftPaneWidth)
	const leftContentWidth = isWideLayout ? Math.max(24, leftPaneWidth - 3) : Math.max(24, contentWidth - sectionPadding * 2)
	const rightContentWidth = isWideLayout ? Math.max(24, rightPaneWidth - sectionPadding * 2) : Math.max(24, contentWidth - sectionPadding * 2)
	const wideDetailLines = Math.max(8, (height ?? 24) - 8) // fill available vertical space
	const wideBodyHeight = Math.max(8, (height ?? 24) - 4)
	const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const pendingGTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const diffPrefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const detailHydrationRef = useRef<number | null>(null)
	const detailScrollRef = useRef<ScrollBoxRenderable | null>(null)
	const diffScrollRef = useRef<ScrollBoxRenderable | null>(null)
	const headerFooterWidth = Math.max(24, contentWidth - 2)

	const flashNotice = (message: string) => {
		if (noticeTimeoutRef.current !== null) {
			clearTimeout(noticeTimeoutRef.current)
		}
		setNotice(message)
		noticeTimeoutRef.current = globalThis.setTimeout(() => {
			setNotice((current) => (current === message ? null : current))
		}, 2500)
	}

	useEffect(() => () => {
		if (noticeTimeoutRef.current !== null) {
			clearTimeout(noticeTimeoutRef.current)
		}
		if (pendingGTimeoutRef.current !== null) {
			clearTimeout(pendingGTimeoutRef.current)
		}
		if (diffPrefetchTimeoutRef.current !== null) {
			clearTimeout(diffPrefetchTimeoutRef.current)
		}
	}, [])

	const pullRequestLoad = AsyncResult.getOrElse(pullRequestResult, () => null)
	const pullRequests = useMemo(
		() => pullRequestLoad?.data.map((pullRequest) => pullRequestOverrides[pullRequest.url] ?? pullRequest) ?? [],
		[pullRequestLoad?.data, pullRequestOverrides],
	)
	const pullRequestStatus: LoadStatus = pullRequestResult.waiting && pullRequestLoad === null
		? "loading"
		: AsyncResult.isFailure(pullRequestResult)
			? "error"
			: "ready"
	const isInitialLoading = pullRequestStatus === "loading" && pullRequests.length === 0
	const pullRequestError = AsyncResult.isFailure(pullRequestResult) ? errorMessage(Cause.squash(pullRequestResult.cause)) : null
	const username = AsyncResult.isSuccess(usernameResult) ? usernameResult.value : null

	const effectiveFilterQuery = (filterMode ? filterDraft : filterQuery).trim().toLowerCase()
	const visibleFilterText = filterMode ? filterDraft : filterQuery

	const filteredPullRequests = useMemo(() => pullRequests.filter((pullRequest) => {
		const query = effectiveFilterQuery
		if (query.length === 0) return true
		return [pullRequest.title, pullRequest.repository, String(pullRequest.number)]
			.some((value) => value.toLowerCase().includes(query))
	}), [pullRequests, effectiveFilterQuery])

	const visibleGroups = useMemo(
		() => groupBy(filteredPullRequests, (pullRequest) => pullRequest.repository),
		[filteredPullRequests],
	)
	const visiblePullRequests = useMemo(() => visibleGroups.flatMap(([, pullRequests]) => pullRequests), [visibleGroups])
	const groupStarts = useMemo(() => visibleGroups.reduce<Array<number>>((starts, [, pullRequests], index) => {
		if (index === 0) {
			starts.push(0)
			return starts
		}
		starts.push(starts[index - 1]! + visibleGroups[index - 1]![1].length)
		return starts
	}, []), [visibleGroups])
	const getCurrentGroupIndex = (current: number) => {
		for (let index = groupStarts.length - 1; index >= 0; index--) {
			if (groupStarts[index]! <= current) return index
		}
		return 0
	}
	const summaryRight = pullRequestLoad?.fetchedAt
		? `updated ${formatShortDate(pullRequestLoad.fetchedAt)} ${formatTimestamp(pullRequestLoad.fetchedAt)}`
		: pullRequestStatus === "loading"
			? "loading pull requests..."
			: ""
	const headerLeft = username ? `GHUI  ${username}` : "GHUI"
	const headerLine = `${fitCell(headerLeft, Math.max(0, headerFooterWidth - summaryRight.length))}${summaryRight}`
	const footerNotice = notice ? fitCell(notice, headerFooterWidth) : null
	const selectPullRequestByUrl = (url: string) => {
		const index = visiblePullRequests.findIndex((pullRequest) => pullRequest.url === url)
		if (index >= 0) setSelectedIndex(index)
	}
	const updatePullRequest = (url: string, transform: (pullRequest: PullRequestItem) => PullRequestItem) => {
		const pullRequest = pullRequests.find((item) => item.url === url)
		if (!pullRequest) return
		setPullRequestOverrides((current) => ({ ...current, [url]: transform(pullRequest) }))
	}
	const refreshPullRequests = (message?: string) => {
		refreshPullRequestsAtom()
		if (message) flashNotice(message)
	}

	useEffect(() => {
		setSelectedIndex((current) => {
			if (visiblePullRequests.length === 0) return 0
			return Math.max(0, Math.min(current, visiblePullRequests.length - 1))
		})
	}, [visiblePullRequests.length])

	useEffect(() => {
		setDiffFileIndex(0)
	}, [selectedIndex])

	const selectedPullRequest = visiblePullRequests[selectedIndex] ?? null
	const selectedDiffState = selectedPullRequest ? pullRequestDiffCache[pullRequestDiffKey(selectedPullRequest)] : undefined
	const effectiveDiffRenderView = contentWidth >= 100 ? diffRenderView : "unified"
	const isHydratingPullRequestDetails = pullRequestStatus === "ready" && pullRequests.some((pullRequest) => !pullRequest.detailLoaded)
	const hasActiveLoadingIndicator = pullRequestStatus === "loading" || isHydratingPullRequestDetails || labelModal.loading || mergeModal.loading || mergeModal.running || selectedDiffState?.status === "loading"
	const loadingIndicator = LOADING_FRAMES[loadingFrame % LOADING_FRAMES.length]!

	useEffect(() => {
		if (!hasActiveLoadingIndicator) return
		const interval = globalThis.setInterval(() => {
			setLoadingFrame((current) => (current + 1) % LOADING_FRAMES.length)
		}, 120)
		return () => globalThis.clearInterval(interval)
	}, [hasActiveLoadingIndicator])

	useEffect(() => {
		const fetchedAt = pullRequestLoad?.fetchedAt?.getTime()
		if (pullRequestStatus !== "ready" || fetchedAt === undefined) return
		if (detailHydrationRef.current === fetchedAt) return
		if (!pullRequests.some((pullRequest) => !pullRequest.detailLoaded)) return
		detailHydrationRef.current = fetchedAt
		void loadPullRequestDetails().then((details) => {
			setPullRequestOverrides((current) => {
				const next = { ...current }
				for (const detail of details) {
					next[detail.url] = current[detail.url]?.detailLoaded ? current[detail.url]! : detail
				}
				return next
			})
		}).catch((error) => {
			flashNotice(error instanceof Error ? error.message : String(error))
		})
	}, [pullRequestStatus, pullRequestLoad?.fetchedAt, pullRequests.length])

	const detailPlaceholderContent = getDetailPlaceholderContent({
		status: pullRequestStatus,
		retryProgress,
		loadingIndicator,
		visibleCount: visiblePullRequests.length,
		filterText: visibleFilterText,
	})
	const titleWrapWidth = Math.max(1, rightPaneWidth - 2) // account for paddingLeft/paddingRight in detail pane
	const titleLines = selectedPullRequest ? wrapText(selectedPullRequest.title, titleWrapWidth).length : 1
	const detailDividerRow = 1 + titleLines + 1 // info row + title lines + labels row
	const detailChecks = selectedPullRequest ? deduplicateChecks(selectedPullRequest.checks) : []
	const checksRows = checksRowCount(detailChecks)
	// checks heading (1) + grid rows + divider
	const checksDividerRow = detailChecks.length > 0 ? detailDividerRow + 1 + checksRows + 1 : -1
	const detailJunctions = selectedPullRequest
		? detailChecks.length > 0 ? [detailDividerRow, checksDividerRow] : [detailDividerRow]
		: [DETAIL_PLACEHOLDER_ROWS]

	const halfPage = Math.max(1, Math.floor(wideBodyHeight / 2))

	const loadPullRequestDiff = (pullRequest: PullRequestItem, force = false) => {
		const key = pullRequestDiffKey(pullRequest)
		const existing = pullRequestDiffCache[key]
		if (!force && (existing?.status === "ready" || existing?.status === "loading")) return

		setPullRequestDiffCache((current) => ({ ...current, [key]: { status: "loading" } }))
		void getPullRequestDiff({ repository: pullRequest.repository, number: pullRequest.number })
			.then((patch) => {
				setPullRequestDiffCache((current) => ({
					...current,
					[key]: { status: "ready", patch, files: splitPatchFiles(patch) },
				}))
			})
			.catch((error) => {
				setPullRequestDiffCache((current) => ({
					...current,
					[key]: { status: "error", error: errorMessage(error) },
				}))
				flashNotice(errorMessage(error))
			})
	}

	useEffect(() => {
		if (!selectedPullRequest || diffFullView) return
		if (diffPrefetchTimeoutRef.current !== null) {
			clearTimeout(diffPrefetchTimeoutRef.current)
		}
		diffPrefetchTimeoutRef.current = setTimeout(() => {
			loadPullRequestDiff(selectedPullRequest)
		}, 250)
		return () => {
			if (diffPrefetchTimeoutRef.current !== null) {
				clearTimeout(diffPrefetchTimeoutRef.current)
				diffPrefetchTimeoutRef.current = null
			}
		}
	}, [selectedIndex, selectedPullRequest?.url, diffFullView])

	const openDiffView = () => {
		if (!selectedPullRequest) return
		setDiffFullView(true)
		setDetailFullView(false)
		setDiffFileIndex(0)
		setDiffRenderView(contentWidth >= 100 ? "split" : "unified")
		diffScrollRef.current?.scrollTo({ x: 0, y: 0 })
		loadPullRequestDiff(selectedPullRequest)
	}

	const openLabelModal = () => {
		if (!selectedPullRequest) return
		setMergeModal(initialMergeModalState)
		const repository = selectedPullRequest.repository
		const cachedLabels = labelCache[repository]
		if (cachedLabels) {
			setLabelModal({
				open: true,
				repository,
				query: "",
				selectedIndex: 0,
				availableLabels: cachedLabels,
				loading: false,
			})
			return
		}

		setLabelModal((current) => ({ ...current, open: true, repository, query: "", selectedIndex: 0, availableLabels: [], loading: true }))
		void loadRepoLabels(repository)
			.then((labels) => {
				setLabelCache((current) => ({ ...current, [repository]: labels }))
				setLabelModal((current) => current.repository === repository ? { ...current, availableLabels: labels, loading: false } : current)
			})
			.catch((error) => {
				setLabelModal((current) => current.repository === repository ? { ...current, loading: false } : current)
				flashNotice(error instanceof Error ? error.message : String(error))
			})
	}

	const openMergeModal = () => {
		if (!selectedPullRequest) return
		const repository = selectedPullRequest.repository
		const number = selectedPullRequest.number
		setLabelModal(initialLabelModalState)
		setMergeModal({
			open: true,
			repository,
			number,
			selectedIndex: 0,
			loading: true,
			running: false,
			info: null,
			error: null,
		})
		void getPullRequestMergeInfo({ repository, number })
			.then((info) => {
				setMergeModal((current) => current.repository === repository && current.number === number
					? { ...current, loading: false, info, selectedIndex: 0 }
					: current)
			})
			.catch((error) => {
				setMergeModal((current) => current.repository === repository && current.number === number
					? { ...current, loading: false, error: errorMessage(error) }
					: current)
			})
	}

	const confirmMergeAction = () => {
		if (!mergeModal.info || mergeModal.loading || mergeModal.running) return
		const options = mergeModalOptions(mergeModal.info)
		const option = options[mergeModal.selectedIndex]
		if (!option) return

		const { repository, number } = mergeModal.info
		const targetPullRequest = pullRequests.find((pullRequest) => pullRequest.repository === repository && pullRequest.number === number)
		const previousPullRequest = targetPullRequest ?? null
		const previousMergeInfo = mergeModal.info

		if (targetPullRequest && option.action === "auto") {
			updatePullRequest(targetPullRequest.url, (pullRequest) => ({ ...pullRequest, autoMergeEnabled: true }))
			setMergeModal((current) => ({
				...current,
				info: current.info ? { ...current.info, autoMergeEnabled: true } : current.info,
			}))
		} else if (targetPullRequest && option.action === "disable-auto") {
			updatePullRequest(targetPullRequest.url, (pullRequest) => ({ ...pullRequest, autoMergeEnabled: false }))
			setMergeModal((current) => ({
				...current,
				info: current.info ? { ...current.info, autoMergeEnabled: false } : current.info,
			}))
		}

		setMergeModal((current) => ({ ...current, running: true, error: null }))
		void mergePullRequest({ repository, number, action: option.action })
			.then(() => {
				setMergeModal(initialMergeModalState)
				if (option.action === "squash" || option.action === "admin") {
					refreshPullRequests(`${mergeActionPastTense(option.action)} #${number}`)
				} else {
					flashNotice(`${mergeActionPastTense(option.action)} #${number}`)
				}
			})
			.catch((error) => {
				if (previousPullRequest) updatePullRequest(previousPullRequest.url, () => previousPullRequest)
				setMergeModal((current) => ({ ...current, running: false, info: previousMergeInfo, error: errorMessage(error) }))
				flashNotice(errorMessage(error))
			})
	}

	const toggleLabelAtIndex = () => {
		if (!selectedPullRequest) return
		const filtered = labelModal.availableLabels.filter((label) =>
			labelModal.query.length === 0 || label.name.toLowerCase().includes(labelModal.query.toLowerCase()),
		)
		const label = filtered[labelModal.selectedIndex]
		if (!label) return

		const isActive = selectedPullRequest.labels.some((l) => l.name.toLowerCase() === label.name.toLowerCase())
		const previousPullRequest = selectedPullRequest

		if (isActive) {
			updatePullRequest(selectedPullRequest.url, (pr) => ({
				...pr,
				labels: pr.labels.filter((l) => l.name.toLowerCase() !== label.name.toLowerCase()),
			}))
			void removePullRequestLabel({ repository: selectedPullRequest.repository, number: selectedPullRequest.number, label: label.name })
				.then(() => flashNotice(`Removed ${label.name} from #${selectedPullRequest.number}`))
				.catch((error) => {
					updatePullRequest(selectedPullRequest.url, () => previousPullRequest)
					flashNotice(error instanceof Error ? error.message : String(error))
				})
		} else {
			updatePullRequest(selectedPullRequest.url, (pr) => ({
				...pr,
				labels: [...pr.labels, { name: label.name, color: label.color }],
			}))
			void addPullRequestLabel({ repository: selectedPullRequest.repository, number: selectedPullRequest.number, label: label.name })
				.then(() => flashNotice(`Added ${label.name} to #${selectedPullRequest.number}`))
				.catch((error) => {
					updatePullRequest(selectedPullRequest.url, () => previousPullRequest)
					flashNotice(error instanceof Error ? error.message : String(error))
				})
		}
	}

	useKeyboard((key) => {
		if (key.name === "q" || (key.ctrl && key.name === "c")) {
			if (mergeModal.open) {
				setMergeModal(initialMergeModalState)
				return
			}
			if (labelModal.open) {
				setLabelModal(initialLabelModalState)
				return
			}
			renderer.destroy()
			return
		}

		if (mergeModal.open) {
			const options = mergeModalOptions(mergeModal.info)
			if (key.name === "escape") {
				setMergeModal(initialMergeModalState)
				return
			}
			if ((key.name === "return" || key.name === "enter") && options.length > 0) {
				confirmMergeAction()
				return
			}
			if (key.name === "up" || key.name === "k") {
				setMergeModal((current) => ({
					...current,
					selectedIndex: Math.max(0, current.selectedIndex - 1),
				}))
				return
			}
			if (key.name === "down" || key.name === "j") {
				setMergeModal((current) => ({
					...current,
					selectedIndex: Math.min(Math.max(0, options.length - 1), current.selectedIndex + 1),
				}))
				return
			}
			return
		}

		// Label modal takes priority over everything else
		if (labelModal.open) {
			if (key.name === "escape") {
				setLabelModal(initialLabelModalState)
				return
			}
			if (key.name === "return" || key.name === "enter") {
				toggleLabelAtIndex()
				return
			}
			if (key.name === "up" || key.name === "k") {
				setLabelModal((current) => ({
					...current,
					selectedIndex: Math.max(0, current.selectedIndex - 1),
				}))
				return
			}
			if (key.name === "down" || key.name === "j") {
				const filtered = labelModal.availableLabels.filter((label) =>
					labelModal.query.length === 0 || label.name.toLowerCase().includes(labelModal.query.toLowerCase()),
				)
				setLabelModal((current) => ({
					...current,
					selectedIndex: Math.min(Math.max(0, filtered.length - 1), current.selectedIndex + 1),
				}))
				return
			}
			if (key.name === "backspace") {
				setLabelModal((current) => ({
					...current,
					query: current.query.slice(0, -1),
					selectedIndex: 0,
				}))
				return
			}
			if (key.ctrl && key.name === "u") {
				setLabelModal((current) => ({ ...current, query: "", selectedIndex: 0 }))
				return
			}
			if (!key.ctrl && !key.meta && key.sequence.length === 1) {
				setLabelModal((current) => ({
					...current,
					query: current.query + key.sequence,
					selectedIndex: 0,
				}))
				return
			}
			return
		}

		if (diffFullView) {
			if (key.name === "escape" || key.name === "return" || key.name === "enter") {
				setDiffFullView(false)
				return
			}
			if (key.name === "home") {
				diffScrollRef.current?.scrollTo({ x: 0, y: 0 })
				return
			}
			if (key.name === "end") {
				diffScrollRef.current?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER })
				return
			}
			if (key.name === "pageup") {
				diffScrollRef.current?.scrollBy({ x: 0, y: -halfPage })
				return
			}
			if (key.name === "pagedown") {
				diffScrollRef.current?.scrollBy({ x: 0, y: halfPage })
				return
			}
			if (isShiftG(key)) {
				diffScrollRef.current?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER })
				setPendingG(false)
				if (pendingGTimeoutRef.current !== null) {
					clearTimeout(pendingGTimeoutRef.current)
					pendingGTimeoutRef.current = null
				}
				return
			}
			if (key.name === "g") {
				if (pendingG) {
					diffScrollRef.current?.scrollTo({ x: 0, y: 0 })
					setPendingG(false)
					if (pendingGTimeoutRef.current !== null) {
						clearTimeout(pendingGTimeoutRef.current)
						pendingGTimeoutRef.current = null
					}
				} else {
					setPendingG(true)
					pendingGTimeoutRef.current = setTimeout(() => {
						setPendingG(false)
						pendingGTimeoutRef.current = null
					}, 500)
				}
				return
			}
			if (key.name === "up" || key.name === "k") {
				diffScrollRef.current?.scrollBy({ x: 0, y: -1 })
				return
			}
			if (key.name === "down" || key.name === "j") {
				diffScrollRef.current?.scrollBy({ x: 0, y: 1 })
				return
			}
			if (key.ctrl && key.name === "u") {
				diffScrollRef.current?.scrollBy({ x: 0, y: -halfPage })
				return
			}
			if (key.ctrl && (key.name === "d" || key.name === "v")) {
				diffScrollRef.current?.scrollBy({ x: 0, y: halfPage })
				return
			}
			if (key.name === "v") {
				setDiffRenderView((current) => current === "unified" ? "split" : "unified")
				return
			}
			if (key.name === "w") {
				setDiffWrapMode((current) => current === "none" ? "word" : "none")
				return
			}
			if (key.name === "r" && selectedPullRequest) {
				loadPullRequestDiff(selectedPullRequest, true)
				flashNotice(`Refreshing diff for #${selectedPullRequest.number}`)
				return
			}
			if ((key.name === "]" || key.name === "right" || key.name === "l") && selectedDiffState?.status === "ready") {
				setDiffFileIndex((current) => Math.min(Math.max(0, selectedDiffState.files.length - 1), current + 1))
				diffScrollRef.current?.scrollTo({ x: 0, y: 0 })
				return
			}
			if ((key.name === "[" || key.name === "left" || key.name === "h") && selectedDiffState?.status === "ready") {
				setDiffFileIndex((current) => Math.max(0, current - 1))
				diffScrollRef.current?.scrollTo({ x: 0, y: 0 })
				return
			}
			if (key.name === "o" && selectedPullRequest) {
				void Bun.spawn({ cmd: ["open", selectedPullRequest.url], stdout: "ignore", stderr: "ignore" })
				flashNotice(`Opened #${selectedPullRequest.number} in browser`)
				return
			}
			return
		}

		// Fullscreen detail mode handles its own navigation keys.
		if (detailFullView) {
			if (key.name === "escape" || (key.name === "return" || key.name === "enter")) {
				setDetailFullView(false)
				setDetailScrollOffset(0)
				return
			}
			if (key.name === "home") {
				detailScrollRef.current?.scrollTo({ x: 0, y: 0 })
				setDetailScrollOffset(0)
				return
			}
			if (key.name === "end" || isShiftG(key)) {
				detailScrollRef.current?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER })
				setDetailScrollOffset(Number.MAX_SAFE_INTEGER)
				setPendingG(false)
				if (pendingGTimeoutRef.current !== null) {
					clearTimeout(pendingGTimeoutRef.current)
					pendingGTimeoutRef.current = null
				}
				return
			}
			if (key.name === "pageup") {
				detailScrollRef.current?.scrollBy({ x: 0, y: -halfPage })
				setDetailScrollOffset((current) => Math.max(0, current - halfPage))
				return
			}
			if (key.name === "pagedown") {
				detailScrollRef.current?.scrollBy({ x: 0, y: halfPage })
				setDetailScrollOffset((current) => current + halfPage)
				return
			}
			if (key.name === "g") {
				if (pendingG) {
					detailScrollRef.current?.scrollTo({ x: 0, y: 0 })
					setDetailScrollOffset(0)
					setPendingG(false)
					if (pendingGTimeoutRef.current !== null) {
						clearTimeout(pendingGTimeoutRef.current)
						pendingGTimeoutRef.current = null
					}
				} else {
					setPendingG(true)
					pendingGTimeoutRef.current = setTimeout(() => {
						setPendingG(false)
						pendingGTimeoutRef.current = null
					}, 500)
				}
				return
			}
			if (key.name === "up" || key.name === "k") {
				detailScrollRef.current?.scrollBy({ x: 0, y: -1 })
				setDetailScrollOffset((current) => Math.max(0, current - 1))
				return
			}
			if (key.name === "down" || key.name === "j") {
				detailScrollRef.current?.scrollBy({ x: 0, y: 1 })
				setDetailScrollOffset((current) => current + 1)
				return
			}
			if (key.ctrl && key.name === "u") {
				detailScrollRef.current?.scrollBy({ x: 0, y: -halfPage })
				setDetailScrollOffset((current) => Math.max(0, current - halfPage))
				return
			}
			if (key.ctrl && (key.name === "d" || key.name === "v")) {
				detailScrollRef.current?.scrollBy({ x: 0, y: halfPage })
				setDetailScrollOffset((current) => current + halfPage)
				return
			}
			if (key.name === "o" && selectedPullRequest) {
				void Bun.spawn({ cmd: ["open", selectedPullRequest.url], stdout: "ignore", stderr: "ignore" })
				flashNotice(`Opened #${selectedPullRequest.number} in browser`)
				return
			}
			if (key.name === "y" && selectedPullRequest) {
				void copyPullRequestMetadata(selectedPullRequest)
					.then(() => flashNotice(`Copied #${selectedPullRequest.number} metadata`))
					.catch((error) => flashNotice(error instanceof Error ? error.message : String(error)))
				return
			}
			return
		}

		if (filterMode) {
			if (key.name === "escape") {
				setFilterDraft(filterQuery)
				setFilterMode(false)
				return
			}
			if (key.name === "enter") {
				setFilterQuery(filterDraft)
				setFilterMode(false)
				return
			}
			if (key.ctrl && key.name === "u") {
				setFilterDraft("")
				return
			}
			if (key.ctrl && key.name === "w") {
				setFilterDraft((current) => deleteLastWord(current))
				return
			}
			if (key.name === "backspace") {
				setFilterDraft((current) => current.slice(0, -1))
				return
			}
			if (!key.ctrl && !key.meta && key.sequence.length === 1 && key.name !== "return") {
				setFilterDraft((current) => current + key.sequence)
				return
			}
		}

		if (key.name === "/") {
			setFilterDraft(filterQuery)
			setFilterMode(true)
			return
		}
		if (key.name === "escape" && filterQuery.length > 0) {
			setFilterQuery("")
			setFilterDraft("")
			setFilterMode(false)
			return
		}
		if (key.name === "r") {
			refreshPullRequests("Refreshing pull requests...")
			return
		}
		if (
			key.name === "[" ||
			((key.option || key.meta) && (key.name === "up" || key.name === "k")) ||
			(key.shift && key.name === "k") ||
			key.name === "K"
		) {
			setSelectedIndex((current) => {
				if (visiblePullRequests.length === 0 || groupStarts.length === 0) return 0
				const currentGroup = getCurrentGroupIndex(current)
				if (currentGroup <= 0) return groupStarts[groupStarts.length - 1]!
				return groupStarts[currentGroup - 1]!
			})
			return
		}
		if (
			key.name === "]" ||
			((key.option || key.meta) && (key.name === "down" || key.name === "j")) ||
			(key.shift && key.name === "j") ||
			key.name === "J"
		) {
			setSelectedIndex((current) => {
				if (visiblePullRequests.length === 0 || groupStarts.length === 0) return 0
				const currentGroup = getCurrentGroupIndex(current)
				if (currentGroup >= groupStarts.length - 1) return groupStarts[0]!
				return groupStarts[currentGroup + 1]!
			})
			return
		}
		if (key.ctrl && key.name === "u") {
			setSelectedIndex((current) => {
				if (visiblePullRequests.length === 0) return 0
				return Math.max(0, current - halfPage)
			})
			return
		}
		if (key.ctrl && key.name === "d") {
			setSelectedIndex((current) => {
				if (visiblePullRequests.length === 0) return 0
				return Math.min(visiblePullRequests.length - 1, current + halfPage)
			})
			return
		}
		if (key.name === "up" || key.name === "k") {
			setSelectedIndex((current) => {
				if (visiblePullRequests.length === 0) return 0
				return current <= 0 ? visiblePullRequests.length - 1 : current - 1
			})
			return
		}
		if (key.name === "down" || key.name === "j") {
			setSelectedIndex((current) => {
				if (visiblePullRequests.length === 0) return 0
				return current >= visiblePullRequests.length - 1 ? 0 : current + 1
			})
			return
		}
		// Vim-style navigation: gg to go to top, G to go to bottom
		if (isShiftG(key)) {
			setSelectedIndex((_current) => {
				if (visiblePullRequests.length === 0) return 0
				return visiblePullRequests.length - 1
			})
			return
		}
		if (key.name === "g") {
			if (pendingG) {
				setSelectedIndex(0)
				setPendingG(false)
				if (pendingGTimeoutRef.current !== null) {
					clearTimeout(pendingGTimeoutRef.current)
					pendingGTimeoutRef.current = null
				}
			} else {
				setPendingG(true)
				pendingGTimeoutRef.current = setTimeout(() => {
					setPendingG(false)
					pendingGTimeoutRef.current = null
				}, 500)
			}
			return
		}
		if ((key.name === "return" || key.name === "enter") && !detailFullView) {
			setDetailFullView(true)
			setDetailScrollOffset(0)
			return
		}
		if (key.name === "p" && selectedPullRequest) {
			openDiffView()
			return
		}
		if (key.name === "l" && selectedPullRequest) {
			openLabelModal()
			return
		}
		if (key.name === "m" || key.name === "M") {
			if (selectedPullRequest) openMergeModal()
			return
		}
		if (key.name === "o" && selectedPullRequest) {
			void Bun.spawn({ cmd: ["open", selectedPullRequest.url], stdout: "ignore", stderr: "ignore" })
			flashNotice(`Opened #${selectedPullRequest.number} in browser`)
			return
		}
		if ((key.name === "d" || key.name === "D") && selectedPullRequest) {
			const previousPullRequest = selectedPullRequest
			const nextReviewStatus = selectedPullRequest.reviewStatus === "draft" ? "review" : "draft"
			updatePullRequest(selectedPullRequest.url, (pullRequest) => ({
				...pullRequest,
				reviewStatus: nextReviewStatus,
			}))
			void toggleDraftStatus({ repository: selectedPullRequest.repository, number: selectedPullRequest.number, isDraft: selectedPullRequest.reviewStatus === "draft" })
				.then(() => {
					flashNotice(selectedPullRequest.reviewStatus === "draft" ? `Marked #${selectedPullRequest.number} ready` : `Marked #${selectedPullRequest.number} draft`)
				})
				.catch((error) => {
					updatePullRequest(selectedPullRequest.url, () => previousPullRequest)
					flashNotice(error instanceof Error ? error.message : String(error))
				})
			return
		}
		if (key.name === "y" && selectedPullRequest) {
			void copyPullRequestMetadata(selectedPullRequest)
				.then(() => {
					flashNotice(`Copied #${selectedPullRequest.number} metadata`)
				})
				.catch((error) => {
					flashNotice(error instanceof Error ? error.message : String(error))
				})
		}
	})

	const fullscreenContentWidth = Math.max(24, contentWidth - 2)
	const fullscreenBodyLines = Math.max(8, (height ?? 24) - 8)

	const prListProps = {
		groups: visibleGroups,
		selectedUrl: selectedPullRequest?.url ?? null,
		status: pullRequestStatus,
		error: pullRequestError,
		filterText: visibleFilterText,
		showFilterBar: filterMode || filterQuery.length > 0,
		isFilterEditing: filterMode,
		onSelectPullRequest: selectPullRequestByUrl,
	} as const

	const longestLabelName = labelModal.availableLabels.reduce((max, label) => Math.max(max, label.name.length), 0)
	const labelModalWidth = Math.min(Math.max(42, longestLabelName + 16), 56, contentWidth - 4)
	const labelModalHeight = Math.min(20, (height ?? 24) - 4)
	const labelModalLeft = Math.floor((contentWidth - labelModalWidth) / 2)
	const labelModalTop = Math.floor(((height ?? 24) - labelModalHeight) / 2)
	const mergeModalWidth = Math.min(68, Math.max(46, contentWidth - 12))
	const mergeModalHeight = Math.min(16, (height ?? 24) - 4)
	const mergeModalLeft = Math.floor((contentWidth - mergeModalWidth) / 2)
	const mergeModalTop = Math.floor(((height ?? 24) - mergeModalHeight) / 2)

	return (
		<box flexGrow={1} flexDirection="column">
			<box paddingLeft={1} paddingRight={1} flexDirection="column">
				<PlainLine text={headerLine} fg={colors.muted} bold />
			</box>
			{isWideLayout && !detailFullView && !diffFullView && !isInitialLoading ? (
				<Divider width={contentWidth} junctionAt={dividerJunctionAt} junctionChar="┬" />
			) : (
				<Divider width={contentWidth} />
			)}
			{isInitialLoading ? (
				<LoadingPane content={detailPlaceholderContent} width={contentWidth} height={wideBodyHeight} />
			) : diffFullView ? (
				<PullRequestDiffPane
					pullRequest={selectedPullRequest}
					diffState={selectedDiffState}
					fileIndex={diffFileIndex}
					view={effectiveDiffRenderView}
					wrapMode={diffWrapMode}
					paneWidth={contentWidth}
					height={wideBodyHeight}
					loadingIndicator={loadingIndicator}
					scrollRef={diffScrollRef}
				/>
			) : isWideLayout && detailFullView ? (
				<box flexGrow={1} flexDirection="column">
					<scrollbox ref={detailScrollRef} focused flexGrow={1}>
						<DetailsPane
							pullRequest={selectedPullRequest}
							contentWidth={fullscreenContentWidth}
							bodyLines={fullscreenBodyLines}
							paneWidth={contentWidth}
							showChecks
							placeholderContent={detailPlaceholderContent}
							loadingIndicator={loadingIndicator}
						/>
					</scrollbox>
				</box>
			) : isWideLayout ? (
				<box flexGrow={1} flexDirection="row">
					<box width={leftPaneWidth} height={wideBodyHeight} flexDirection="column" paddingLeft={sectionPadding} paddingRight={sectionPadding}>
						<scrollbox height={wideBodyHeight} flexGrow={0}>
							<PullRequestList {...prListProps} contentWidth={leftContentWidth} />
						</scrollbox>
					</box>
					<SeparatorColumn height={wideBodyHeight} junctionRows={detailJunctions} />
					<box width={rightPaneWidth} height={wideBodyHeight} flexDirection="column">
						{selectedPullRequest ? (
							<>
								<DetailHeader pullRequest={selectedPullRequest} contentWidth={rightContentWidth} paneWidth={rightPaneWidth} showChecks />
								<scrollbox flexGrow={1}>
									<DetailBody pullRequest={selectedPullRequest} contentWidth={rightContentWidth} bodyLines={wideDetailLines} loadingIndicator={loadingIndicator} />
								</scrollbox>
							</>
						) : (
							<DetailPlaceholder content={detailPlaceholderContent} paneWidth={rightPaneWidth} />
						)}
					</box>
				</box>
			) : detailFullView ? (
				<box flexGrow={1} flexDirection="column">
					<scrollbox ref={detailScrollRef} focused flexGrow={1}>
						<DetailsPane
							pullRequest={selectedPullRequest}
							contentWidth={fullscreenContentWidth}
							bodyLines={fullscreenBodyLines}
							paneWidth={contentWidth}
							placeholderContent={detailPlaceholderContent}
							loadingIndicator={loadingIndicator}
						/>
					</scrollbox>
				</box>
			) : (
				<>
					<DetailsPane pullRequest={selectedPullRequest} contentWidth={rightContentWidth} paneWidth={contentWidth} placeholderContent={detailPlaceholderContent} loadingIndicator={loadingIndicator} />
					<Divider width={contentWidth} />
					<box flexGrow={1} flexDirection="column">
						<scrollbox flexGrow={1}>
							<box paddingLeft={sectionPadding} paddingRight={sectionPadding}>
								<PullRequestList {...prListProps} contentWidth={leftContentWidth} />
							</box>
						</scrollbox>
					</box>
				</>
			)}

			{isWideLayout && !detailFullView && !diffFullView && !isInitialLoading ? (
				<Divider width={contentWidth} junctionAt={dividerJunctionAt} junctionChar="┴" />
			) : (
				<Divider width={contentWidth} />
			)}
			<box paddingLeft={1} paddingRight={1}>
				{footerNotice ? (
					<PlainLine text={footerNotice} fg={colors.count} />
				) : (
					<FooterHints
						filterEditing={filterMode}
						showFilterClear={filterMode || filterQuery.length > 0}
						detailFullView={detailFullView}
						diffFullView={diffFullView}
						hasSelection={selectedPullRequest !== null}
						hasError={pullRequestStatus === "error"}
						isLoading={pullRequestStatus === "loading"}
						loadingIndicator={loadingIndicator}
						retryProgress={retryProgress}
					/>
				)}
			</box>
			{labelModal.open ? (
				<LabelModal
					state={labelModal}
					currentLabels={selectedPullRequest?.labels ?? []}
					modalWidth={labelModalWidth}
					modalHeight={labelModalHeight}
					offsetLeft={labelModalLeft}
					offsetTop={labelModalTop}
					loadingIndicator={loadingIndicator}
				/>
			) : null}
			{mergeModal.open ? (
				<MergeModal
					state={mergeModal}
					modalWidth={mergeModalWidth}
					modalHeight={mergeModalHeight}
					offsetLeft={mergeModalLeft}
					offsetTop={mergeModalTop}
					loadingIndicator={loadingIndicator}
				/>
			) : null}
		</box>
	)
}
