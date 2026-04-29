import { TextAttributes } from "@opentui/core"
import { useAtom, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { Cause, Effect, Schedule } from "effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { config } from "./config.js"
import type { CheckItem, PullRequestItem, PullRequestLabel } from "./domain.js"
import { daysOpen, formatRelativeDate, formatShortDate, formatTimestamp } from "./date.js"
import { GitHubService } from "./services/GitHubService.js"

const githubRuntime = Atom.runtime(GitHubService.layer)

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

interface RetryProgress {
	readonly attempt: number
	readonly max: number
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

const GROUP_ICON = "◆"

interface LabelModalState {
	readonly open: boolean
	readonly repository: string | null
	readonly query: string
	readonly selectedIndex: number
	readonly availableLabels: readonly PullRequestLabel[]
	readonly loading: boolean
}

const initialLabelModalState: LabelModalState = {
	open: false,
	repository: null,
	query: "",
	selectedIndex: 0,
	availableLabels: [],
	loading: false,
}

const labelModalAtom = Atom.make(initialLabelModalState).pipe(Atom.keepAlive)
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
const addPullRequestLabelAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly label: string }>()((input) =>
	GitHubService.use((github) => github.addPullRequestLabel(input.repository, input.number, input.label))
)
const removePullRequestLabelAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly label: string }>()((input) =>
	GitHubService.use((github) => github.removePullRequestLabel(input.repository, input.number, input.label))
)
const toggleDraftAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly isDraft: boolean }>()((input) =>
	GitHubService.use((github) => github.toggleDraftStatus(input.repository, input.number, input.isDraft))
)

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

const reviewIcon = (pullRequest: PullRequestItem) => {
	if (pullRequest.reviewStatus === "draft") return "◌"
	if (pullRequest.reviewStatus === "approved") return "✓"
	if (pullRequest.reviewStatus === "changes") return "!"
	if (pullRequest.reviewStatus === "review") return "◐"
	return "·"
}

const getRowLayout = (contentWidth: number, numberWidth = 6) => {
	const reviewWidth = 1
	const checkWidth = 6
	const ageWidth = 4
	const leftWidth = Math.max(24, contentWidth - reviewWidth - checkWidth - ageWidth - 2) // -2 for spaces between columns
	const titleWidth = Math.max(8, leftWidth - numberWidth - 2)
	return { reviewWidth, checkWidth, ageWidth, numberWidth, titleWidth }
}

const groupNumberWidth = (pullRequests: readonly PullRequestItem[]) => {
	if (pullRequests.length === 0) return 4
	const maxLen = Math.max(...pullRequests.map((pr) => String(pr.number).length))
	return maxLen + 1 // +1 for the # prefix
}

const fitCell = (text: string, width: number, align: "left" | "right" = "left") => {
	const trimmed = text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text
	return align === "right" ? trimmed.padStart(width, " ") : trimmed.padEnd(width, " ")
}

const centerCell = (text: string, width: number) => {
	const trimmed = text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text
	const left = Math.floor((width - trimmed.length) / 2)
	return `${" ".repeat(Math.max(0, left))}${trimmed}`.padEnd(width, " ")
}

const Divider = ({ width, junctionAt, junctionChar }: { width: number; junctionAt?: number; junctionChar?: string }) => {
	if (junctionAt === undefined || junctionChar === undefined || junctionAt < 0 || junctionAt >= width) {
		return <PlainLine text={"─".repeat(Math.max(1, width))} fg={colors.separator} />
	}

	return <PlainLine text={`${"─".repeat(junctionAt)}${junctionChar}${"─".repeat(Math.max(0, width - junctionAt - 1))}`} fg={colors.separator} />
}

