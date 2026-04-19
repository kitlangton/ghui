import { TextAttributes } from "@opentui/core"
import { useAtom } from "@effect/atom-react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import * as Atom from "effect/unstable/reactivity/Atom"
import { Fragment, useEffect, useMemo, useRef } from "react"
import { config } from "./config.js"
import type { PullRequestItem, PullRequestLabel } from "./domain.js"
import { daysOpen, formatShortDate, formatTimestamp } from "./date.js"
import { listOpenPullRequests as loadOpenPullRequests, toggleBetaLabel, toggleDraftStatus } from "./services/GitHubService.js"

const toggleDraft = (repository: string, number: number, isDraft: boolean) => toggleDraftStatus(repository, number, isDraft)
const toggleBeta = (repository: string, number: number, hasBeta: boolean) => toggleBetaLabel(repository, number, hasBeta)

const colors = {
	text: "#ede7da",
	muted: "#9f9788",
	separator: "#6f685d",
	accent: "#f4a51c",
	inlineCode: "#d7c5a1",
	error: "#f97316",
	selectedBg: "#1d2430",
	selectedText: "#f8fafc",
	count: "#d7c5a1",
	status: {
		draft: "#f59e0b",
		approved: "#7dd3a3",
		changes: "#f87171",
		review: "#93c5fd",
		none: "#9f9788",
		passing: "#7dd3a3",
		pending: "#f4a51c",
		failing: "#f87171",
	},
	repos: {
		opencode: "#60a5fa",
		"effect-smol": "#34d399",
		"opencode-console": "#f472b6",
		opencontrol: "#f59e0b",
		default: "#93c5fd",
	},
} as const

type LoadStatus = "loading" | "ready" | "error"

interface PullRequestState {
	readonly status: LoadStatus
	readonly data: readonly PullRequestItem[]
	readonly error: string | null
	readonly fetchedAt: Date | null
}

interface PreviewLine {
	readonly segments: ReadonlyArray<{
		readonly text: string
		readonly fg: string
		readonly bold?: boolean
	}>
}

const pullRequestReferencePattern = /(#[0-9]+)/g

const initialPullRequestState: PullRequestState = {
	status: "loading",
	data: [],
	error: null,
	fetchedAt: null,
}

const pullRequestStateAtom = Atom.make(initialPullRequestState).pipe(Atom.keepAlive)
const selectedIndexAtom = Atom.make(0).pipe(Atom.keepAlive)
const noticeAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive)
const refreshNonceAtom = Atom.make(0).pipe(Atom.keepAlive)
const filterQueryAtom = Atom.make("").pipe(Atom.keepAlive)
const filterDraftAtom = Atom.make("").pipe(Atom.keepAlive)
const filterModeAtom = Atom.make(false).pipe(Atom.keepAlive)
const pendingGAtom = Atom.make(false).pipe(Atom.keepAlive)
const detailFullViewAtom = Atom.make(false).pipe(Atom.keepAlive)

const shortRepoName = (repository: string) => repository.split("/")[1] ?? repository

const repoColor = (repository: string) => colors.repos[shortRepoName(repository) as keyof typeof colors.repos] ?? colors.repos.default

const BlankRow = () => <box height={1} />

const reviewLabel = (pullRequest: PullRequestItem) => {
	if (pullRequest.reviewStatus === "draft") return "draft"
	if (pullRequest.reviewStatus === "approved") return "approved"
	if (pullRequest.reviewStatus === "changes") return "changes"
	if (pullRequest.reviewStatus === "review") return "review"
	return null
}

const checkLabel = (pullRequest: PullRequestItem) => pullRequest.checkSummary

const statusColor = (status: PullRequestItem["reviewStatus"] | PullRequestItem["checkStatus"]) => colors.status[status]
const SEPARATOR = " • "
const DETAIL_BODY_LINES = 6
const DETAIL_DIVIDER_ROW = 7

const reviewIcon = (pullRequest: PullRequestItem) => {
	if (pullRequest.reviewStatus === "draft") return "◌"
	if (pullRequest.reviewStatus === "approved") return "✓"
	if (pullRequest.reviewStatus === "changes") return "!"
	if (pullRequest.reviewStatus === "review") return "◐"
	return "·"
}

