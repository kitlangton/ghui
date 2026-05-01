import type { DiffRenderable, ScrollBoxRenderable } from "@opentui/core"
import { useAtom, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { Cause, Effect, Layer, Schedule } from "effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import { useEffect, useMemo, useRef, useState } from "react"
import { config } from "./config.js"
import { pullRequestQueueLabels, pullRequestQueueModes, type CreatePullRequestCommentInput, type DiffCommentSide, type PullRequestItem, type PullRequestLabel, type PullRequestMergeAction, type PullRequestQueueMode, type PullRequestReviewComment } from "./domain.js"
import { formatShortDate, formatTimestamp } from "./date.js"
import { availableMergeActions, mergeInfoFromPullRequest } from "./mergeActions.js"
import { Observability } from "./observability.js"
import { GitHubService } from "./services/GitHubService.js"
import { loadStoredThemeId, saveStoredThemeId } from "./themeStore.js"
import { colors, filterThemeDefinitions, setActiveTheme, themeDefinitions, type ThemeId } from "./ui/colors.js"
import { backspace as editorBackspace, deleteForward as editorDeleteForward, deleteToLineEnd, deleteToLineStart, deleteWordBackward, deleteWordForward, insertText, moveLeft as editorMoveLeft, moveLineEnd, moveLineStart, moveRight as editorMoveRight, moveVertically, moveWordBackward, moveWordForward, type CommentEditorValue } from "./ui/commentEditor.js"
import { buildStackedDiffFiles, diffCommentAnchorKey, diffCommentLocationKey, getStackedDiffCommentAnchors, nearestDiffCommentAnchorIndex, pullRequestDiffKey, safeDiffFileIndex, scrollTopForVisibleLine, splitPatchFiles, type DiffCommentAnchor, type PullRequestDiffState, type StackedDiffCommentAnchor } from "./ui/diff.js"
import { DetailBody, DetailHeader, DetailPlaceholder, DetailsPane, getDetailBodyHeight, getDetailHeaderHeight, getDetailJunctionRows, getDetailsPaneHeight, LoadingPane, type DetailPlaceholderContent } from "./ui/DetailsPane.js"
import { FooterHints, type RetryProgress } from "./ui/FooterHints.js"
import { Divider, fitCell, PlainLine, SeparatorColumn } from "./ui/primitives.js"
import { CloseModal, CommentModal, CommentThreadModal, initialCloseModalState, initialCommentModalState, initialCommentThreadModalState, initialLabelModalState, initialMergeModalState, initialModal, initialThemeModalState, LabelModal, MergeModal, Modal, ThemeModal, type CloseModalState, type CommentModalState, type CommentThreadModalState, type LabelModalState, type MergeModalState, type ModalState, type ModalTag, type ThemeModalState } from "./ui/modals.js"
import { groupBy, reviewLabel } from "./ui/pullRequests.js"
import { PullRequestDiffPane } from "./ui/PullRequestDiffPane.js"
import { PullRequestList } from "./ui/PullRequestList.js"

const githubRuntime = Atom.runtime(GitHubService.layer.pipe(Layer.provideMerge(Observability.layer)))
const initialThemeId = await Effect.runPromise(loadStoredThemeId)

type LoadStatus = "loading" | "ready" | "error"

interface PullRequestLoad {
	readonly queueMode: PullRequestQueueMode
	readonly data: readonly PullRequestItem[]
	readonly fetchedAt: Date | null
	readonly detailsFetchedAt: Date | null
}

interface DetailPlaceholderInput {
	readonly status: LoadStatus
	readonly retryProgress: RetryProgress | null
	readonly loadingIndicator: string
	readonly visibleCount: number
	readonly filterText: string
}

type DiffLineColorConfig = {
	readonly gutter: string
	readonly content: string
}

type DiffSideRenderable = {
	readonly setLineColor: (line: number, color: DiffLineColorConfig) => void
}

type DiffRenderableRuntimeSides = {
	readonly leftSide?: DiffSideRenderable
	readonly rightSide?: DiffSideRenderable
}

interface AppliedDiffLineColor {
	readonly anchor: StackedDiffCommentAnchor
	readonly view: "unified" | "split"
}

interface AppliedDiffLineColorState {
	readonly contextKey: string | null
	readonly entries: readonly AppliedDiffLineColor[]
}

const PR_FETCH_RETRIES = 6
const FOCUS_RETURN_REFRESH_MIN_MS = 60_000
const FOCUSED_IDLE_REFRESH_MS = 5 * 60_000
const AUTO_REFRESH_JITTER_MS = 10_000
const LOADING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

const mergeCachedDetails = (fresh: readonly PullRequestItem[], cached: readonly PullRequestItem[] | undefined) => {
	if (!cached) return fresh
	const cachedByUrl = new Map(cached.map((pullRequest) => [pullRequest.url, pullRequest]))
	return fresh.map((pullRequest) => {
		const cachedPullRequest = cachedByUrl.get(pullRequest.url)
		if (!cachedPullRequest?.detailLoaded) return pullRequest
		return {
			...pullRequest,
			body: cachedPullRequest.body,
			labels: cachedPullRequest.labels,
			additions: cachedPullRequest.additions,
			deletions: cachedPullRequest.deletions,
			changedFiles: cachedPullRequest.changedFiles,
			checkStatus: cachedPullRequest.checkStatus,
			checkSummary: cachedPullRequest.checkSummary,
			checks: cachedPullRequest.checks,
			detailLoaded: true,
		} satisfies PullRequestItem
	})
}

const retryProgressAtom = Atom.make<RetryProgress | null>(null).pipe(Atom.keepAlive)
const queueModeAtom = Atom.make<PullRequestQueueMode>("authored").pipe(Atom.keepAlive)
const queueLoadCacheAtom = Atom.make<Partial<Record<PullRequestQueueMode, PullRequestLoad>>>({}).pipe(Atom.keepAlive)
const queueSelectionAtom = Atom.make<Partial<Record<PullRequestQueueMode, number>>>({}).pipe(Atom.keepAlive)
const pullRequestsAtom = githubRuntime.atom(
	GitHubService.use((github) =>
		Effect.gen(function*() {
			const queueMode = yield* Atom.get(queueModeAtom)
			yield* Atom.set(retryProgressAtom, null)
			const data = yield* github.listOpenPullRequests(queueMode).pipe(
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
			const cache = yield* Atom.get(queueLoadCacheAtom)
			const load = {
				queueMode,
				data: mergeCachedDetails(data, cache[queueMode]?.data),
				fetchedAt: new Date(),
				detailsFetchedAt: null,
			} satisfies PullRequestLoad
			yield* Atom.set(queueLoadCacheAtom, { ...cache, [queueMode]: load })
			return load
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
const diffCommentModeAtom = Atom.make(false).pipe(Atom.keepAlive)
const diffCommentAnchorIndexAtom = Atom.make(0).pipe(Atom.keepAlive)
const diffCommentThreadsAtom = Atom.make<Record<string, readonly PullRequestReviewComment[]>>({}).pipe(Atom.keepAlive)
const diffCommentsLoadedAtom = Atom.make<Record<string, "loading" | "ready">>({}).pipe(Atom.keepAlive)
const pullRequestDiffCacheAtom = Atom.make<Record<string, PullRequestDiffState>>({}).pipe(Atom.keepAlive)

const activeModalAtom = Atom.make<Modal>(initialModal).pipe(Atom.keepAlive)
const themeIdAtom = Atom.make<ThemeId>(initialThemeId).pipe(Atom.keepAlive)
const labelCacheAtom = Atom.make<Record<string, readonly PullRequestLabel[]>>({}).pipe(Atom.keepAlive)
const pullRequestOverridesAtom = Atom.make<Record<string, PullRequestItem>>({}).pipe(Atom.keepAlive)
const recentlyCompletedPullRequestsAtom = Atom.make<Record<string, PullRequestItem>>({}).pipe(Atom.keepAlive)
const usernameAtom = githubRuntime.atom(
	config.author === "@me"
		? GitHubService.use((github) => github.getAuthenticatedUser())
		: Effect.succeed(config.author.replace(/^@/, "")),
).pipe(Atom.keepAlive)

const listRepoLabelsAtom = githubRuntime.fn<string>()((repository) =>
	GitHubService.use((github) => github.listRepoLabels(repository))
)
const listOpenPullRequestDetailsAtom = githubRuntime.fn<PullRequestQueueMode>()((queueMode) =>
	GitHubService.use((github) => github.listOpenPullRequestDetails(queueMode))
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
const listPullRequestCommentsAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number }>()((input) =>
	GitHubService.use((github) => github.listPullRequestComments(input.repository, input.number))
)
const getPullRequestMergeInfoAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number }>()((input) =>
	GitHubService.use((github) => github.getPullRequestMergeInfo(input.repository, input.number))
)
const mergePullRequestAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly action: PullRequestMergeAction }>()((input) =>
	GitHubService.use((github) => github.mergePullRequest(input.repository, input.number, input.action))
)
const closePullRequestAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number }>()((input) =>
	GitHubService.use((github) => github.closePullRequest(input.repository, input.number))
)
const createPullRequestCommentAtom = githubRuntime.fn<CreatePullRequestCommentInput>()((input) => GitHubService.use((github) => github.createPullRequestComment(input)))

const centeredOffset = (outer: number, inner: number) => Math.floor((outer - inner) / 2)

const deleteLastWord = (value: string) => value.replace(/\s*\S+\s*$/, "")

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const pullRequestFilterScore = (pullRequest: PullRequestItem, query: string) => {
	const normalized = query.trim().toLowerCase()
	if (normalized.length === 0) return 0
	const fields = [
		pullRequest.title.toLowerCase(),
		pullRequest.repository.toLowerCase(),
		String(pullRequest.number),
	]
	const scores = fields.flatMap((field, index) => {
		const matchIndex = field.indexOf(normalized)
		return matchIndex >= 0 ? [index * 1000 + matchIndex] : []
	})
	return scores.length > 0 ? Math.min(...scores) : null
}

const clipboardCommands = (): readonly (readonly string[])[] => {
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
				cmd: [...command],
				stdin: "pipe",
				stdout: "ignore",
				stderr: "pipe",
			})
		} catch (error) {
			lastError = errorMessage(error)
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
	throw new Error(lastError || `Clipboard is not available.${installHint}`)
}

const openPullRequestInBrowser = async (pullRequest: PullRequestItem) => {
	const proc = Bun.spawn({
		cmd: ["gh", "pr", "view", String(pullRequest.number), "--repo", pullRequest.repository, "--web"],
		stdout: "ignore",
		stderr: "pipe",
	})

	const exitCode = await proc.exited
	if (exitCode === 0) return

	const stderr = await Bun.readableStreamToText(proc.stderr)
	throw new Error(stderr.trim() || "Could not open PR in browser")
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

const isShiftG = (key: { readonly name: string; readonly shift?: boolean }) => key.name === "G" || key.name === "g" && key.shift

const isThemeKey = (key: { readonly name: string; readonly ctrl?: boolean; readonly meta?: boolean }) => !key.ctrl && !key.meta && key.name.toLowerCase() === "t"

const nextQueueMode = (mode: PullRequestQueueMode, delta: 1 | -1) => {
	const index = pullRequestQueueModes.indexOf(mode)
	return pullRequestQueueModes[(index + delta + pullRequestQueueModes.length) % pullRequestQueueModes.length]!
}

const diffCommentThreadKey = (pullRequest: PullRequestItem, comment: Pick<PullRequestReviewComment, "path" | "side" | "line">) =>
	`${pullRequestDiffKey(pullRequest)}:${diffCommentLocationKey(comment)}`

const groupDiffCommentThreads = (pullRequest: PullRequestItem, comments: readonly PullRequestReviewComment[]) => {
	const threads: Record<string, PullRequestReviewComment[]> = {}
	for (const comment of comments) {
		const key = diffCommentThreadKey(pullRequest, comment)
		const thread = threads[key]
		if (thread) thread.push(comment)
		else threads[key] = [comment]
	}
	return threads
}

const isLocalDiffComment = (comment: PullRequestReviewComment) => comment.id.startsWith("local:")

const originalDiffLineColor = (anchor: DiffCommentAnchor): DiffLineColorConfig => {
	if (anchor.kind === "addition") {
		return { gutter: colors.diff.addedLineNumberBg, content: colors.diff.addedBg }
	}
	if (anchor.kind === "deletion") {
		return { gutter: colors.diff.removedLineNumberBg, content: colors.diff.removedBg }
	}
	return { gutter: colors.diff.lineNumberBg, content: colors.diff.contextBg }
}

const diffSideTargets = (diff: DiffRenderable, anchor: DiffCommentAnchor, view: "unified" | "split") => {
	const withSides = diff as unknown as DiffRenderableRuntimeSides
	if (view === "split") {
		const target = anchor.side === "LEFT" ? withSides.leftSide : withSides.rightSide
		return target ? [target] : []
	}
	return withSides.leftSide ? [withSides.leftSide] : []
}

const setDiffCommentLineColor = (diff: DiffRenderable, entry: AppliedDiffLineColor, color: DiffLineColorConfig) => {
	for (const target of diffSideTargets(diff, entry.anchor, entry.view)) {
		target.setLineColor(entry.anchor.localRenderLine, color)
	}
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

export const App = () => {
	const renderer = useRenderer()
	const { width, height } = useTerminalDimensions()
	const pullRequestResult = useAtomValue(pullRequestsAtom)
	const refreshPullRequestsAtom = useAtomRefresh(pullRequestsAtom)
	const [queueMode, setQueueMode] = useAtom(queueModeAtom)
	const [queueLoadCache, setQueueLoadCache] = useAtom(queueLoadCacheAtom)
	const [queueSelection, setQueueSelection] = useAtom(queueSelectionAtom)
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
	const [diffCommentMode, setDiffCommentMode] = useAtom(diffCommentModeAtom)
	const [diffCommentAnchorIndex, setDiffCommentAnchorIndex] = useAtom(diffCommentAnchorIndexAtom)
	const [diffCommentThreads, setDiffCommentThreads] = useAtom(diffCommentThreadsAtom)
	const [diffCommentsLoaded, setDiffCommentsLoaded] = useAtom(diffCommentsLoadedAtom)
	const [pullRequestDiffCache, setPullRequestDiffCache] = useAtom(pullRequestDiffCacheAtom)
	const [activeModal, setActiveModal] = useAtom(activeModalAtom)
	const [themeId, setThemeId] = useAtom(themeIdAtom)
	const closeActiveModal = () => setActiveModal(initialModal)
	const labelModalActive = Modal.$is("Label")(activeModal)
	const closeModalActive = Modal.$is("Close")(activeModal)
	const mergeModalActive = Modal.$is("Merge")(activeModal)
	const commentModalActive = Modal.$is("Comment")(activeModal)
	const commentThreadModalActive = Modal.$is("CommentThread")(activeModal)
	const themeModalActive = Modal.$is("Theme")(activeModal)
	const labelModal: LabelModalState = labelModalActive ? activeModal : initialLabelModalState
	const closeModal: CloseModalState = closeModalActive ? activeModal : initialCloseModalState
	const mergeModal: MergeModalState = mergeModalActive ? activeModal : initialMergeModalState
	const commentModal: CommentModalState = commentModalActive ? activeModal : initialCommentModalState
	const commentThreadModal: CommentThreadModalState = commentThreadModalActive ? activeModal : initialCommentThreadModalState
	const themeModal: ThemeModalState = themeModalActive ? activeModal : initialThemeModalState
	const makeModalSetter = <Tag extends Exclude<ModalTag, "None">>(tag: Tag) =>
		(next: ModalState<Tag> | ((prev: ModalState<Tag>) => ModalState<Tag>)) => setActiveModal((current) => {
			const ctor = Modal[tag] as unknown as (args: ModalState<Tag>) => Modal
			if (typeof next === "function") {
				const updater = next as (prev: ModalState<Tag>) => ModalState<Tag>
				if (current._tag !== tag) return current
				return ctor(updater(current as unknown as ModalState<Tag>))
			}
			return ctor(next)
		})
	const setLabelModal = makeModalSetter("Label")
	const setCloseModal = makeModalSetter("Close")
	const setMergeModal = makeModalSetter("Merge")
	const setCommentModal = makeModalSetter("Comment")
	const setCommentThreadModal = makeModalSetter("CommentThread")
	const setThemeModal = makeModalSetter("Theme")
	setActiveTheme(themeId)
	const themeIdRef = useRef(themeId)
	const themeModalRef = useRef(themeModal)
	themeIdRef.current = themeId
	themeModalRef.current = themeModal
	const [labelCache, setLabelCache] = useAtom(labelCacheAtom)
	const [pullRequestOverrides, setPullRequestOverrides] = useAtom(pullRequestOverridesAtom)
	const [recentlyCompletedPullRequests, setRecentlyCompletedPullRequests] = useAtom(recentlyCompletedPullRequestsAtom)
	const retryProgress = useAtomValue(retryProgressAtom)
	const [loadingFrame, setLoadingFrame] = useState(0)
	const [refreshCompletionMessage, setRefreshCompletionMessage] = useState<string | null>(null)
	const [refreshStartedAt, setRefreshStartedAt] = useState<number | null>(null)
	const [terminalFocused, setTerminalFocused] = useState(true)
	const usernameResult = useAtomValue(usernameAtom)
	const loadRepoLabels = useAtomSet(listRepoLabelsAtom, { mode: "promise" })
	const loadPullRequestDetails = useAtomSet(listOpenPullRequestDetailsAtom, { mode: "promise" })
	const addPullRequestLabel = useAtomSet(addPullRequestLabelAtom, { mode: "promise" })
	const removePullRequestLabel = useAtomSet(removePullRequestLabelAtom, { mode: "promise" })
	const toggleDraftStatus = useAtomSet(toggleDraftAtom, { mode: "promise" })
	const getPullRequestDiff = useAtomSet(getPullRequestDiffAtom, { mode: "promise" })
	const listPullRequestComments = useAtomSet(listPullRequestCommentsAtom, { mode: "promise" })
	const getPullRequestMergeInfo = useAtomSet(getPullRequestMergeInfoAtom, { mode: "promise" })
	const mergePullRequest = useAtomSet(mergePullRequestAtom, { mode: "promise" })
	const closePullRequest = useAtomSet(closePullRequestAtom, { mode: "promise" })
	const createPullRequestComment = useAtomSet(createPullRequestCommentAtom, { mode: "promise" })
	const terminalWidth = width ?? 100
	const terminalHeight = height ?? 24
	const contentWidth = Math.max(1, terminalWidth)
	const isWideLayout = terminalWidth >= 100
	const splitGap = 1
	const sectionPadding = 1
	const leftPaneWidth = isWideLayout ? Math.max(44, Math.floor((contentWidth - splitGap) * 0.56)) : contentWidth
	const rightPaneWidth = isWideLayout ? Math.max(28, contentWidth - leftPaneWidth - splitGap) : contentWidth
	const dividerJunctionAt = Math.max(1, leftPaneWidth)
	const leftContentWidth = isWideLayout ? Math.max(24, leftPaneWidth - 3) : Math.max(24, contentWidth - sectionPadding * 2)
	const rightContentWidth = isWideLayout ? Math.max(24, rightPaneWidth - sectionPadding * 2) : Math.max(24, contentWidth - sectionPadding * 2)
	const wideDetailLines = Math.max(8, terminalHeight - 8) // fill available vertical space
	const wideBodyHeight = Math.max(8, terminalHeight - 4)
	const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const pendingGTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const diffPrefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const detailHydrationRef = useRef<number | null>(null)
	const refreshGenerationRef = useRef(0)
	const didMountQueueModeRef = useRef(false)
	const lastPullRequestRefreshAtRef = useRef(0)
	const terminalFocusedRef = useRef(true)
	const terminalWasBlurredRef = useRef(false)
	const pullRequestStatusRef = useRef<LoadStatus>("loading")
	const refreshPullRequestsRef = useRef<(message?: string) => void>(() => {})
	const maybeRefreshPullRequestsRef = useRef<(minimumAgeMs: number) => void>(() => {})
	const detailScrollRef = useRef<ScrollBoxRenderable | null>(null)
	const diffScrollRef = useRef<ScrollBoxRenderable | null>(null)
	const diffRenderableRefs = useRef(new Map<number, DiffRenderable>())
	const diffCommentLineColorsRef = useRef<AppliedDiffLineColorState>({ contextKey: null, entries: [] })
	const suppressNextDiffCommentScrollRef = useRef(false)
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

	useEffect(() => {
		renderer.setBackgroundColor(colors.background)
	}, [renderer, themeId])

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

	const resolvedPullRequestLoad = AsyncResult.getOrElse(pullRequestResult, () => null)
	const pullRequestLoad = queueLoadCache[queueMode] ?? (resolvedPullRequestLoad?.queueMode === queueMode ? resolvedPullRequestLoad : null)
	const isLoadingQueueMode = resolvedPullRequestLoad !== null && resolvedPullRequestLoad.queueMode !== queueMode
	const pullRequests = useMemo(() => {
		const source = pullRequestLoad?.data ?? []
		const seenUrls = new Set<string>()
		const openPullRequests = source.map((pullRequest) => {
			seenUrls.add(pullRequest.url)
			return recentlyCompletedPullRequests[pullRequest.url] ?? pullRequestOverrides[pullRequest.url] ?? pullRequest
		})

		return [
			...openPullRequests,
			...Object.values(recentlyCompletedPullRequests).filter((pullRequest) => !seenUrls.has(pullRequest.url)),
		]
	}, [pullRequestLoad?.data, pullRequestOverrides, recentlyCompletedPullRequests])
	const pullRequestStatus: LoadStatus = (pullRequestResult.waiting || isLoadingQueueMode) && pullRequestLoad === null
		? "loading"
		: AsyncResult.isFailure(pullRequestResult)
			? "error"
			: "ready"
	const isInitialLoading = pullRequestStatus === "loading" && pullRequests.length === 0
	const pullRequestError = AsyncResult.isFailure(pullRequestResult) ? errorMessage(Cause.squash(pullRequestResult.cause)) : null
	const username = AsyncResult.isSuccess(usernameResult) ? usernameResult.value : null
	pullRequestStatusRef.current = pullRequestStatus

	const effectiveFilterQuery = (filterMode ? filterDraft : filterQuery).trim().toLowerCase()
	const visibleFilterText = filterMode ? filterDraft : filterQuery

	const filteredPullRequests = useMemo(() => {
		if (effectiveFilterQuery.length === 0) return pullRequests
		return pullRequests.flatMap((pullRequest) => {
			const score = pullRequestFilterScore(pullRequest, effectiveFilterQuery)
			return score === null ? [] : [{ pullRequest, score }]
		}).sort((left, right) =>
			left.score - right.score || right.pullRequest.createdAt.getTime() - left.pullRequest.createdAt.getTime()
		).map(({ pullRequest }) => pullRequest)
	}, [pullRequests, effectiveFilterQuery])

	const visibleRepoOrder = useMemo(() => effectiveFilterQuery.length > 0
		? [...new Set(filteredPullRequests.map((pullRequest) => pullRequest.repository))]
		: [], [filteredPullRequests, effectiveFilterQuery.length])
	const visibleGroups = useMemo(
		() => groupBy(filteredPullRequests, (pullRequest) => pullRequest.repository, visibleRepoOrder),
		[filteredPullRequests, visibleRepoOrder],
	)
	const visiblePullRequests = useMemo(() => visibleGroups.flatMap(([, pullRequests]) => pullRequests), [visibleGroups])
	const selectedPullRequest = visiblePullRequests[selectedIndex] ?? null
	const selectedDiffState = selectedPullRequest ? pullRequestDiffCache[pullRequestDiffKey(selectedPullRequest)] : undefined
	const effectiveDiffRenderView = contentWidth >= 100 ? diffRenderView : "unified"
	const readyDiffFiles = selectedDiffState?.status === "ready" ? selectedDiffState.files : []
	const stackedDiffFiles = useMemo(() => buildStackedDiffFiles(readyDiffFiles, effectiveDiffRenderView, diffWrapMode, contentWidth), [readyDiffFiles, effectiveDiffRenderView, diffWrapMode, contentWidth])
	const selectedDiffKey = selectedPullRequest ? pullRequestDiffKey(selectedPullRequest) : null
	const selectedDiffCommentCount = useMemo(() => selectedDiffKey
		? Object.entries(diffCommentThreads)
			.filter(([key, comments]) => key.startsWith(`${selectedDiffKey}:`) && comments.length > 0)
			.reduce((count, [, comments]) => count + comments.length, 0)
		: 0, [diffCommentThreads, selectedDiffKey])
	const diffCommentAnchors = useMemo(
		() => diffFullView ? getStackedDiffCommentAnchors(stackedDiffFiles, effectiveDiffRenderView, diffWrapMode, contentWidth) : [],
		[diffFullView, stackedDiffFiles, effectiveDiffRenderView, diffWrapMode, contentWidth],
	)
	const selectedDiffCommentAnchor = diffCommentAnchors[Math.max(0, Math.min(diffCommentAnchorIndex, diffCommentAnchors.length - 1))] ?? null
	const selectedDiffCommentThreadKey = selectedDiffKey && selectedDiffCommentAnchor ? `${selectedDiffKey}:${diffCommentAnchorKey(selectedDiffCommentAnchor)}` : null
	const selectedDiffCommentThread = selectedDiffCommentThreadKey ? diffCommentThreads[selectedDiffCommentThreadKey] ?? [] : []
	const diffLineColorContextKey = selectedDiffKey ? `${selectedDiffKey}:${effectiveDiffRenderView}:${diffWrapMode}` : null
	const diffCommentRows = useMemo(
		() => [...new Set(diffCommentAnchors.map((anchor) => anchor.renderLine))].sort((left, right) => left - right),
		[diffCommentAnchors],
	)
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
	const headerLeft = username ? `GHUI  ${username}  ${pullRequestQueueLabels[queueMode]}` : `GHUI  ${pullRequestQueueLabels[queueMode]}`
	const headerLine = `${fitCell(headerLeft, Math.max(0, headerFooterWidth - summaryRight.length))}${summaryRight}`
	const footerNotice = notice ? fitCell(notice, headerFooterWidth) : null
	const selectPullRequestByUrl = (url: string) => {
		const index = visiblePullRequests.findIndex((pullRequest) => pullRequest.url === url)
		if (index >= 0) {
			setSelectedIndex(index)
			setQueueSelection((current) => ({ ...current, [queueMode]: index }))
		}
	}
	const updatePullRequest = (url: string, transform: (pullRequest: PullRequestItem) => PullRequestItem) => {
		const pullRequest = pullRequests.find((item) => item.url === url)
		if (!pullRequest) return
		setPullRequestOverrides((current) => ({ ...current, [url]: transform(pullRequest) }))
	}
	const refreshPullRequests = (message?: string) => {
		refreshGenerationRef.current += 1
		setPullRequestOverrides({})
		if (message) {
			setNotice(null)
			setRefreshCompletionMessage(message)
			setRefreshStartedAt(lastPullRequestRefreshAtRef.current)
		}
		refreshPullRequestsAtom()
	}
	refreshPullRequestsRef.current = refreshPullRequests
	const switchQueueMode = (delta: 1 | -1) => {
		const mode = nextQueueMode(queueMode, delta)
		if (mode === queueMode) return
		refreshGenerationRef.current += 1
		setQueueSelection((current) => ({ ...current, [queueMode]: selectedIndex }))
		setQueueMode(mode)
		setSelectedIndex(queueSelection[mode] ?? 0)
		setRecentlyCompletedPullRequests({})
		detailHydrationRef.current = null
		setDetailFullView(false)
		setDiffFullView(false)
		setDiffCommentMode(false)
		setFilterDraft(filterQuery)
		setNotice(null)
		setRefreshCompletionMessage(null)
		setRefreshStartedAt(null)
	}
	maybeRefreshPullRequestsRef.current = (minimumAgeMs) => {
		if (!terminalFocusedRef.current || pullRequestStatusRef.current === "loading") return
		const lastRefreshAt = lastPullRequestRefreshAtRef.current
		if (lastRefreshAt > 0 && Date.now() - lastRefreshAt < minimumAgeMs) return
		refreshPullRequestsRef.current()
	}

	useEffect(() => {
		const fetchedAt = pullRequestLoad?.fetchedAt?.getTime()
		if (fetchedAt !== undefined) {
			lastPullRequestRefreshAtRef.current = fetchedAt
		}
	}, [pullRequestLoad?.fetchedAt])

	useEffect(() => {
		if (!didMountQueueModeRef.current) {
			didMountQueueModeRef.current = true
			return
		}
		if (queueLoadCache[queueMode]) return
		refreshPullRequestsAtom()
	}, [queueMode, queueLoadCache, refreshPullRequestsAtom])

	useEffect(() => {
		if (!refreshCompletionMessage || refreshStartedAt === null) return
		const fetchedAt = pullRequestLoad?.fetchedAt?.getTime()
		const isHydratingDetails = pullRequestStatus === "ready" && pullRequests.some((pullRequest) => pullRequest.state === "open" && !pullRequest.detailLoaded)
		if (pullRequestStatus === "ready" && fetchedAt !== undefined && fetchedAt !== refreshStartedAt && !isHydratingDetails) {
			flashNotice(`✓ ${refreshCompletionMessage}`)
			setRefreshCompletionMessage(null)
			setRefreshStartedAt(null)
		} else if (pullRequestStatus === "error") {
			flashNotice("Refresh failed")
			setRefreshCompletionMessage(null)
			setRefreshStartedAt(null)
		}
	}, [refreshCompletionMessage, refreshStartedAt, pullRequestStatus, pullRequestLoad?.fetchedAt, pullRequests])

	useEffect(() => {
		const handleFocus = () => {
			terminalFocusedRef.current = true
			setTerminalFocused(true)
			if (terminalWasBlurredRef.current) {
				maybeRefreshPullRequestsRef.current(FOCUS_RETURN_REFRESH_MIN_MS)
			}
		}
		const handleBlur = () => {
			terminalWasBlurredRef.current = true
			terminalFocusedRef.current = false
			setTerminalFocused(false)
		}

		renderer.on("focus", handleFocus)
		renderer.on("blur", handleBlur)
		return () => {
			renderer.off("focus", handleFocus)
			renderer.off("blur", handleBlur)
		}
	}, [renderer])

	useEffect(() => {
		if (!terminalFocused) return
		const lastRefreshAt = lastPullRequestRefreshAtRef.current || Date.now()
		const ageMs = Date.now() - lastRefreshAt
		const delayMs = Math.max(0, FOCUSED_IDLE_REFRESH_MS - ageMs) + Math.floor(Math.random() * AUTO_REFRESH_JITTER_MS)
		const timeout = globalThis.setTimeout(() => {
			maybeRefreshPullRequestsRef.current(FOCUSED_IDLE_REFRESH_MS)
		}, delayMs)
		return () => globalThis.clearTimeout(timeout)
	}, [terminalFocused, pullRequestLoad?.fetchedAt])

	useEffect(() => {
		setSelectedIndex((current) => {
			if (visiblePullRequests.length === 0) return 0
			return Math.max(0, Math.min(current, visiblePullRequests.length - 1))
		})
	}, [visiblePullRequests.length])

	useEffect(() => {
		setQueueSelection((current) => current[queueMode] === selectedIndex ? current : { ...current, [queueMode]: selectedIndex })
	}, [queueMode, selectedIndex])

	useEffect(() => {
		setDiffFileIndex(0)
		setDiffCommentAnchorIndex(0)
	}, [selectedIndex])

	useEffect(() => {
		setDiffCommentAnchorIndex((current) => {
			if (diffCommentAnchors.length === 0) return 0
			return Math.max(0, Math.min(current, diffCommentAnchors.length - 1))
		})
	}, [diffCommentAnchors.length])

	useEffect(() => {
		if (!diffCommentMode || !selectedDiffCommentAnchor) return
		setDiffFileIndex((current) => current === selectedDiffCommentAnchor.fileIndex ? current : selectedDiffCommentAnchor.fileIndex)
	}, [diffCommentMode, selectedDiffCommentAnchor?.fileIndex])

	useEffect(() => {
		const previous = diffCommentLineColorsRef.current
		if (previous.contextKey === diffLineColorContextKey) {
			for (const entry of previous.entries) {
				const diff = diffRenderableRefs.current.get(entry.anchor.fileIndex)
				if (diff) setDiffCommentLineColor(diff, entry, originalDiffLineColor(entry.anchor))
			}
		}

		const nextEntries: AppliedDiffLineColor[] = []
		const appliedKeys = new Set<string>()
		const applyLineColor = (anchor: StackedDiffCommentAnchor, gutter: string, override = false) => {
			const key = `${effectiveDiffRenderView}:${anchor.side}:${anchor.renderLine}`
			if (appliedKeys.has(key) && !override) return
			appliedKeys.add(key)
			const entry = { anchor, view: effectiveDiffRenderView } satisfies AppliedDiffLineColor
			const diff = diffRenderableRefs.current.get(anchor.fileIndex)
			if (diff) setDiffCommentLineColor(diff, entry, { ...originalDiffLineColor(anchor), gutter })
			if (!nextEntries.some((existing) => existing.view === entry.view && existing.anchor.side === anchor.side && existing.anchor.renderLine === anchor.renderLine)) {
				nextEntries.push(entry)
			}
		}

		if (selectedDiffKey) {
			for (const anchor of diffCommentAnchors) {
				if ((diffCommentThreads[`${selectedDiffKey}:${diffCommentAnchorKey(anchor)}`]?.length ?? 0) > 0) {
					applyLineColor(anchor, colors.status.pending)
				}
			}
		}
		if (diffCommentMode && selectedDiffCommentAnchor) {
			applyLineColor(selectedDiffCommentAnchor, selectedDiffCommentAnchor.side === "RIGHT" ? colors.status.passing : colors.status.failing, true)
			if (suppressNextDiffCommentScrollRef.current) {
				suppressNextDiffCommentScrollRef.current = false
			} else {
				ensureDiffLineVisible(selectedDiffCommentAnchor.renderLine)
			}
		} else {
			suppressNextDiffCommentScrollRef.current = false
		}
		diffCommentLineColorsRef.current = { contextKey: diffLineColorContextKey, entries: nextEntries }
	}, [diffCommentMode, selectedDiffCommentAnchor?.renderLine, selectedDiffCommentAnchor?.localRenderLine, selectedDiffCommentAnchor?.side, selectedDiffCommentAnchor?.fileIndex, diffLineColorContextKey, effectiveDiffRenderView, diffCommentAnchors, diffCommentThreads])
	const isHydratingPullRequestDetails = pullRequestStatus === "ready" && pullRequests.some((pullRequest) => pullRequest.state === "open" && !pullRequest.detailLoaded)
	const isRefreshingPullRequests = pullRequestResult.waiting && pullRequestLoad !== null
	const hasActiveLoadingIndicator = pullRequestResult.waiting || isHydratingPullRequestDetails || labelModal.loading || closeModal.running || mergeModal.loading || mergeModal.running || selectedDiffState?.status === "loading"
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
		if (detailHydrationRef.current === fetchedAt || pullRequestLoad?.detailsFetchedAt?.getTime() === fetchedAt) return
		if (!pullRequests.some((pullRequest) => pullRequest.state === "open" && !pullRequest.detailLoaded)) return
		detailHydrationRef.current = fetchedAt
		const generation = refreshGenerationRef.current
		void loadPullRequestDetails(queueMode).then((details) => {
			if (generation !== refreshGenerationRef.current) return
			setQueueLoadCache((current) => {
				const load = current[queueMode]
				if (!load) return current
				const detailsByUrl = new Map(details.map((detail) => [detail.url, detail]))
				return {
					...current,
					[queueMode]: {
						...load,
						data: load.data.map((pullRequest) => detailsByUrl.get(pullRequest.url) ?? pullRequest),
						detailsFetchedAt: load.fetchedAt,
					},
				}
			})
		}).catch((error) => {
			flashNotice(errorMessage(error))
		})
	}, [queueMode, pullRequestStatus, pullRequestLoad?.fetchedAt, pullRequests.length])

	const detailPlaceholderContent = getDetailPlaceholderContent({
		status: pullRequestStatus,
		retryProgress,
		loadingIndicator,
		visibleCount: visiblePullRequests.length,
		filterText: visibleFilterText,
	})
	const detailJunctions = getDetailJunctionRows(selectedPullRequest, rightPaneWidth, true)

	const halfPage = Math.max(1, Math.floor(wideBodyHeight / 2))

	const loadPullRequestComments = (pullRequest: PullRequestItem, force = false) => {
		const key = pullRequestDiffKey(pullRequest)
		const previousLoadState = diffCommentsLoaded[key]
		if (!force && previousLoadState) return
		setDiffCommentsLoaded((current) => ({ ...current, [key]: "loading" }))
		void listPullRequestComments({ repository: pullRequest.repository, number: pullRequest.number })
			.then((comments) => {
				setDiffCommentsLoaded((current) => ({ ...current, [key]: "ready" }))
				setDiffCommentThreads((current) => {
					const prefix = `${key}:`
					const threads = groupDiffCommentThreads(pullRequest, comments)
					const next: Record<string, readonly PullRequestReviewComment[]> = Object.fromEntries(
						Object.entries(current).filter(([threadKey]) => !threadKey.startsWith(prefix)),
					)

					for (const [threadKey, threadComments] of Object.entries(current)) {
						if (!threadKey.startsWith(prefix)) continue
						const localComments = threadComments.filter(isLocalDiffComment)
						if (localComments.length > 0) {
							next[threadKey] = [...(threads[threadKey] ?? []), ...localComments]
						}
					}

					for (const [threadKey, threadComments] of Object.entries(threads)) {
						if (!next[threadKey]) next[threadKey] = threadComments
					}

					return next
				})
			})
			.catch((error) => {
				setDiffCommentsLoaded((current) => {
					if (previousLoadState === "ready") return { ...current, [key]: previousLoadState }
					const next = { ...current }
					delete next[key]
					return next
				})
				flashNotice(errorMessage(error))
			})
	}

	const loadPullRequestDiff = (pullRequest: PullRequestItem, options: { readonly force?: boolean; readonly includeComments?: boolean } = {}) => {
		const force = options.force ?? false
		const includeComments = options.includeComments ?? false
		const key = pullRequestDiffKey(pullRequest)
		const existing = pullRequestDiffCache[key]
		if (includeComments) loadPullRequestComments(pullRequest, force)
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
		diffRenderableRefs.current.clear()
		diffCommentLineColorsRef.current = { contextKey: null, entries: [] }
		setDiffFullView(true)
		setDetailFullView(false)
		setDiffCommentMode(false)
		setDiffFileIndex(0)
		setDiffRenderView(contentWidth >= 100 ? "split" : "unified")
		diffScrollRef.current?.scrollTo({ x: 0, y: 0 })
		loadPullRequestDiff(selectedPullRequest, { includeComments: true })
	}

	const setDiffRenderableRef = (index: number, diff: DiffRenderable | null) => {
		if (diff) diffRenderableRefs.current.set(index, diff)
		else diffRenderableRefs.current.delete(index)
	}

	const scrollToDiffFile = (index: number) => {
		const stackedFile = stackedDiffFiles[index]
		diffScrollRef.current?.scrollTo({ x: 0, y: stackedFile?.headerLine ?? 0 })
	}

	const syncDiffFileIndexToScroll = () => {
		const scrollTop = diffScrollRef.current?.scrollTop
		if (scrollTop === undefined || stackedDiffFiles.length === 0) return
		const nextIndex = stackedDiffFiles.reduce((current, file) => file.headerLine <= scrollTop + 1 ? file.index : current, 0)
		setDiffFileIndex((current) => current === nextIndex ? current : nextIndex)
	}

	const scrollDiffBy = (y: number) => {
		diffScrollRef.current?.scrollBy({ x: 0, y })
		syncDiffFileIndexToScroll()
	}

	const scrollDiffTo = (y: number) => {
		diffScrollRef.current?.scrollTo({ x: 0, y })
		if (y <= 0) setDiffFileIndex(0)
		else if (y === Number.MAX_SAFE_INTEGER) setDiffFileIndex(Math.max(0, readyDiffFiles.length - 1))
		else syncDiffFileIndexToScroll()
	}

	const clearPendingGTimeout = () => {
		if (pendingGTimeoutRef.current !== null) {
			clearTimeout(pendingGTimeoutRef.current)
			pendingGTimeoutRef.current = null
		}
	}

	const handleVimGoto = (key: { readonly name: string; readonly shift?: boolean }, gotoStart: () => void, gotoEnd: () => void): boolean => {
		if (isShiftG(key)) {
			gotoEnd()
			setPendingG(false)
			clearPendingGTimeout()
			return true
		}
		if (key.name === "g") {
			if (pendingG) {
				gotoStart()
				setPendingG(false)
				clearPendingGTimeout()
			} else {
				setPendingG(true)
				pendingGTimeoutRef.current = setTimeout(() => {
					setPendingG(false)
					pendingGTimeoutRef.current = null
				}, 500)
			}
			return true
		}
		return false
	}

	const ensureDiffLineVisible = (line: number) => {
		const scroll = diffScrollRef.current
		if (!scroll) return
		const viewportHeight = Math.max(1, wideBodyHeight - (selectedDiffCommentThread.length > 0 ? 6 : 3))
		const nextTop = scrollTopForVisibleLine(scroll.scrollTop, viewportHeight, line)
		if (nextTop !== scroll.scrollTop) scroll.scrollTo({ x: 0, y: nextTop })
	}

	const jumpDiffFile = (delta: 1 | -1) => {
		if (readyDiffFiles.length === 0) return
		const nextIndex = safeDiffFileIndex(readyDiffFiles, diffFileIndex + delta)
		setDiffFileIndex(nextIndex)
		if (diffCommentMode) {
			const nextAnchor = diffCommentAnchors.find((anchor) => anchor.fileIndex === nextIndex && anchor.side === selectedDiffCommentAnchor?.side)
				?? diffCommentAnchors.find((anchor) => anchor.fileIndex === nextIndex)
			if (nextAnchor) setDiffCommentAnchorIndex(diffCommentAnchors.indexOf(nextAnchor))
		}
		scrollToDiffFile(nextIndex)
	}

	const enterDiffCommentMode = () => {
		const scrollTop = diffScrollRef.current?.scrollTop ?? 0
		suppressNextDiffCommentScrollRef.current = true
		setDiffCommentAnchorIndex(nearestDiffCommentAnchorIndex(diffCommentAnchors, scrollTop))
		setDiffCommentMode(true)
	}

	const moveDiffCommentAnchor = (delta: number) => {
		if (diffCommentAnchors.length === 0) return
		const currentAnchor = selectedDiffCommentAnchor ?? diffCommentAnchors[0]
		const currentRowIndex = Math.max(0, currentAnchor ? diffCommentRows.indexOf(currentAnchor.renderLine) : 0)
		const nextRow = diffCommentRows[Math.max(0, Math.min(diffCommentRows.length - 1, currentRowIndex + delta))]
		if (nextRow === undefined) return
		const nextAnchor = diffCommentAnchors.find((anchor) => anchor.renderLine === nextRow && anchor.side === currentAnchor?.side)
			?? diffCommentAnchors.find((anchor) => anchor.renderLine === nextRow)
		if (!nextAnchor) return
		setDiffCommentAnchorIndex(diffCommentAnchors.indexOf(nextAnchor))
	}

	const selectDiffCommentSide = (side: DiffCommentSide) => {
		if (!selectedDiffCommentAnchor) return
		const nextAnchor = diffCommentAnchors.find((anchor) => anchor.renderLine === selectedDiffCommentAnchor.renderLine && anchor.side === side)
		if (!nextAnchor) return
		setDiffCommentAnchorIndex(diffCommentAnchors.indexOf(nextAnchor))
	}

	const editComment = (transform: (state: CommentEditorValue) => CommentEditorValue) => {
		setCommentModal((current) => {
			const next = transform({ body: current.body, cursor: current.cursor })
			if (next.body === current.body && next.cursor === current.cursor && current.error === null) return current
			return { ...current, body: next.body, cursor: next.cursor, error: null }
		})
	}

	const openDiffCommentModal = () => {
		if (!selectedDiffCommentAnchor || !selectedPullRequest) return
		setCommentModal(initialCommentModalState)
	}

	const openDiffCommentThreadModal = () => {
		if (!selectedDiffCommentAnchor || selectedDiffCommentThread.length === 0) return
		setCommentThreadModal({ scrollOffset: 0 })
	}

	const submitDiffComment = () => {
		if (!selectedPullRequest || !selectedDiffCommentAnchor) return
		const body = commentModal.body.trim()
		if (body.length === 0) {
			setCommentModal((current) => ({ ...current, error: "Write a comment before saving." }))
			return
		}

		const threadKey = selectedDiffCommentThreadKey
		const target = selectedDiffCommentAnchor
		const optimisticComment = {
			id: `local:${Date.now()}`,
			path: target.path,
			line: target.line,
			side: target.side,
			author: username ?? "you",
			body,
			createdAt: new Date(),
			url: null,
		} satisfies PullRequestReviewComment
		const input = {
			repository: selectedPullRequest.repository,
			number: selectedPullRequest.number,
			commitId: selectedPullRequest.headRefOid,
			path: target.path,
			line: target.line,
			side: target.side,
			body,
		} satisfies CreatePullRequestCommentInput

		if (threadKey) {
			setDiffCommentThreads((current) => ({
				...current,
				[threadKey]: [...(current[threadKey] ?? []), optimisticComment],
			}))
		}
		closeActiveModal()
		flashNotice(`Commenting on ${target.path}:${target.line}`)
		void createPullRequestComment(input).then((comment) => {
			if (threadKey) {
				setDiffCommentThreads((current) => ({
					...current,
					[threadKey]: (current[threadKey] ?? []).map((existing) => existing.id === optimisticComment.id ? comment : existing),
				}))
			}
			flashNotice(`Commented on ${target.path}:${target.line}`)
		}).catch((error) => {
			if (threadKey) {
				setDiffCommentThreads((current) => {
					const next = { ...current }
					const comments = (next[threadKey] ?? []).filter((comment) => comment.id !== optimisticComment.id)
					if (comments.length > 0) next[threadKey] = comments
					else delete next[threadKey]
					return next
				})
			}
			flashNotice(errorMessage(error))
		})
	}

	const openSelectedPullRequestInBrowser = (pullRequest: PullRequestItem) => {
		void openPullRequestInBrowser(pullRequest)
			.then(() => flashNotice(`Opened #${pullRequest.number} in browser`))
			.catch((error) => flashNotice(errorMessage(error)))
	}

	const copySelectedPullRequestMetadata = () => {
		if (!selectedPullRequest) return
		void copyPullRequestMetadata(selectedPullRequest)
			.then(() => flashNotice(`Copied #${selectedPullRequest.number} metadata`))
			.catch((error) => flashNotice(errorMessage(error)))
	}

	const toggleSelectedPullRequestDraftStatus = () => {
		if (!selectedPullRequest) return
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
				flashNotice(errorMessage(error))
			})
	}

	const openCloseModal = () => {
		if (!selectedPullRequest || selectedPullRequest.state !== "open") return
		setCloseModal({
			repository: selectedPullRequest.repository,
			number: selectedPullRequest.number,
			title: selectedPullRequest.title,
			url: selectedPullRequest.url,
			running: false,
			error: null,
		})
	}

	const confirmClosePullRequest = () => {
		if (!closeModal.repository || closeModal.number === null || !closeModal.url || closeModal.running) return
		const { repository, number, url } = closeModal
		const targetPullRequest = pullRequests.find((pullRequest) => pullRequest.url === url)
		const previousPullRequest = targetPullRequest ?? null

		setCloseModal((current) => ({ ...current, running: true, error: null }))
		void closePullRequest({ repository, number })
			.then(() => {
				if (previousPullRequest) {
					setRecentlyCompletedPullRequests((current) => ({
						...current,
						[previousPullRequest.url]: {
							...previousPullRequest,
							state: "closed",
							autoMergeEnabled: false,
						},
					}))
				}
				closeActiveModal()
				refreshPullRequests(`Closed #${number}`)
			})
			.catch((error) => {
				setCloseModal((current) => ({ ...current, running: false, error: errorMessage(error) }))
				flashNotice(errorMessage(error))
			})
	}

	const openThemeModal = () => {
		setThemeModal({
			query: "",
			filterMode: false,
			initialThemeId: themeId,
		})
	}

	const closeThemeModal = (confirm: boolean) => {
		const selectedTheme = themeDefinitions.find((theme) => theme.id === themeIdRef.current)
		if (!confirm) {
			setThemeId(themeModal.initialThemeId)
		} else if (selectedTheme) {
			void Effect.runPromise(saveStoredThemeId(selectedTheme.id)).catch((error) => flashNotice(errorMessage(error)))
			flashNotice(`Theme: ${selectedTheme.name}`)
		}
		closeActiveModal()
	}

	const previewTheme = (id: ThemeId) => {
		if (id === themeIdRef.current) return
		themeIdRef.current = id
		setThemeId(id)
	}

	const moveThemeSelection = (delta: number) => {
		const filteredThemes = filterThemeDefinitions(themeModalRef.current.query)
		if (filteredThemes.length === 0) return
		const currentIndex = Math.max(0, filteredThemes.findIndex((theme) => theme.id === themeIdRef.current))
		const selectedIndex = Math.max(0, Math.min(filteredThemes.length - 1, currentIndex + delta))
		if (selectedIndex === currentIndex) return
		const theme = filteredThemes[selectedIndex]
		if (theme) previewTheme(theme.id)
	}

	const updateThemeQuery = (query: string, options: { readonly previewFirst?: boolean; readonly filterMode?: boolean } = {}) => {
		const current = themeModalRef.current
		const next = {
			...current,
			query,
			filterMode: options.filterMode ?? current.filterMode,
		}
		if (next.query === current.query && next.filterMode === current.filterMode) return

		themeModalRef.current = next
		setThemeModal(next)

		if (options.previewFirst && query.trim().length > 0) {
			const firstTheme = filterThemeDefinitions(query)[0]
			if (firstTheme) previewTheme(firstTheme.id)
		}
	}

	const editThemeQuery = (transform: (query: string) => string) => {
		updateThemeQuery(transform(themeModalRef.current.query), { previewFirst: true })
	}

	const openLabelModal = () => {
		if (!selectedPullRequest) return
		const repository = selectedPullRequest.repository
		const cachedLabels = labelCache[repository]
		if (cachedLabels) {
			setLabelModal({
				repository,
				query: "",
				selectedIndex: 0,
				availableLabels: cachedLabels,
				loading: false,
			})
			return
		}

		setLabelModal({ repository, query: "", selectedIndex: 0, availableLabels: [], loading: true })
		void loadRepoLabels(repository)
			.then((labels) => {
				setLabelCache((current) => ({ ...current, [repository]: labels }))
				setLabelModal((current) => current.repository === repository ? { ...current, availableLabels: labels, loading: false } : current)
			})
			.catch((error) => {
				setLabelModal((current) => current.repository === repository ? { ...current, loading: false } : current)
				flashNotice(errorMessage(error))
			})
	}

	const openMergeModal = () => {
		if (!selectedPullRequest) return
		const repository = selectedPullRequest.repository
		const number = selectedPullRequest.number
		const seededInfo = mergeInfoFromPullRequest(selectedPullRequest)
		setMergeModal({
			repository,
			number,
			selectedIndex: 0,
			loading: true,
			running: false,
			info: seededInfo,
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
		const options = availableMergeActions(mergeModal.info)
		const option = options[mergeModal.selectedIndex]
		if (!option) return

		const { repository, number } = mergeModal.info
		const targetPullRequest = pullRequests.find((pullRequest) => pullRequest.repository === repository && pullRequest.number === number)
		const previousPullRequest = targetPullRequest ?? null
		const previousMergeInfo = mergeModal.info

		if (targetPullRequest && option.optimisticAutoMergeEnabled !== undefined) {
			updatePullRequest(targetPullRequest.url, (pullRequest) => ({ ...pullRequest, autoMergeEnabled: option.optimisticAutoMergeEnabled! }))
			setMergeModal((current) => ({
				...current,
				info: current.info ? { ...current.info, autoMergeEnabled: option.optimisticAutoMergeEnabled! } : current.info,
			}))
		}

		setMergeModal((current) => ({ ...current, running: true, error: null }))
		void mergePullRequest({ repository, number, action: option.action })
			.then(() => {
				if (option.refreshOnSuccess && previousPullRequest) {
					setRecentlyCompletedPullRequests((current) => ({
						...current,
						[previousPullRequest.url]: {
							...previousPullRequest,
							state: "merged",
							autoMergeEnabled: false,
						},
					}))
				}
				closeActiveModal()
				if (option.refreshOnSuccess) {
					refreshPullRequests(`${option.pastTense} #${number}`)
				} else {
					flashNotice(`${option.pastTense} #${number}`)
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
					flashNotice(errorMessage(error))
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
					flashNotice(errorMessage(error))
				})
		}
	}

	useKeyboard((key) => {
		if ((key.name === "q" && !commentModalActive && !(themeModalActive && themeModal.filterMode)) || (key.ctrl && key.name === "c")) {
			if (themeModalActive) {
				closeThemeModal(false)
				return
			}
			if (activeModal._tag !== "None") {
				closeActiveModal()
				return
			}
			renderer.destroy()
			return
		}

		if (themeModalActive) {
			if (key.name === "escape") {
				if (themeModal.filterMode) {
					updateThemeQuery("", { filterMode: false })
					return
				}
				closeThemeModal(false)
				return
			}
			if (key.name === "/") {
				updateThemeQuery("", { filterMode: true })
				return
			}
			if (key.name === "return" || key.name === "enter") {
				if (themeModal.filterMode && filterThemeDefinitions(themeModal.query).length === 0) return
				closeThemeModal(true)
				return
			}
			if (key.name === "up" || (!themeModal.filterMode && key.name === "k")) {
				moveThemeSelection(-1)
				return
			}
			if (key.name === "down" || (!themeModal.filterMode && key.name === "j")) {
				moveThemeSelection(1)
				return
			}
			if (themeModal.filterMode && key.name === "backspace") {
				editThemeQuery((query) => query.slice(0, -1))
				return
			}
			if (themeModal.filterMode && key.ctrl && key.name === "u") {
				updateThemeQuery("")
				return
			}
			if (themeModal.filterMode && !key.ctrl && !key.meta && key.sequence.length === 1 && key.name !== "return") {
				editThemeQuery((query) => query + key.sequence)
				return
			}
			return
		}

		if (commentModalActive) {
			if (key.name === "escape") {
				closeActiveModal()
				return
			}
			if (key.ctrl && key.name === "s") {
				submitDiffComment()
				return
			}
			if (key.ctrl && key.name === "a") {
				editComment(moveLineStart)
				return
			}
			if (key.ctrl && key.name === "e") {
				editComment(moveLineEnd)
				return
			}
			if (key.ctrl && key.name === "b") {
				editComment(editorMoveLeft)
				return
			}
			if (key.ctrl && key.name === "f") {
				editComment(editorMoveRight)
				return
			}
			if (key.ctrl && key.name === "w") {
				editComment(deleteWordBackward)
				return
			}
			if (key.ctrl && key.name === "u") {
				editComment(deleteToLineStart)
				return
			}
			if (key.ctrl && key.name === "k") {
				editComment(deleteToLineEnd)
				return
			}
			if (key.ctrl && key.name === "d") {
				editComment(editorDeleteForward)
				return
			}
			if ((key.meta || key.option) && (key.name === "b" || key.name === "left")) {
				editComment(moveWordBackward)
				return
			}
			if ((key.meta || key.option) && (key.name === "f" || key.name === "right")) {
				editComment(moveWordForward)
				return
			}
			if ((key.meta || key.option) && (key.name === "backspace" || key.name === "delete")) {
				editComment(key.name === "delete" ? deleteWordForward : deleteWordBackward)
				return
			}
			if (key.name === "backspace") {
				editComment(editorBackspace)
				return
			}
			if (key.name === "delete") {
				editComment(editorDeleteForward)
				return
			}
			if (key.name === "left") {
				editComment(editorMoveLeft)
				return
			}
			if (key.name === "right") {
				editComment(editorMoveRight)
				return
			}
			if (key.name === "up") {
				editComment((state) => moveVertically(state, -1))
				return
			}
			if (key.name === "down") {
				editComment((state) => moveVertically(state, 1))
				return
			}
			if (key.name === "home") {
				editComment(moveLineStart)
				return
			}
			if (key.name === "end") {
				editComment(moveLineEnd)
				return
			}
			if ((key.name === "return" || key.name === "enter") && key.shift) {
				editComment((state) => insertText(state, "\n"))
				return
			}
			if (key.name === "return" || key.name === "enter") {
				submitDiffComment()
				return
			}
			if (!key.ctrl && !key.meta && key.sequence.length === 1) {
				editComment((state) => insertText(state, key.sequence))
				return
			}
			return
		}

		if (commentThreadModalActive) {
			if (key.name === "escape") {
				closeActiveModal()
				return
			}
			if (key.name === "return" || key.name === "enter" || key.name === "a" || key.name === "c") {
				openDiffCommentModal()
				return
			}
			if (key.name === "up" || key.name === "k") {
				setCommentThreadModal((current) => ({ ...current, scrollOffset: Math.max(0, current.scrollOffset - 1) }))
				return
			}
			if (key.name === "down" || key.name === "j") {
				setCommentThreadModal((current) => ({ ...current, scrollOffset: current.scrollOffset + 1 }))
				return
			}
			if (key.name === "pageup" || key.ctrl && key.name === "u") {
				setCommentThreadModal((current) => ({ ...current, scrollOffset: Math.max(0, current.scrollOffset - halfPage) }))
				return
			}
			if (key.name === "pagedown" || key.ctrl && (key.name === "d" || key.name === "v")) {
				setCommentThreadModal((current) => ({ ...current, scrollOffset: current.scrollOffset + halfPage }))
				return
			}
			return
		}

		if (closeModalActive) {
			if (key.name === "escape") {
				closeActiveModal()
				return
			}
			if (key.name === "return" || key.name === "enter") {
				confirmClosePullRequest()
				return
			}
			return
		}

		if (mergeModalActive) {
			const options = availableMergeActions(mergeModal.info)
			if (key.name === "escape") {
				closeActiveModal()
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
		if (labelModalActive) {
			if (key.name === "escape") {
				closeActiveModal()
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
			if (diffCommentMode) {
				if (key.name === "escape") {
					setDiffCommentMode(false)
					return
				}
				if (key.name === "c") {
					setDiffCommentMode(false)
					return
				}
				if (key.name === "return" || key.name === "enter") {
					if (selectedDiffCommentThread.length > 0) openDiffCommentThreadModal()
					else openDiffCommentModal()
					return
				}
				if (key.name === "a") {
					openDiffCommentModal()
					return
				}
				if (key.name === "pageup" || key.ctrl && key.name === "u") {
					moveDiffCommentAnchor(-halfPage)
					return
				}
				if (key.name === "pagedown" || key.ctrl && (key.name === "d" || key.name === "v")) {
					moveDiffCommentAnchor(halfPage)
					return
				}
				if ((key.shift || key.option || key.meta) && (key.name === "up" || key.name === "k") || key.name === "K") {
					moveDiffCommentAnchor(-8)
					return
				}
				if ((key.shift || key.option || key.meta) && (key.name === "down" || key.name === "j") || key.name === "J") {
					moveDiffCommentAnchor(8)
					return
				}
				if (key.name === "up" || key.name === "k") {
					moveDiffCommentAnchor(-1)
					return
				}
				if (key.name === "down" || key.name === "j") {
					moveDiffCommentAnchor(1)
					return
				}
				if (key.name === "left" || key.name === "h") {
					selectDiffCommentSide("LEFT")
					return
				}
				if (key.name === "right" || key.name === "l") {
					selectDiffCommentSide("RIGHT")
					return
				}
				if (key.name === "]" && selectedDiffState?.status === "ready") {
					jumpDiffFile(1)
					return
				}
				if (key.name === "[" && selectedDiffState?.status === "ready") {
					jumpDiffFile(-1)
					return
				}
				return
			}

			if (key.name === "escape" || key.name === "return" || key.name === "enter") {
				setDiffFullView(false)
				setDiffCommentMode(false)
				return
			}
			if (key.name === "c" && selectedDiffState?.status === "ready") {
				enterDiffCommentMode()
				return
			}
			if (key.name === "home") {
				scrollDiffTo(0)
				return
			}
			if (key.name === "end") {
				scrollDiffTo(Number.MAX_SAFE_INTEGER)
				return
			}
			if (key.name === "pageup") {
				scrollDiffBy(-halfPage)
				return
			}
			if (key.name === "pagedown") {
				scrollDiffBy(halfPage)
				return
			}
			if (handleVimGoto(key, () => scrollDiffTo(0), () => scrollDiffTo(Number.MAX_SAFE_INTEGER))) return
			if (key.name === "up" || key.name === "k") {
				scrollDiffBy(-1)
				return
			}
			if (key.name === "down" || key.name === "j") {
				scrollDiffBy(1)
				return
			}
			if (key.ctrl && key.name === "u") {
				scrollDiffBy(-halfPage)
				return
			}
			if (key.ctrl && (key.name === "d" || key.name === "v")) {
				scrollDiffBy(halfPage)
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
				loadPullRequestDiff(selectedPullRequest, { force: true, includeComments: true })
				flashNotice(`Refreshing diff for #${selectedPullRequest.number}`)
				return
			}
			if ((key.name === "]" || key.name === "right" || key.name === "l") && selectedDiffState?.status === "ready") {
				jumpDiffFile(1)
				return
			}
			if ((key.name === "[" || key.name === "left" || key.name === "h") && selectedDiffState?.status === "ready") {
				jumpDiffFile(-1)
				return
			}
			if (key.name === "o" && selectedPullRequest) {
				openSelectedPullRequestInBrowser(selectedPullRequest)
				return
			}
			return
		}

		// Fullscreen detail mode handles its own navigation keys.
		if (detailFullView) {
			const plainKey = !key.ctrl && !key.meta && !key.option
			if (key.name === "escape" || (key.name === "return" || key.name === "enter")) {
				setDetailFullView(false)
				setDetailScrollOffset(0)
				return
			}
			if (isThemeKey(key)) {
				openThemeModal()
				return
			}
			if (plainKey && key.name === "d" && selectedPullRequest) {
				openDiffView()
				return
			}
			if (plainKey && key.name === "x" && selectedPullRequest?.state === "open") {
				openCloseModal()
				return
			}
			if (plainKey && key.name === "l" && selectedPullRequest) {
				openLabelModal()
				return
			}
			if (plainKey && (key.name === "m" || key.name === "M") && selectedPullRequest) {
				openMergeModal()
				return
			}
			if (plainKey && (key.name === "s" || key.name === "S") && selectedPullRequest) {
				toggleSelectedPullRequestDraftStatus()
				return
			}
			if (plainKey && key.name === "r") {
				refreshPullRequests("Refreshed")
				return
			}
			if (key.name === "home") {
				detailScrollRef.current?.scrollTo({ x: 0, y: 0 })
				setDetailScrollOffset(0)
				return
			}
			if (key.name === "end") {
				detailScrollRef.current?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER })
				setDetailScrollOffset(Number.MAX_SAFE_INTEGER)
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
			if (handleVimGoto(key,
				() => { detailScrollRef.current?.scrollTo({ x: 0, y: 0 }); setDetailScrollOffset(0) },
				() => { detailScrollRef.current?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER }); setDetailScrollOffset(Number.MAX_SAFE_INTEGER) },
			)) return
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
			if (plainKey && key.name === "o" && selectedPullRequest) {
				openSelectedPullRequestInBrowser(selectedPullRequest)
				return
			}
			if (plainKey && key.name === "y" && selectedPullRequest) {
				copySelectedPullRequestMetadata()
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
			if (key.name === "return" || key.name === "enter") {
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

		if (key.name === "tab") {
			switchQueueMode(key.shift ? -1 : 1)
			return
		}

		if (isThemeKey(key)) {
			openThemeModal()
			return
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
			refreshPullRequests("Refreshed")
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
		if (handleVimGoto(key,
			() => setSelectedIndex(0),
			() => setSelectedIndex(visiblePullRequests.length === 0 ? 0 : visiblePullRequests.length - 1),
		)) return
		if ((key.name === "return" || key.name === "enter") && !detailFullView) {
			setDetailFullView(true)
			setDetailScrollOffset(0)
			return
		}
		if (key.name === "d" && selectedPullRequest) {
			openDiffView()
			return
		}
		if (key.name === "x" && selectedPullRequest?.state === "open") {
			openCloseModal()
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
			openSelectedPullRequestInBrowser(selectedPullRequest)
			return
		}
		if ((key.name === "s" || key.name === "S") && selectedPullRequest) {
			toggleSelectedPullRequestDraftStatus()
			return
		}
		if (key.name === "y" && selectedPullRequest) {
			copySelectedPullRequestMetadata()
			return
		}
	})

	const fullscreenContentWidth = Math.max(24, contentWidth - 2)
	const fullscreenBodyLines = Math.max(8, terminalHeight - 8)
	const wideFullscreenDetailScrollable = getDetailsPaneHeight({
		pullRequest: selectedPullRequest,
		contentWidth: fullscreenContentWidth,
		bodyLines: fullscreenBodyLines,
		paneWidth: contentWidth,
		showChecks: true,
	}) > wideBodyHeight
	const narrowFullscreenDetailScrollable = getDetailsPaneHeight({
		pullRequest: selectedPullRequest,
		contentWidth: fullscreenContentWidth,
		bodyLines: fullscreenBodyLines,
		paneWidth: contentWidth,
	}) > wideBodyHeight
	const wideDetailHeaderHeight = getDetailHeaderHeight(selectedPullRequest, rightPaneWidth, true)
	const wideDetailBodyViewportHeight = Math.max(1, wideBodyHeight - wideDetailHeaderHeight)
	const wideDetailBodyScrollable = getDetailBodyHeight(selectedPullRequest, rightContentWidth, wideDetailLines) > wideDetailBodyViewportHeight

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
	const labelModalHeight = Math.min(20, terminalHeight - 4)
	const labelModalLeft = centeredOffset(contentWidth, labelModalWidth)
	const labelModalTop = centeredOffset(terminalHeight, labelModalHeight)
	const closeModalWidth = Math.min(68, Math.max(46, contentWidth - 12))
	const closeModalHeight = Math.min(12, terminalHeight - 4)
	const closeModalLeft = centeredOffset(contentWidth, closeModalWidth)
	const closeModalTop = centeredOffset(terminalHeight, closeModalHeight)
	const commentModalWidth = Math.min(76, Math.max(46, contentWidth - 8))
	const commentModalHeight = Math.min(16, terminalHeight - 4)
	const commentModalLeft = centeredOffset(contentWidth, commentModalWidth)
	const commentModalTop = centeredOffset(terminalHeight, commentModalHeight)
	const commentThreadModalWidth = Math.min(86, Math.max(50, contentWidth - 8))
	const commentThreadModalHeight = Math.min(22, terminalHeight - 4)
	const commentThreadModalLeft = centeredOffset(contentWidth, commentThreadModalWidth)
	const commentThreadModalTop = centeredOffset(terminalHeight, commentThreadModalHeight)
	const commentAnchorLabel = selectedDiffCommentAnchor
		? `${selectedDiffCommentAnchor.path}:${selectedDiffCommentAnchor.line} ${selectedDiffCommentAnchor.side === "RIGHT" ? "right" : "left"}`
		: "No diff line selected"
	const mergeModalWidth = Math.min(68, Math.max(46, contentWidth - 12))
	const mergeModalHeight = Math.min(16, terminalHeight - 4)
	const mergeModalLeft = centeredOffset(contentWidth, mergeModalWidth)
	const mergeModalTop = centeredOffset(terminalHeight, mergeModalHeight)
	const themeModalWidth = Math.min(58, Math.max(38, contentWidth - 12))
	const themeModalHeight = Math.min(16, terminalHeight - 4)
	const themeModalLeft = centeredOffset(contentWidth, themeModalWidth)
	const themeModalTop = centeredOffset(terminalHeight, themeModalHeight)

	return (
		<box width={terminalWidth} height={terminalHeight} flexDirection="column" backgroundColor={colors.background}>
			<box paddingLeft={1} paddingRight={1} flexDirection="column" backgroundColor={colors.background}>
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
					stackedFiles={stackedDiffFiles}
					fileIndex={diffFileIndex}
					view={effectiveDiffRenderView}
					wrapMode={diffWrapMode}
					paneWidth={contentWidth}
					height={wideBodyHeight}
					loadingIndicator={loadingIndicator}
					scrollRef={diffScrollRef}
					setDiffRef={setDiffRenderableRef}
					commentMode={diffCommentMode}
					selectedCommentAnchor={selectedDiffCommentAnchor}
					selectedCommentThread={selectedDiffCommentThread}
					commentCount={selectedDiffCommentCount}
					themeId={themeId}
				/>
			) : isWideLayout && detailFullView ? (
				<box flexGrow={1} flexDirection="column">
					<scrollbox ref={detailScrollRef} focused flexGrow={1} verticalScrollbarOptions={{ visible: wideFullscreenDetailScrollable }}>
						<DetailsPane
							pullRequest={selectedPullRequest}
							viewerUsername={username}
							contentWidth={fullscreenContentWidth}
							bodyLines={fullscreenBodyLines}
							paneWidth={contentWidth}
							showChecks
							placeholderContent={detailPlaceholderContent}
							loadingIndicator={loadingIndicator}
							themeId={themeId}
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
								<DetailHeader pullRequest={selectedPullRequest} viewerUsername={username} contentWidth={rightContentWidth} paneWidth={rightPaneWidth} showChecks />
								<scrollbox flexGrow={1} verticalScrollbarOptions={{ visible: wideDetailBodyScrollable }}>
									<DetailBody pullRequest={selectedPullRequest} contentWidth={rightContentWidth} bodyLines={wideDetailLines} loadingIndicator={loadingIndicator} themeId={themeId} />
								</scrollbox>
							</>
						) : (
							<DetailPlaceholder content={detailPlaceholderContent} paneWidth={rightPaneWidth} />
						)}
					</box>
				</box>
			) : detailFullView ? (
				<box flexGrow={1} flexDirection="column">
					<scrollbox ref={detailScrollRef} focused flexGrow={1} verticalScrollbarOptions={{ visible: narrowFullscreenDetailScrollable }}>
						<DetailsPane
							pullRequest={selectedPullRequest}
							viewerUsername={username}
							contentWidth={fullscreenContentWidth}
							bodyLines={fullscreenBodyLines}
							paneWidth={contentWidth}
							placeholderContent={detailPlaceholderContent}
							loadingIndicator={loadingIndicator}
							themeId={themeId}
						/>
					</scrollbox>
				</box>
			) : (
				<box height={wideBodyHeight} flexDirection="column">
					<DetailsPane pullRequest={selectedPullRequest} viewerUsername={username} contentWidth={rightContentWidth} paneWidth={contentWidth} placeholderContent={detailPlaceholderContent} loadingIndicator={loadingIndicator} themeId={themeId} />
					<Divider width={contentWidth} />
					<box flexGrow={1} flexDirection="column">
						<scrollbox flexGrow={1}>
							<box paddingLeft={sectionPadding} paddingRight={sectionPadding}>
								<PullRequestList {...prListProps} contentWidth={leftContentWidth} />
							</box>
						</scrollbox>
					</box>
				</box>
			)}

			{isWideLayout && !detailFullView && !diffFullView && !isInitialLoading ? (
				<Divider width={contentWidth} junctionAt={dividerJunctionAt} junctionChar="┴" />
			) : (
				<Divider width={contentWidth} />
			)}
			<box paddingLeft={1} paddingRight={1} backgroundColor={colors.background}>
				{footerNotice ? (
					<PlainLine text={footerNotice} fg={colors.count} />
				) : (
					<FooterHints
						filterEditing={filterMode}
						showFilterClear={filterMode || filterQuery.length > 0}
						detailFullView={detailFullView}
						diffFullView={diffFullView}
						diffCommentMode={diffCommentMode}
						hasSelection={selectedPullRequest !== null}
						canCloseSelection={selectedPullRequest?.state === "open"}
						hasError={pullRequestStatus === "error"}
						isLoading={pullRequestStatus === "loading" || isRefreshingPullRequests || isHydratingPullRequestDetails || closeModal.running || mergeModal.running}
						loadingIndicator={loadingIndicator}
						retryProgress={retryProgress}
					/>
				)}
			</box>
			{labelModalActive ? (
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
			{closeModalActive ? (
				<CloseModal
					state={closeModal}
					modalWidth={closeModalWidth}
					modalHeight={closeModalHeight}
					offsetLeft={closeModalLeft}
					offsetTop={closeModalTop}
					loadingIndicator={loadingIndicator}
				/>
			) : null}
			{commentModalActive ? (
				<CommentModal
					state={commentModal}
					anchorLabel={commentAnchorLabel}
					modalWidth={commentModalWidth}
					modalHeight={commentModalHeight}
					offsetLeft={commentModalLeft}
					offsetTop={commentModalTop}
				/>
			) : null}
			{commentThreadModalActive ? (
				<CommentThreadModal
					state={commentThreadModal}
					anchorLabel={commentAnchorLabel}
					comments={selectedDiffCommentThread}
					modalWidth={commentThreadModalWidth}
					modalHeight={commentThreadModalHeight}
					offsetLeft={commentThreadModalLeft}
					offsetTop={commentThreadModalTop}
				/>
			) : null}
			{mergeModalActive ? (
				<MergeModal
					state={mergeModal}
					modalWidth={mergeModalWidth}
					modalHeight={mergeModalHeight}
					offsetLeft={mergeModalLeft}
					offsetTop={mergeModalTop}
					loadingIndicator={loadingIndicator}
				/>
			) : null}
			{themeModalActive ? (
				<ThemeModal
					state={themeModal}
					activeThemeId={themeId}
					modalWidth={themeModalWidth}
					modalHeight={themeModalHeight}
					offsetLeft={themeModalLeft}
					offsetTop={themeModalTop}
				/>
			) : null}
		</box>
	)
}