const SeparatorColumn = ({ height, junctionRows }: { height: number; junctionRows?: readonly number[] }) => {
	const junctions = new Set(junctionRows)
	return (
		<box width={1} height={height} flexDirection="column">
			{Array.from({ length: height }, (_, index) => (
				<PlainLine key={index} text={junctions.has(index) ? "├" : "│"} fg={colors.separator} />
			))}
		</box>
	)
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

const fallbackLabelColor = (name: string) => {
	let hash = 0
	for (const char of name) {
		hash = (hash * 31 + char.charCodeAt(0)) >>> 0
	}
	const hue = hash % 360
	return `hsl(${hue} 55% 35%)`
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

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

	await copyToClipboard(lines.join("\n"))
}

const clipboardCommands = () => {
	if (process.platform === "darwin") return [["pbcopy"]]
	if (process.platform === "linux") {
		return [
			...(process.env.WAYLAND_DISPLAY ? [["wl-copy"]] : []),
			["xclip", "-selection", "clipboard"],
			["xsel", "--clipboard", "--input"],
		]
	}
	return []
}

const copyToClipboard = async (text: string) => {
	const commands = clipboardCommands()
	let lastError = ""

	for (const command of commands) {
		let proc: Bun.Subprocess<"pipe", "ignore", "pipe">
		try {
			proc = Bun.spawn({
				cmd: command,
				stdin: "pipe",
				stdout: "ignore",
				stderr: "pipe",
			})
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error)
			continue
		}

		if (!proc.stdin) {
			lastError = "Clipboard is not available"
			continue
		}

		proc.stdin.write(text)
		proc.stdin.end()

		const exitCode = await proc.exited
		if (exitCode === 0) return

		const stderr = await Bun.readableStreamToText(proc.stderr)
		lastError = stderr.trim()
	}

	const installHint = process.platform === "linux" ? " Install wl-clipboard, xclip, or xsel." : ""
	throw new Error(lastError || `Could not copy PR metadata.${installHint}`)
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

const FooterHints = ({
	filterEditing,
	showFilterClear,
	detailFullView,
	hasSelection,
	hasError,
	isLoading,
	loadingIndicator,
	retryProgress,
}: {
	filterEditing: boolean
	showFilterClear: boolean
	detailFullView: boolean
	hasSelection: boolean
	hasError: boolean
	isLoading: boolean
	loadingIndicator: string
	retryProgress: RetryProgress | null
}) => {
	if (filterEditing) {
		return (
			<TextLine>
				<span fg={colors.count}>search</span>
				<span fg={colors.muted}> typing  </span>
				<span fg={colors.count}>↑↓</span>
				<span fg={colors.muted}> move  </span>
				<span fg={colors.count}>enter</span>
				<span fg={colors.muted}> apply  </span>
				<span fg={colors.count}>esc</span>
				<span fg={colors.muted}> cancel  </span>
				<span fg={colors.count}>ctrl-u</span>
				<span fg={colors.muted}> clear  </span>
				<span fg={colors.count}>ctrl-w</span>
				<span fg={colors.muted}> word</span>
			</TextLine>
		)
	}

	return (
		<TextLine>
			<span fg={colors.count}>/</span>
			<span fg={colors.muted}> filter  </span>
			{showFilterClear ? (
				<>
					<span fg={colors.count}>esc</span>
					<span fg={colors.muted}> clear  </span>
				</>
			) : null}
			{retryProgress ? (
				<>
					<span fg={colors.status.pending}>retry</span>
					<span fg={colors.muted}> {retryProgress.attempt}/{retryProgress.max}  </span>
				</>
			) : isLoading ? (
				<>
					<span fg={colors.status.pending}>{loadingIndicator}</span>
					<span fg={colors.muted}> loading  </span>
				</>
			) : null}
			<span fg={colors.count}>r</span>
			<span fg={colors.muted}>{hasError ? " retry  " : " ref  "}</span>
			{hasSelection ? (
				<>
					<span fg={colors.count}>↑↓</span>
					<span fg={colors.muted}> move  </span>
				</>
			) : null}
			{hasSelection && detailFullView ? (
				<>
					<span fg={colors.count}>esc</span>
					<span fg={colors.muted}> back  </span>
				</>
			) : hasSelection ? (
				<>
					<span fg={colors.count}>enter</span>
					<span fg={colors.muted}> expand  </span>
				</>
			) : null}
			{hasSelection ? (
				<>
					<span fg={colors.count}>d</span>
					<span fg={colors.muted}> draft  </span>
					<span fg={colors.count}>l</span>
					<span fg={colors.muted}> labels  </span>
					<span fg={colors.count}>o</span>
					<span fg={colors.muted}> open  </span>
					<span fg={colors.count}>y</span>
					<span fg={colors.muted}> copy  </span>
				</>
			) : null}
			<span fg={colors.count}>q</span>
			<span fg={colors.muted}> quit</span>
		</TextLine>
	)
}

const GroupTitle = ({ label, color, icon }: { label: string; color: string; icon: string }) => (
	<TextLine>
		<span fg={color}>{icon} </span>
		<span fg={color} attributes={TextAttributes.BOLD}>{label}</span>
	</TextLine>
)

const PullRequestRow = ({
	pullRequest,
	selected,
	contentWidth,
	numWidth,
	onSelect,
}: {
	pullRequest: PullRequestItem
	selected: boolean
	contentWidth: number
	numWidth: number
	onSelect: () => void
}) => {
	const checkText = checkLabel(pullRequest)?.replace(/^checks\s+/, "") ?? ""
	const ageText = `${daysOpen(pullRequest.createdAt)}d`
	const { reviewWidth, checkWidth, ageWidth, numberWidth, titleWidth } = getRowLayout(contentWidth, numWidth)

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
	groupIcon,
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
	groupIcon: string
	onSelectPullRequest: (url: string) => void
}) => {
	const itemCount = groups.reduce((count, [, pullRequests]) => count + pullRequests.length, 0)
	const emptyText = filterText.length > 0 ? "- No matching pull requests." : "- No open pull requests."

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
			{status === "ready" && itemCount === 0 ? <PlainLine text={emptyText} fg={colors.muted} /> : null}
			{groups.map(([repo, pullRequests]) => {
				const numWidth = groupNumberWidth(pullRequests)
				return (
					<Fragment key={repo}>
						<box flexDirection="column">
							<GroupTitle label={repo} color={repoColor(repo)} icon={groupIcon} />
							{pullRequests.map((pullRequest) => (
								<PullRequestRow
									key={pullRequest.url}
									pullRequest={pullRequest}
									selected={pullRequest.url === selectedUrl}
									contentWidth={contentWidth}
									numWidth={numWidth}
									onSelect={() => onSelectPullRequest(pullRequest.url)}
								/>
							))}
						</box>
					</Fragment>
				)
			})}
		</box>
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
				const rightSide = statusParts.length > 0 ? `${statusParts.join(" ")}  ${opened}` : opened
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
						{statusParts.length > 0 ? <span fg={colors.muted}>  </span> : null}
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
					{labels.length > 0 ? labels.map((label, index) => (
						<Fragment key={label.name}>
							{index > 0 ? <span fg={colors.muted}> </span> : null}
							<span bg={labelColor(label)} fg={labelTextColor(labelColor(label))}> {label.name} </span>
						</Fragment>
					)) : <span fg={colors.muted}>no labels</span>}
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
}: {
	pullRequest: PullRequestItem
	contentWidth: number
	bodyLines?: number
}) => {
	const previewLines = useMemo(
		() => bodyPreview(pullRequest.body, contentWidth, bodyLines),
		[pullRequest.body, contentWidth, bodyLines],
	)

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
}: {
	pullRequest: PullRequestItem | null
	contentWidth: number
	bodyLines?: number
	paneWidth?: number
	showChecks?: boolean
	placeholderContent: DetailPlaceholderContent
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
	const contentHeight = pullRequest ? titleLines + 2 + 1 + checksHeight + previewLines.length : bodyLines + DETAIL_PLACEHOLDER_ROWS + 1

	return (
		<box flexDirection="column" height={contentHeight}>
			{pullRequest ? (
				<>
					<DetailHeader pullRequest={pullRequest} contentWidth={contentWidth} paneWidth={paneWidth} showChecks={showChecks} />
					<DetailBody pullRequest={pullRequest} contentWidth={contentWidth} bodyLines={bodyLines} />
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

const LabelModal = ({
	state,
	currentLabels,
	modalWidth,
	modalHeight,
	offsetLeft,
	offsetTop,
	loadingIndicator,
}: {
	state: LabelModalState
	currentLabels: readonly PullRequestLabel[]
	modalWidth: number
	modalHeight: number
	offsetLeft: number
	offsetTop: number
	loadingIndicator: string
}) => {
	const contentWidth = Math.max(16, modalWidth - 2)
	const currentNames = new Set(currentLabels.map((l) => l.name.toLowerCase()))
	const filtered = state.availableLabels.filter((label) =>
		state.query.length === 0 || label.name.toLowerCase().includes(state.query.toLowerCase()),
	)
	const maxVisible = Math.max(1, modalHeight - 6)
	const selectedIndex = filtered.length === 0 ? 0 : Math.max(0, Math.min(state.selectedIndex, filtered.length - 1))
	const scrollStart = Math.min(
		Math.max(0, filtered.length - maxVisible),
		Math.max(0, selectedIndex - maxVisible + 1),
	)
	const visibleLabels = filtered.slice(scrollStart, scrollStart + maxVisible)
	const title = state.repository ? `Labels  ${shortRepoName(state.repository)}` : "Labels"
	const countText = state.loading ? "loading" : `${filtered.length}/${state.availableLabels.length}`
	const headerGap = Math.max(1, contentWidth - title.length - countText.length)
	const queryText = state.query.length > 0 ? state.query : "type to filter labels"
	const queryPrefix = state.query.length > 0 ? "/ " : "/ "
	const queryWidth = Math.max(1, contentWidth - queryPrefix.length)

	return (
		<box
			position="absolute"
			left={offsetLeft}
			top={offsetTop}
			width={modalWidth}
			height={modalHeight}
			flexDirection="column"
			backgroundColor="#1a1a2e"
		>
			<box height={1} paddingLeft={1} paddingRight={1}>
				<TextLine>
					<span fg={colors.accent} attributes={TextAttributes.BOLD}>{title}</span>
					<span fg={colors.muted}>{" ".repeat(headerGap)}</span>
					<span fg={colors.muted}>{countText}</span>
				</TextLine>
			</box>
			<box height={1} paddingLeft={1} paddingRight={1}>
				<TextLine>
					<span fg={colors.count}>{queryPrefix}</span>
					<span fg={state.query.length > 0 ? colors.text : colors.muted}>
						{fitCell(queryText, queryWidth)}
					</span>
				</TextLine>
			</box>
			<Divider width={modalWidth} />
			<box flexDirection="column" paddingLeft={1} paddingRight={1}>
				{state.loading ? (
					<PlainLine text={centerCell(`${loadingIndicator} Loading labels`, contentWidth)} fg={colors.muted} />
				) : visibleLabels.length === 0 ? (
					<PlainLine text={centerCell(state.query.length > 0 ? "No matching labels" : "No labels found", contentWidth)} fg={colors.muted} />
				) : (
					visibleLabels.map((label, index) => {
						const actualIndex = scrollStart + index
						const isActive = currentNames.has(label.name.toLowerCase())
						const isSelected = actualIndex === selectedIndex
						const status = isActive ? "added" : ""
						const nameWidth = Math.max(8, contentWidth - 10 - status.length)
						const gap = Math.max(1, contentWidth - 8 - Math.min(label.name.length, nameWidth) - status.length)
						return (
							<box key={label.name} height={1}>
								<TextLine bg={isSelected ? colors.selectedBg : undefined}>
									<span fg={isSelected ? colors.accent : colors.muted}>{isSelected ? "›" : " "}</span>
									<span fg={isActive ? colors.status.passing : colors.muted}>{isActive ? " ✓ " : "   "}</span>
									<span bg={labelColor(label)}>  </span>
									<span fg={isSelected ? colors.selectedText : colors.text}> {fitCell(label.name, nameWidth)}</span>
									<span fg={colors.muted}>{" ".repeat(gap)}</span>
									{status ? <span fg={colors.status.passing}>{status}</span> : null}
								</TextLine>
							</box>
						)
					})
				)}
			</box>
			<box flexGrow={1} />
			<Divider width={modalWidth} />
			<box height={1} paddingLeft={1} paddingRight={1}>
				<TextLine>
					<span fg={colors.count}>↑↓</span>
					<span fg={colors.muted}> move  </span>
					<span fg={colors.count}>enter</span>
					<span fg={colors.muted}> toggle  </span>
					<span fg={colors.count}>/type</span>
					<span fg={colors.muted}> filter  </span>
					<span fg={colors.count}>esc</span>
					<span fg={colors.muted}> close</span>
					{filtered.length > maxVisible ? <span fg={colors.muted}>  {selectedIndex + 1}/{filtered.length}</span> : null}
				</TextLine>
			</box>
		</box>
	)
}

export const App = () => {
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
	const [labelModal, setLabelModal] = useAtom(labelModalAtom)
	const [labelCache, setLabelCache] = useAtom(labelCacheAtom)
	const [pullRequestOverrides, setPullRequestOverrides] = useAtom(pullRequestOverridesAtom)
	const retryProgress = useAtomValue(retryProgressAtom)
	const [loadingFrame, setLoadingFrame] = useState(0)
	const usernameResult = useAtomValue(usernameAtom)
	const loadRepoLabels = useAtomSet(listRepoLabelsAtom, { mode: "promise" })
	const addPullRequestLabel = useAtomSet(addPullRequestLabelAtom, { mode: "promise" })
	const removePullRequestLabel = useAtomSet(removePullRequestLabelAtom, { mode: "promise" })
	const toggleDraftStatus = useAtomSet(toggleDraftAtom, { mode: "promise" })
	const groupIcon = GROUP_ICON
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

	const pullRequestLoad = AsyncResult.getOrElse(pullRequestResult, () => null)
	const pullRequests = pullRequestLoad?.data.map((pullRequest) => pullRequestOverrides[pullRequest.url] ?? pullRequest) ?? []
	const pullRequestStatus: LoadStatus = pullRequestResult.waiting && pullRequestLoad === null
		? "loading"
		: AsyncResult.isFailure(pullRequestResult)
			? "error"
			: "ready"
	const isInitialLoading = pullRequestStatus === "loading" && pullRequests.length === 0
	const pullRequestError = AsyncResult.isFailure(pullRequestResult) ? errorMessage(Cause.squash(pullRequestResult.cause)) : null
	const username = AsyncResult.isSuccess(usernameResult) ? usernameResult.value : null

	useEffect(() => {
		if (pullRequestStatus !== "loading") return
		const interval = globalThis.setInterval(() => {
			setLoadingFrame((current) => (current + 1) % LOADING_FRAMES.length)
		}, 120)
		return () => globalThis.clearInterval(interval)
	}, [pullRequestStatus])

	const effectiveFilterQuery = (filterMode ? filterDraft : filterQuery).trim().toLowerCase()
	const visibleFilterText = filterMode ? filterDraft : filterQuery

	const filteredPullRequests = pullRequests.filter((pullRequest) => {
		const query = effectiveFilterQuery
		if (query.length === 0) return true
		return [pullRequest.title, pullRequest.repository, String(pullRequest.number)]
			.some((value) => value.toLowerCase().includes(query))
	})

	const visibleGroups = groupBy(
		filteredPullRequests,
		(pullRequest) => pullRequest.repository,
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
		setPullRequestOverrides({})
		refreshPullRequestsAtom()
		if (message) flashNotice(message)
	}

	useEffect(() => {
		setSelectedIndex((current) => {
			if (visiblePullRequests.length === 0) return 0
			return Math.max(0, Math.min(current, visiblePullRequests.length - 1))
		})
	}, [visiblePullRequests.length])

	const selectedPullRequest = visiblePullRequests[selectedIndex] ?? null
	const loadingIndicator = LOADING_FRAMES[loadingFrame % LOADING_FRAMES.length]!
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

	const openLabelModal = () => {
		if (!selectedPullRequest) return
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
			if (labelModal.open) {
				setLabelModal(initialLabelModalState)
				return
			}
			if (key.name === "q") {
				process.exit(0)
			}
			process.exit(0)
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

		// Fullscreen detail mode: scroll with j/k, Ctrl-D/U, exit with Escape/Enter
		if (detailFullView) {
			if (key.name === "escape" || (key.name === "return" || key.name === "enter")) {
				setDetailFullView(false)
				setDetailScrollOffset(0)
				return
			}
			if (key.name === "up" || key.name === "k") {
				setDetailScrollOffset((current) => Math.max(0, current - 1))
				return
			}
			if (key.name === "down" || key.name === "j") {
				setDetailScrollOffset((current) => current + 1)
				return
			}
			if (key.ctrl && key.name === "u") {
				setDetailScrollOffset((current) => Math.max(0, current - halfPage))
				return
			}
			if (key.ctrl && (key.name === "d" || key.name === "v")) {
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
		if (key.name === "G" || key.name === "g" && key.shift) {
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
		if (key.name === "l" && selectedPullRequest) {
			openLabelModal()
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
		groupIcon,
		onSelectPullRequest: selectPullRequestByUrl,
	} as const

	const labelModalWidth = Math.min(40, contentWidth - 4)
	const labelModalHeight = Math.min(20, (height ?? 24) - 4)
	const labelModalLeft = Math.floor((contentWidth - labelModalWidth) / 2)
	const labelModalTop = Math.floor(((height ?? 24) - labelModalHeight) / 2)

	return (
		<box flexGrow={1} flexDirection="column">
			<box paddingLeft={1} paddingRight={1} flexDirection="column">
				<PlainLine text={headerLine} fg={colors.muted} bold />
			</box>
			{isWideLayout && !detailFullView && !isInitialLoading ? (
				<Divider width={contentWidth} junctionAt={dividerJunctionAt} junctionChar="┬" />
			) : (
				<Divider width={contentWidth} />
			)}
			{isInitialLoading ? (
				<LoadingPane content={detailPlaceholderContent} width={contentWidth} height={wideBodyHeight} />
			) : isWideLayout && detailFullView ? (
				<box flexGrow={1} flexDirection="column">
					<scrollbox flexGrow={1}>
						<DetailsPane
							pullRequest={selectedPullRequest}
							contentWidth={fullscreenContentWidth}
							bodyLines={fullscreenBodyLines}
							paneWidth={contentWidth}
							showChecks
							placeholderContent={detailPlaceholderContent}
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
									<DetailBody pullRequest={selectedPullRequest} contentWidth={rightContentWidth} bodyLines={wideDetailLines} />
								</scrollbox>
							</>
						) : (
							<DetailPlaceholder content={detailPlaceholderContent} paneWidth={rightPaneWidth} />
						)}
					</box>
				</box>
			) : detailFullView ? (
				<box flexGrow={1} flexDirection="column">
					<scrollbox flexGrow={1}>
						<DetailsPane
							pullRequest={selectedPullRequest}
							contentWidth={fullscreenContentWidth}
							bodyLines={fullscreenBodyLines}
							paneWidth={contentWidth}
							placeholderContent={detailPlaceholderContent}
						/>
					</scrollbox>
				</box>
			) : (
				<>
					<DetailsPane pullRequest={selectedPullRequest} contentWidth={rightContentWidth} paneWidth={contentWidth} placeholderContent={detailPlaceholderContent} />
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

			{isWideLayout && !detailFullView && !isInitialLoading ? (
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
		</box>
	)
}