const getRowLayout = (contentWidth: number) => {
	const reviewWidth = 1
	const checkWidth = 8
	const ageWidth = 9
	const leftWidth = Math.max(24, contentWidth - reviewWidth - checkWidth - ageWidth)
	const numberWidth = 6
	const titleWidth = Math.max(8, leftWidth - numberWidth - 2)
	return { reviewWidth, checkWidth, ageWidth, numberWidth, titleWidth }
}

const fitCell = (text: string, width: number, align: "left" | "right" = "left") => {
	const trimmed = text.length > width ? `${text.slice(0, Math.max(0, width - 3))}...` : text
	return align === "right" ? trimmed.padStart(width, " ") : trimmed.padEnd(width, " ")
}

const Divider = ({ width, junctionAt, junctionChar }: { width: number; junctionAt?: number; junctionChar?: string }) => {
	if (junctionAt === undefined || junctionChar === undefined || junctionAt < 0 || junctionAt >= width) {
		return <PlainLine text={"─".repeat(Math.max(1, width))} fg={colors.separator} />
	}

	return <PlainLine text={`${"─".repeat(junctionAt)}${junctionChar}${"─".repeat(Math.max(0, width - junctionAt - 1))}`} fg={colors.separator} />
}

const SeparatorColumn = ({ height, junctionRow }: { height: number; junctionRow?: number }) => (
	<box width={1} height={height} flexDirection="column">
		{Array.from({ length: height }, (_, index) => (
			<PlainLine key={index} text={junctionRow === index ? "├" : "│"} fg={colors.separator} />
		))}
	</box>
)

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

const hasLabel = (pullRequest: PullRequestItem, label: string) => pullRequest.labels.some((current) => current.name.toLowerCase() === label.toLowerCase())

const fallbackLabelColor = (name: string) => {
	let hash = 0
	for (const char of name) {
		hash = (hash * 31 + char.charCodeAt(0)) >>> 0
	}
	const hue = hash % 360
	return `hsl(${hue} 55% 35%)`
}

const labelColor = (label: PullRequestLabel) => label.color ?? fallbackLabelColor(label.name)

const labelTextColor = (color: string) => {
	if (color.startsWith("#") && color.length === 7) {
		const red = Number.parseInt(color.slice(1, 3), 16)
		const green = Number.parseInt(color.slice(3, 5), 16)
		const blue = Number.parseInt(color.slice(5, 7), 16)
		const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
		return luminance > 0.6 ? "#111111" : "#f8fafc"
	}
	return "#f8fafc"
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

const PlainLine = ({ text, fg = colors.text, bold = false }: { text: string; fg?: string; bold?: boolean }) => (
	<box height={1}>
		{bold ? (
			<text wrapMode="none" truncate fg={fg} attributes={TextAttributes.BOLD}>
				{text}
			</text>
		) : (
			<text wrapMode="none" truncate fg={fg}>
				{text}
			</text>
		)}
	</box>
)

const TextLine = ({ children, fg = colors.text, bg }: { children: React.ReactNode; fg?: string; bg?: string | undefined }) => (
	<box height={1}>
		{bg ? (
			<text wrapMode="none" truncate fg={fg} bg={bg}>
				{children}
			</text>
		) : (
			<text wrapMode="none" truncate fg={fg}>
				{children}
			</text>
		)}
	</box>
)

const SectionTitle = ({ title }: { title: string }) => (
	<TextLine>
		<span fg={colors.accent} attributes={TextAttributes.BOLD}>
			{title}
		</span>
	</TextLine>
)

const FooterHints = ({ showFilterClear, detailFullView }: { showFilterClear: boolean; detailFullView: boolean }) => (
	<TextLine>
		<span fg={colors.count}>up/down</span>
		<span fg={colors.muted}> move  </span>
		<span fg={colors.count}>gg/G</span>
		<span fg={colors.muted}> jump  </span>
		<span fg={colors.count}>/</span>
		<span fg={colors.muted}> filter  </span>
		{showFilterClear ? (
			<>
				<span fg={colors.count}>esc</span>
				<span fg={colors.muted}> clear  </span>
			</>
		) : null}
		{detailFullView ? (
			<>
				<span fg={colors.count}>esc/enter</span>
				<span fg={colors.muted}> list  </span>
			</>
		) : (
			<>
				<span fg={colors.count}>enter</span>
				<span fg={colors.muted}> full  </span>
			</>
		)}
		<span fg={colors.count}>r</span>
		<span fg={colors.muted}> ref  </span>
		<span fg={colors.count}>d</span>
		<span fg={colors.muted}> draft  </span>
		<span fg={colors.count}>b</span>
		<span fg={colors.muted}> beta  </span>
		<span fg={colors.count}>o</span>
		<span fg={colors.muted}> open  </span>
		<span fg={colors.count}>y</span>
		<span fg={colors.muted}> copy  </span>
		<span fg={colors.count}>q</span>
		<span fg={colors.muted}> quit</span>
	</TextLine>
)

const GroupTitle = ({ label, color }: { label: string; color: string }) => (
	<TextLine>
		<span fg={color} attributes={TextAttributes.BOLD}>
			◆ {label}
		</span>
	</TextLine>
)

const PullRequestRow = ({
	pullRequest,
	selected,
	contentWidth,
	onSelect,
}: {
	pullRequest: PullRequestItem
	selected: boolean
	contentWidth: number
	onSelect: () => void
}) => {
	const checkText = checkLabel(pullRequest)?.replace(/^checks\s+/, "") ?? ""
	const ageText = `${daysOpen(pullRequest.createdAt)}d`
	const { reviewWidth, checkWidth, ageWidth, numberWidth, titleWidth } = getRowLayout(contentWidth)

	return (
		<box height={1} onMouseDown={onSelect}>
			<TextLine fg={selected ? colors.selectedText : colors.text} bg={selected ? colors.selectedBg : undefined}>
				<span fg={statusColor(pullRequest.reviewStatus)}>{fitCell(reviewIcon(pullRequest), reviewWidth)}</span>
				<span> </span>
				<span fg={selected ? colors.accent : colors.count}>{fitCell(`#${pullRequest.number}`, numberWidth, "right")}</span>
				<span> </span>
				<span>{fitCell(pullRequest.title, titleWidth)}</span>
				<span fg={statusColor(pullRequest.checkStatus)}>{fitCell(checkText, checkWidth, "right")}</span>
				<span fg={colors.muted}>{fitCell(ageText, ageWidth, "right")}</span>
			</TextLine>
		</box>
	)
}

const groupBy = <T,>(items: readonly T[], getKey: (item: T) => string, orderedKeys: readonly string[] = []) => {
	const groups = new Map<string, T[]>()
	for (const item of items) {
		const key = getKey(item)
		const existing = groups.get(key)
		if (existing) {
			existing.push(item)
		} else {
			groups.set(key, [item])
		}
	}

	const order = new Map(orderedKeys.map((key, index) => [key, index]))
	return [...groups.entries()].sort((left, right) => {
		const leftIndex = order.get(left[0])
		const rightIndex = order.get(right[0])
		if (leftIndex !== undefined && rightIndex !== undefined) return leftIndex - rightIndex
		if (leftIndex !== undefined) return -1
		if (rightIndex !== undefined) return 1
		return left[0].localeCompare(right[0])
	})
}

type PullRequestGroups = Array<[string, PullRequestItem[]]>

const PullRequestList = ({
	groups,
	selectedUrl,
	status,
	error,
	contentWidth,
	filterText,
	showFilterBar,
	isFilterEditing,
	onSelectPullRequest,
}: {
	groups: PullRequestGroups
	selectedUrl: string | null
	status: LoadStatus
	error: string | null
	contentWidth: number
	filterText: string
	showFilterBar: boolean
	isFilterEditing: boolean
	onSelectPullRequest: (url: string) => void
}) => {
	const itemCount = groups.reduce((count, [, pullRequests]) => count + pullRequests.length, 0)

	return (
		<box flexDirection="column">
			<SectionTitle title="PULL REQUESTS" />
			{showFilterBar ? (
				<TextLine>
					<span fg={colors.count}>/</span>
					<span fg={colors.muted}> </span>
					<span fg={isFilterEditing ? colors.text : colors.count}>{filterText.length > 0 ? filterText : "type to filter..."}</span>
				</TextLine>
			) : null}
			{status === "loading" && itemCount === 0 ? <PlainLine text="- Loading pull requests..." fg={colors.muted} /> : null}
			{status === "error" ? <PlainLine text={`- ${error ?? "Could not load pull requests."}`} fg={colors.error} /> : null}
			{status === "ready" && itemCount === 0 ? <PlainLine text={filterText.length > 0 ? "- No matching pull requests." : "- No open pull requests."} fg={colors.muted} /> : null}
			{groups.map(([repo, pullRequests]) => (
				<Fragment key={repo}>
					<box flexDirection="column">
						<GroupTitle label={repo} color={repoColor(repo)} />
						{pullRequests.map((pullRequest) => (
							<PullRequestRow
								key={pullRequest.url}
								pullRequest={pullRequest}
								selected={pullRequest.url === selectedUrl}
								contentWidth={contentWidth}
								onSelect={() => onSelectPullRequest(pullRequest.url)}
							/>
						))}
					</box>
				</Fragment>
			))}
		</box>
	)
}

const DetailsPane = ({
	pullRequest,
	contentWidth,
	bodyLines = DETAIL_BODY_LINES,
	paneWidth = contentWidth + 2,
}: {
	pullRequest: PullRequestItem | null
	contentWidth: number
	bodyLines?: number
	paneWidth?: number
}) => {
	const previewLines = useMemo(
		() => (pullRequest ? bodyPreview(pullRequest.body, contentWidth, bodyLines) : []),
		[pullRequest?.body, contentWidth, bodyLines],
	)
	const paddedPreviewLines = [
		...previewLines,
		...Array.from({ length: Math.max(0, bodyLines - previewLines.length) }, () => ({ segments: [{ text: "", fg: colors.muted }] } satisfies PreviewLine)),
	]
	const labels = pullRequest?.labels ?? []

	return (
		<box flexDirection="column" height={bodyLines + 7}>
			<box paddingLeft={1} paddingRight={1}>
				<SectionTitle title="DETAILS" />
			</box>
			{pullRequest ? (
				<>
					<box flexDirection="column" paddingLeft={1} paddingRight={1}>
						<TextLine>
							<span>{pullRequest.title}</span>
						</TextLine>
						{(() => {
						const review = reviewLabel(pullRequest) ?? "none"
						const checks = (pullRequest.checkSummary ?? "none").replace(/^checks\s+/, "")
						const repoAndNumber = `${shortRepoName(pullRequest.repository)}${SEPARATOR}#${pullRequest.number}`
						const gap = Math.max(2, contentWidth - repoAndNumber.length - review.length - checks.length - SEPARATOR.length)

						return (
							<TextLine>
								<span fg={repoColor(pullRequest.repository)}>{shortRepoName(pullRequest.repository)}</span>
								<span fg={colors.separator}>{SEPARATOR}</span>
								<span fg={colors.count}>#{pullRequest.number}</span>
								<span fg={colors.muted}>{" ".repeat(gap)}</span>
								<span fg={statusColor(pullRequest.reviewStatus)}>{review}</span>
								<span fg={colors.separator}>{SEPARATOR}</span>
								<span fg={statusColor(pullRequest.checkStatus)}>{checks}</span>
							</TextLine>
						)
					})()}
						{(() => {
						const opened = formatShortDate(pullRequest.createdAt)
						const age = `${daysOpen(pullRequest.createdAt)}d`
						const gap = Math.max(2, contentWidth - opened.length - age.length)

						return (
							<TextLine>
								<span fg={colors.muted}>{opened}</span>
								<span fg={colors.muted}>{" ".repeat(gap)}</span>
								<span fg={colors.muted}>{age}</span>
							</TextLine>
						)
					})()}
						<PlainLine text={pullRequest.url} fg={colors.muted} />
						<TextLine>
							{labels.length > 0 ? labels.map((label, index) => (
								<Fragment key={label.name}>
									{index > 0 ? <span fg={colors.muted}> </span> : null}
									<span bg={labelColor(label)} fg={labelTextColor(labelColor(label))}> {label.name} </span>
								</Fragment>
							)) : <span fg={colors.muted}>no labels</span>}
						</TextLine>
					</box>
					<Divider width={paneWidth} />
					<box flexDirection="column" paddingLeft={1} paddingRight={1}>
						{paddedPreviewLines.map((line, index) => (
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
				</>
			) : (
				<>
					<box flexDirection="column" paddingLeft={1} paddingRight={1}>
						<PlainLine text="Select a pull request with up/down." fg={colors.muted} />
						{Array.from({ length: DETAIL_BODY_LINES + 2 }, (_, index) => (
							<BlankRow key={index} />
						))}
					</box>
				</>
			)}
		</box>
	)
}

export const App = () => {
	const { width, height } = useTerminalDimensions()
	const [pullRequestState, setPullRequestState] = useAtom(pullRequestStateAtom)
	const [selectedIndex, setSelectedIndex] = useAtom(selectedIndexAtom)
	const [notice, setNotice] = useAtom(noticeAtom)
	const [refreshNonce, setRefreshNonce] = useAtom(refreshNonceAtom)
	const [filterQuery, setFilterQuery] = useAtom(filterQueryAtom)
	const [filterDraft, setFilterDraft] = useAtom(filterDraftAtom)
	const [filterMode, setFilterMode] = useAtom(filterModeAtom)
	const [pendingG, setPendingG] = useAtom(pendingGAtom)
	const [detailFullView, setDetailFullView] = useAtom(detailFullViewAtom)
	const contentWidth = Math.max(60, width ?? 100)
	const isWideLayout = (width ?? 100) >= 140
	const splitGap = 1
	const sectionPadding = 1
	const leftPaneWidth = isWideLayout ? Math.max(44, Math.floor((contentWidth - splitGap) * 0.56)) : contentWidth
	const rightPaneWidth = isWideLayout ? Math.max(28, contentWidth - leftPaneWidth - splitGap) : contentWidth
	const dividerJunctionAt = Math.max(1, leftPaneWidth)
	const leftContentWidth = isWideLayout ? Math.max(24, leftPaneWidth - 3) : Math.max(24, contentWidth - sectionPadding * 2)
	const rightContentWidth = isWideLayout ? Math.max(24, rightPaneWidth - sectionPadding * 2) : Math.max(24, contentWidth - sectionPadding * 2)
	const wideDetailLines = Math.max(8, Math.min(16, (height ?? 24) - 12))
	const wideBodyHeight = Math.max(8, (height ?? 24) - 5)
	const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const pendingGTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
	}, [])

	useEffect(() => {
		let cancelled = false

		setPullRequestState((current) => ({
			...current,
			status: current.fetchedAt === null ? "loading" : "ready",
			error: null,
		}))

		loadOpenPullRequests()
			.then((pullRequests) => {
				if (cancelled) return
				setPullRequestState({
					status: "ready",
					data: pullRequests,
					error: null,
					fetchedAt: new Date(),
				})
			})
			.catch((error) => {
				if (cancelled) return
				setPullRequestState((current) => ({
					...current,
					status: "error",
					error: error instanceof Error ? error.message : String(error),
				}))
			})

		return () => {
			cancelled = true
		}
	}, [refreshNonce])

	const effectiveFilterQuery = (filterMode ? filterDraft : filterQuery).trim().toLowerCase()
	const visibleFilterText = filterMode ? filterDraft : filterQuery

	const filteredPullRequests = pullRequestState.data.filter((pullRequest) => {
		const query = effectiveFilterQuery
		if (query.length === 0) return true
		return [pullRequest.title, pullRequest.repository, String(pullRequest.number)]
			.some((value) => value.toLowerCase().includes(query))
	})

	const visibleGroups = groupBy(
		filteredPullRequests,
		(pullRequest) => shortRepoName(pullRequest.repository),
		config.repos.map(shortRepoName),
	)
	const visiblePullRequests = visibleGroups.flatMap(([, pullRequests]) => pullRequests)
	const groupStarts = visibleGroups.reduce<Array<number>>((starts, [, pullRequests], index) => {
		if (index === 0) {
			starts.push(0)
			return starts
		}
		starts.push(starts[index - 1]! + visibleGroups[index - 1]![1].length)
		return starts
	}, [])
	const getCurrentGroupIndex = (current: number) => {
		for (let index = groupStarts.length - 1; index >= 0; index--) {
			if (groupStarts[index]! <= current) return index
		}
		return 0
	}
	const repoNames = config.repos.map(shortRepoName)
	const reposLine = `repos: ${repoNames.join(", ")}`
	const summaryRight = pullRequestState.fetchedAt
		? `updated ${formatShortDate(pullRequestState.fetchedAt)} ${formatTimestamp(pullRequestState.fetchedAt)}`
		: pullRequestState.status === "loading"
			? "loading pull requests..."
			: ""
	const headerLeft = `GHUI  ${reposLine}`
	const headerLine = `${fitCell(headerLeft, Math.max(0, headerFooterWidth - summaryRight.length))}${summaryRight}`
	const footerNotice = notice ? fitCell(notice, headerFooterWidth) : null
	const selectPullRequestByUrl = (url: string) => {
		const index = visiblePullRequests.findIndex((pullRequest) => pullRequest.url === url)
		if (index >= 0) setSelectedIndex(index)
	}
	const updatePullRequest = (url: string, transform: (pullRequest: PullRequestItem) => PullRequestItem) => {
		setPullRequestState((current) => ({
			...current,
			data: current.data.map((pullRequest) => (pullRequest.url === url ? transform(pullRequest) : pullRequest)),
		}))
	}
	const refreshPullRequests = (message?: string) => {
		setRefreshNonce((current) => current + 1)
		if (message) flashNotice(message)
	}

	useEffect(() => {
		setSelectedIndex((current) => {
			if (visiblePullRequests.length === 0) return 0
			return Math.max(0, Math.min(current, visiblePullRequests.length - 1))
		})
	}, [visiblePullRequests.length])

	const selectedPullRequest = visiblePullRequests[selectedIndex] ?? null

	useKeyboard((key) => {
		if (key.name === "q" || (key.ctrl && key.name === "c")) {
			process.exit(0)
		}

		if (detailFullView) {
			if (key.name === "escape" || key.name === "return" || key.name === "enter") {
				setDetailFullView(false)
				return
			}
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
		if (key.name === "G" || key.name === "g" && key.shift) {
			setSelectedIndex((current) => {
				if (visiblePullRequests.length === 0) return 0
				return visiblePullRequests.length - 1
			})
			return
		}
		if (key.name === "g") {
			if (pendingG) {
				// Second g - go to top
				setSelectedIndex(0)
				setPendingG(false)
				if (pendingGTimeoutRef.current !== null) {
					clearTimeout(pendingGTimeoutRef.current)
					pendingGTimeoutRef.current = null
				}
			} else {
				// First g - set pending and start timeout
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
			void toggleDraft(selectedPullRequest.repository, selectedPullRequest.number, selectedPullRequest.reviewStatus === "draft")
				.then(() => {
					flashNotice(selectedPullRequest.reviewStatus === "draft" ? `Marked #${selectedPullRequest.number} ready` : `Marked #${selectedPullRequest.number} draft`)
				})
				.catch((error) => {
					updatePullRequest(selectedPullRequest.url, () => previousPullRequest)
					flashNotice(error instanceof Error ? error.message : String(error))
				})
			return
		}
		if ((key.name === "b" || key.name === "B") && selectedPullRequest) {
			const previousPullRequest = selectedPullRequest
			const nextHasBeta = !hasLabel(selectedPullRequest, "beta")
			updatePullRequest(selectedPullRequest.url, (pullRequest) => ({
				...pullRequest,
				labels: hasLabel(pullRequest, "beta")
					? pullRequest.labels.filter((label) => label.name.toLowerCase() !== "beta")
					: [...pullRequest.labels, { name: "beta", color: "#5C17FD" }],
			}))
			void toggleBeta(selectedPullRequest.repository, selectedPullRequest.number, hasLabel(selectedPullRequest, "beta"))
				.then(() => {
					flashNotice(nextHasBeta ? `Added beta to #${selectedPullRequest.number}` : `Removed beta from #${selectedPullRequest.number}`)
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

	return (
		<box flexGrow={1} flexDirection="column">
			<box paddingLeft={1} paddingRight={1} flexDirection="column">
				<PlainLine text={headerLine} fg={colors.muted} bold />
			</box>
			{isWideLayout ? <Divider width={contentWidth} junctionAt={dividerJunctionAt} junctionChar="┬" /> : <Divider width={contentWidth} />}
			{isWideLayout ? (
				<box flexGrow={1} flexDirection="row">
					<box width={leftPaneWidth} height={wideBodyHeight} flexDirection="column" paddingLeft={sectionPadding} paddingRight={sectionPadding}>
						<scrollbox height={wideBodyHeight} flexGrow={0}>
							<PullRequestList
								groups={visibleGroups}
								selectedUrl={selectedPullRequest?.url ?? null}
								status={pullRequestState.status}
								error={pullRequestState.error}
								contentWidth={leftContentWidth}
								filterText={visibleFilterText}
								showFilterBar={filterMode || filterQuery.length > 0}
								isFilterEditing={filterMode}
								onSelectPullRequest={selectPullRequestByUrl}
							/>
						</scrollbox>
					</box>
					<SeparatorColumn height={wideBodyHeight} junctionRow={DETAIL_DIVIDER_ROW} />
					<box width={rightPaneWidth} height={wideBodyHeight} flexDirection="column">
						<scrollbox height={wideBodyHeight} flexGrow={0}>
							<DetailsPane pullRequest={selectedPullRequest} contentWidth={rightContentWidth} bodyLines={wideDetailLines} paneWidth={rightPaneWidth} />
						</scrollbox>
					</box>
				</box>
			) : detailFullView ? (
				<>
					<DetailsPane
						pullRequest={selectedPullRequest}
						contentWidth={rightContentWidth}
						bodyLines={Math.max(8, (height ?? 24) - 10)}
						paneWidth={contentWidth}
					/>
					<Divider width={contentWidth} />
					<box height={8} flexDirection="column">
						<scrollbox height={8}>
							<box paddingLeft={sectionPadding} paddingRight={sectionPadding}>
								<PullRequestList
									groups={visibleGroups}
									selectedUrl={selectedPullRequest?.url ?? null}
									status={pullRequestState.status}
									error={pullRequestState.error}
									contentWidth={leftContentWidth}
									filterText={visibleFilterText}
									showFilterBar={filterMode || filterQuery.length > 0}
									isFilterEditing={filterMode}
									onSelectPullRequest={selectPullRequestByUrl}
								/>
							</box>
						</scrollbox>
					</box>
				</>
			) : (
				<>
					<box flexGrow={1} flexDirection="column">
						<scrollbox flexGrow={1}>
							<box paddingLeft={sectionPadding} paddingRight={sectionPadding}>
								<PullRequestList
									groups={visibleGroups}
									selectedUrl={selectedPullRequest?.url ?? null}
									status={pullRequestState.status}
									error={pullRequestState.error}
									contentWidth={leftContentWidth}
									filterText={visibleFilterText}
									showFilterBar={filterMode || filterQuery.length > 0}
									isFilterEditing={filterMode}
									onSelectPullRequest={selectPullRequestByUrl}
								/>
							</box>
						</scrollbox>
					</box>
					<Divider width={contentWidth} />
					<DetailsPane pullRequest={selectedPullRequest} contentWidth={rightContentWidth} paneWidth={contentWidth} />
				</>
			)}

			{isWideLayout ? <Divider width={contentWidth} junctionAt={dividerJunctionAt} junctionChar="┴" /> : <Divider width={contentWidth} />}
			<box paddingLeft={1} paddingRight={1}>
				{footerNotice ? <PlainLine text={footerNotice} fg={colors.count} /> : <FooterHints showFilterClear={filterMode || filterQuery.length > 0} detailFullView={detailFullView} />}
			</box>
		</box>
	)
}
