import type { DiffRenderable, PasteEvent, ScrollBoxRenderable } from "@opentui/core"
import { RegistryContext, useAtom, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useBindings } from "@opentui/keymap/react"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { Cause, Effect, Layer, Schedule } from "effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import { useContext, useEffect, useMemo, useRef, useState } from "react"
import { buildAppCommands } from "./appCommands.js"
import type { AppCommand } from "./commands.js"
import { clampCommandIndex, commandEnabled, defineCommand, filterCommands, sortCommandsByScope } from "./commands.js"
import { config } from "./config.js"
import { type CreatePullRequestCommentInput, type DiffCommentSide, type ListPullRequestPageInput, type LoadStatus, type PullRequestItem, type PullRequestLabel, type PullRequestMergeAction, type PullRequestReviewComment } from "./domain.js"
import { formatShortDate, formatTimestamp } from "./date.js"
import { errorMessage } from "./errors.js"
import { availableMergeActions, mergeInfoFromPullRequest } from "./mergeActions.js"
import { Observability } from "./observability.js"
import { mergeCachedDetails } from "./pullRequestCache.js"
import { activePullRequestViews, initialPullRequestView, nextView, parseRepositoryInput, type PullRequestView, viewCacheKey, viewEquals, viewLabel, viewMode, viewRepository } from "./pullRequestViews.js"
import { BrowserOpener } from "./services/BrowserOpener.js"
import { Clipboard } from "./services/Clipboard.js"
import { CommandRunner } from "./services/CommandRunner.js"
import { GitHubService } from "./services/GitHubService.js"
import { loadStoredThemeId, saveStoredThemeId } from "./themeStore.js"
import { colors, filterThemeDefinitions, mixHex, setActiveTheme, themeDefinitions, type ThemeId } from "./ui/colors.js"
import { backspace as editorBackspace, deleteForward as editorDeleteForward, deleteToLineEnd, deleteToLineStart, deleteWordBackward, deleteWordForward, insertText, moveLeft as editorMoveLeft, moveLineEnd, moveLineStart, moveRight as editorMoveRight, moveVertically, moveWordBackward, moveWordForward, type CommentEditorValue } from "./ui/commentEditor.js"
import { buildStackedDiffFiles, diffCommentLocationKey, getStackedDiffCommentAnchors, nearestDiffCommentAnchorIndex, PullRequestDiffState, pullRequestDiffKey, safeDiffFileIndex, scrollTopForVisibleLine, splitPatchFiles, stackedDiffFileAtLine, type DiffCommentAnchor, type DiffView, type DiffWrapMode, type StackedDiffCommentAnchor } from "./ui/diff.js"
import { DETAIL_BODY_SCROLL_LIMIT, DetailBody, DetailHeader, DetailPlaceholder, DetailsPane, getDetailHeaderHeight, getDetailJunctionRows, getDetailsPaneHeight, getScrollableDetailBodyHeight, LoadingPane, type DetailPlaceholderContent } from "./ui/DetailsPane.js"
import { FooterHints, initialRetryProgress, RetryProgress } from "./ui/FooterHints.js"
import { Divider, fitCell, PlainLine, SeparatorColumn } from "./ui/primitives.js"
import { CommandPalette } from "./ui/CommandPalette.js"
import { CloseModal, CommentModal, CommentThreadModal, filterLabels, initialCloseModalState, initialCommandPaletteState, initialCommentModalState, initialCommentThreadModalState, initialLabelModalState, initialMergeModalState, initialModal, initialOpenRepositoryModalState, initialThemeModalState, LabelModal, MergeModal, Modal, OpenRepositoryModal, ThemeModal, type CloseModalState, type CommandPaletteState, type CommentModalState, type CommentThreadModalState, type LabelModalState, type MergeModalState, type ModalState, type ModalTag, type OpenRepositoryModalState, type ThemeModalState } from "./ui/modals.js"
import { groupBy, reviewLabel } from "./ui/pullRequests.js"
import { PullRequestDiffPane } from "./ui/PullRequestDiffPane.js"
import { buildPullRequestListRows, pullRequestListRowIndex, PullRequestList } from "./ui/PullRequestList.js"
import { editSingleLineInput, isSingleLineInputKey, printableKeyText, singleLineText } from "./ui/singleLineInput.js"

const parseOptionalPositiveInt = (value: string | undefined, fallback: number | null) => {
	if (value === undefined) return fallback
	const parsed = Number.parseInt(value, 10)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const mockPrCount = parseOptionalPositiveInt(process.env.GHUI_MOCK_PR_COUNT, null)
const pullRequestPageSize = Math.min(100, parseOptionalPositiveInt(process.env.GHUI_PR_PAGE_SIZE, config.prPageSize) ?? config.prPageSize)
const githubServiceLayer = mockPrCount !== null
	? (await import("./services/MockGitHubService.js")).MockGitHubService.layer({ prCount: mockPrCount, repoCount: parseOptionalPositiveInt(process.env.GHUI_MOCK_REPO_COUNT, 4) ?? 4 })
	: GitHubService.layerNoDeps

const githubRuntime = Atom.runtime(
	Layer.mergeAll(githubServiceLayer, Clipboard.layerNoDeps, BrowserOpener.layerNoDeps).pipe(
		Layer.provide(CommandRunner.layer),
		Layer.provideMerge(Observability.layer),
	),
)
const initialThemeId = await Effect.runPromise(loadStoredThemeId)

interface PullRequestLoad {
	readonly view: PullRequestView
	readonly data: readonly PullRequestItem[]
	readonly fetchedAt: Date | null
	readonly endCursor: string | null
	readonly hasNextPage: boolean
}

interface DetailPlaceholderInput {
	readonly status: LoadStatus
	readonly retryProgress: RetryProgress
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
	readonly view: DiffView
}

interface AppliedDiffLineColorState {
	readonly contextKey: string | null
	readonly entries: readonly AppliedDiffLineColor[]
}

interface DetailHydration {
	readonly token: symbol
	notifyError: boolean
}

const PR_FETCH_RETRIES = 6
const FOCUS_RETURN_REFRESH_MIN_MS = 60_000
const FOCUSED_IDLE_REFRESH_MS = 5 * 60_000
const AUTO_REFRESH_JITTER_MS = 10_000
const DIFF_STICKY_HEADER_LINES = 2
const LOADING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const
const MAX_REPOSITORY_CACHE_ENTRIES = 8
const LOAD_MORE_SELECTION_THRESHOLD = 8
const DETAIL_PREFETCH_BEHIND = 1
const DETAIL_PREFETCH_AHEAD = 3
const DETAIL_PREFETCH_CONCURRENCY = 3
const DETAIL_PREFETCH_DELAY_MS = 120

const appendPullRequestPage = (existing: readonly PullRequestItem[], incoming: readonly PullRequestItem[]) => {
	const seen = new Set(existing.map((pullRequest) => pullRequest.url))
	const mergedIncoming = mergeCachedDetails(incoming, existing)
	return [...existing, ...mergedIncoming.filter((pullRequest) => !seen.has(pullRequest.url))]
}

const retryProgressAtom = Atom.make<RetryProgress>(initialRetryProgress).pipe(Atom.keepAlive)
const activeViewAtom = Atom.make<PullRequestView>(initialPullRequestView(config.repository)).pipe(Atom.keepAlive)
const queueLoadCacheAtom = Atom.make<Partial<Record<string, PullRequestLoad>>>({}).pipe(Atom.keepAlive)
const queueSelectionAtom = Atom.make<Partial<Record<string, number>>>({}).pipe(Atom.keepAlive)
const trimQueueLoadCache = (cache: Partial<Record<string, PullRequestLoad>>) => {
	const repositoryKeys = Object.keys(cache).filter((key) => key.startsWith("repository:"))
	if (repositoryKeys.length <= MAX_REPOSITORY_CACHE_ENTRIES) return cache
	const remove = new Set(repositoryKeys.slice(0, repositoryKeys.length - MAX_REPOSITORY_CACHE_ENTRIES))
	return Object.fromEntries(Object.entries(cache).filter(([key]) => !remove.has(key))) as Partial<Record<string, PullRequestLoad>>
}
const pullRequestsAtom = githubRuntime.atom(
	GitHubService.use((github) =>
		Effect.gen(function*() {
			const view = yield* Atom.get(activeViewAtom)
			const queueMode = viewMode(view)
			const repository = viewRepository(view)
			const cacheKey = viewCacheKey(view)
			yield* Atom.set(retryProgressAtom, initialRetryProgress)
			const page = yield* github.listOpenPullRequestPage({
				mode: queueMode,
				repository,
				cursor: null,
				pageSize: Math.min(pullRequestPageSize, config.prFetchLimit),
			}).pipe(
					Effect.tapError(() =>
						Atom.update(retryProgressAtom, (current) => RetryProgress.Retrying({
							attempt: Math.min(RetryProgress.$match(current, { Idle: () => 0, Retrying: ({ attempt }) => attempt }) + 1, PR_FETCH_RETRIES),
							max: PR_FETCH_RETRIES,
						}))
					),
					Effect.retry({ times: PR_FETCH_RETRIES, schedule: Schedule.exponential("300 millis", 2) }),
					Effect.tapError(() => Atom.set(retryProgressAtom, initialRetryProgress)),
				)

			yield* Atom.set(retryProgressAtom, initialRetryProgress)
			const cache = yield* Atom.get(queueLoadCacheAtom)
			const existingLoad = cache[cacheKey]
			const data = mergeCachedDetails(page.items, existingLoad?.data)
			const load = {
				view,
				data,
				fetchedAt: new Date(),
				endCursor: page.endCursor,
				hasNextPage: page.hasNextPage && data.length < config.prFetchLimit,
			} satisfies PullRequestLoad
			const nextCache = { ...cache }
			delete nextCache[cacheKey]
			nextCache[cacheKey] = load
			yield* Atom.set(queueLoadCacheAtom, trimQueueLoadCache(nextCache))
			return load
		})
	),
).pipe(Atom.keepAlive)
const selectedIndexAtom = Atom.make(0)
const noticeAtom = Atom.make<string | null>(null)
const filterQueryAtom = Atom.make("")
const filterDraftAtom = Atom.make("")
const filterModeAtom = Atom.make(false)
const pendingGAtom = Atom.make(false)
const detailFullViewAtom = Atom.make(false)
const detailScrollOffsetAtom = Atom.make(0)
const diffFullViewAtom = Atom.make(false)
const diffFileIndexAtom = Atom.make(0)
const diffScrollTopAtom = Atom.make(0)
const diffRenderViewAtom = Atom.make<DiffView>("split")
const diffWrapModeAtom = Atom.make<DiffWrapMode>("none")
const diffCommentModeAtom = Atom.make(false)
const diffCommentAnchorIndexAtom = Atom.make(0)
const diffCommentThreadsAtom = Atom.make<Record<string, readonly PullRequestReviewComment[]>>({}).pipe(Atom.keepAlive)
const diffCommentsLoadedAtom = Atom.make<Record<string, "loading" | "ready">>({}).pipe(Atom.keepAlive)
const pullRequestDiffCacheAtom = Atom.make<Record<string, PullRequestDiffState>>({}).pipe(Atom.keepAlive)

const activeModalAtom = Atom.make<Modal>(initialModal)
const themeIdAtom = Atom.make<ThemeId>(initialThemeId).pipe(Atom.keepAlive)
const labelCacheAtom = Atom.make<Record<string, readonly PullRequestLabel[]>>({}).pipe(Atom.keepAlive)
const pullRequestOverridesAtom = Atom.make<Record<string, PullRequestItem>>({}).pipe(Atom.keepAlive)
const recentlyCompletedPullRequestsAtom = Atom.make<Record<string, PullRequestItem>>({}).pipe(Atom.keepAlive)
const usernameAtom = githubRuntime.atom(
	config.author === "@me"
		? GitHubService.use((github) => github.getAuthenticatedUser())
		: Effect.succeed(config.author.replace(/^@/, "")),
).pipe(Atom.keepAlive)

const pullRequestLoadAtom = Atom.make((get) => {
	const view = get(activeViewAtom)
	const cacheKey = viewCacheKey(view)
	const cache = get(queueLoadCacheAtom)
	const result = get(pullRequestsAtom)
	const resolved = AsyncResult.getOrElse(result, () => null)
	return cache[cacheKey] ?? (resolved && viewCacheKey(resolved.view) === cacheKey ? resolved : null)
})

const isLoadingQueueModeAtom = Atom.make((get) => {
	const cacheKey = viewCacheKey(get(activeViewAtom))
	const resolved = AsyncResult.getOrElse(get(pullRequestsAtom), () => null)
	return resolved !== null && viewCacheKey(resolved.view) !== cacheKey
})

const pullRequestStatusAtom = Atom.make((get): LoadStatus => {
	const result = get(pullRequestsAtom)
	const load = get(pullRequestLoadAtom)
	const isLoadingQueue = get(isLoadingQueueModeAtom)
	if ((result.waiting || isLoadingQueue) && load === null) return "loading"
	return AsyncResult.isFailure(result) ? "error" : "ready"
})

const displayedPullRequestsAtom = Atom.make((get) => {
	const load = get(pullRequestLoadAtom)
	const overrides = get(pullRequestOverridesAtom)
	const recentlyCompleted = get(recentlyCompletedPullRequestsAtom)
	const source = load?.data ?? []
	const seenUrls = new Set<string>()
	const open = source.map((pullRequest) => {
		seenUrls.add(pullRequest.url)
		return recentlyCompleted[pullRequest.url] ?? overrides[pullRequest.url] ?? pullRequest
	})
	return [
		...open,
		...Object.values(recentlyCompleted).filter((pullRequest) => !seenUrls.has(pullRequest.url)),
	]
})

const effectiveFilterQueryAtom = Atom.make((get) =>
	(get(filterModeAtom) ? get(filterDraftAtom) : get(filterQueryAtom)).trim().toLowerCase(),
)

const filteredPullRequestsAtom = Atom.make((get) => {
	const pullRequests = get(displayedPullRequestsAtom)
	const query = get(effectiveFilterQueryAtom)
	if (query.length === 0) return pullRequests
	return pullRequests.flatMap((pullRequest) => {
		const score = pullRequestFilterScore(pullRequest, query)
		return score === null ? [] : [{ pullRequest, score }]
	}).sort((left, right) =>
		left.score - right.score || right.pullRequest.createdAt.getTime() - left.pullRequest.createdAt.getTime()
	).map(({ pullRequest }) => pullRequest)
})

const visibleRepoOrderAtom = Atom.make((get) => {
	const query = get(effectiveFilterQueryAtom)
	if (query.length === 0) return [] as readonly string[]
	return [...new Set(get(filteredPullRequestsAtom).map((pullRequest) => pullRequest.repository))]
})

const visibleGroupsAtom = Atom.make((get) =>
	groupBy(get(filteredPullRequestsAtom), (pullRequest) => pullRequest.repository, get(visibleRepoOrderAtom)),
)

const visiblePullRequestsAtom = Atom.make((get) => get(visibleGroupsAtom).flatMap(([, pullRequests]) => pullRequests))

const groupStartsAtom = Atom.make((get) => {
	const groups = get(visibleGroupsAtom)
	const starts: number[] = []
	for (let index = 0; index < groups.length; index++) {
		if (index === 0) starts.push(0)
		else starts.push(starts[index - 1]! + groups[index - 1]![1].length)
	}
	return starts
})

const selectedPullRequestAtom = Atom.make((get) => {
	const pullRequests = get(visiblePullRequestsAtom)
	const index = get(selectedIndexAtom)
	return pullRequests[index] ?? null
})

const selectedDiffKeyAtom = Atom.make((get) => {
	const pullRequest = get(selectedPullRequestAtom)
	return pullRequest ? pullRequestDiffKey(pullRequest) : null
})

const selectedDiffStateAtom = Atom.make((get) => {
	const key = get(selectedDiffKeyAtom)
	if (!key) return undefined
	return get(pullRequestDiffCacheAtom)[key]
})

const listRepoLabelsAtom = githubRuntime.fn<string>()((repository) =>
	GitHubService.use((github) => github.listRepoLabels(repository))
)
const listOpenPullRequestPageAtom = githubRuntime.fn<ListPullRequestPageInput>()((input) =>
	GitHubService.use((github) => github.listOpenPullRequestPage(input))
)
const pullRequestDetailsAtom = Atom.family((key: string) => {
	const { repository, number } = parsePullRequestDetailAtomKey(key)
	return githubRuntime.atom(GitHubService.use((github) => github.getPullRequestDetails(repository, number)))
})
const addPullRequestLabelAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly label: string }>()((input) =>
	GitHubService.use((github) => github.addPullRequestLabel(input.repository, input.number, input.label))
)
const removePullRequestLabelAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly label: string }>()((input) =>
	GitHubService.use((github) => github.removePullRequestLabel(input.repository, input.number, input.label))
)
const toggleDraftAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly isDraft: boolean }>()((input) =>
	GitHubService.use((github) => github.toggleDraftStatus(input.repository, input.number, input.isDraft))
)
const pullRequestDiffAtom = Atom.family((key: string) => {
	const { repository, number } = parsePullRequestDiffAtomKey(key)
	return githubRuntime.atom(GitHubService.use((github) => github.getPullRequestDiff(repository, number)))
})
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
const copyToClipboardAtom = githubRuntime.fn<string>()((text) => Clipboard.use((clipboard) => clipboard.copy(text)))
const openInBrowserAtom = githubRuntime.fn<PullRequestItem>()((pullRequest) => BrowserOpener.use((browser) => browser.openPullRequest(pullRequest)))

const centeredOffset = (outer: number, inner: number) => Math.floor((outer - inner) / 2)


const pasteText = (event: PasteEvent) => new TextDecoder().decode(event.bytes)

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

const pullRequestMetadataText = (pullRequest: PullRequestItem) => {
	const lines = [
		pullRequest.title,
		`${pullRequest.repository} #${pullRequest.number}`,
		pullRequest.url,
	]
	const review = reviewLabel(pullRequest)
	if (review) lines.push(`review: ${review}`)
	if (pullRequest.checkSummary) lines.push(pullRequest.checkSummary)
	return lines.join("\n")
}

const pullRequestDetailKey = (pullRequest: PullRequestItem) => `${pullRequest.url}:${pullRequest.headRefOid}`
const pullRequestRevisionAtomKey = (pullRequest: PullRequestItem) => `${pullRequest.repository}\u0000${pullRequest.number}\u0000${pullRequest.headRefOid}`
const parsePullRequestRevisionAtomKey = (key: string, label: string) => {
	const [repository, number] = key.split("\u0000")
	if (!repository || !number) throw new Error(`Invalid pull request ${label} key: ${key}`)
	return { repository, number: Number.parseInt(number, 10) }
}
const pullRequestDetailAtomKey = pullRequestRevisionAtomKey
const pullRequestDiffAtomKey = pullRequestRevisionAtomKey
const parsePullRequestDetailAtomKey = (key: string) => parsePullRequestRevisionAtomKey(key, "detail")
const parsePullRequestDiffAtomKey = (key: string) => parsePullRequestRevisionAtomKey(key, "diff")

const isShiftG = (key: { readonly name: string; readonly shift?: boolean }) => key.name === "G" || key.name === "g" && key.shift

const isThemeKey = (key: { readonly name: string; readonly ctrl?: boolean; readonly meta?: boolean }) => !key.ctrl && !key.meta && key.name.toLowerCase() === "t"

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

const diffCommentGutterColor = (anchor: DiffCommentAnchor, kind: "selected" | "thread") => {
	const accent = kind === "thread"
		? colors.status.pending
		: anchor.side === "RIGHT" ? colors.status.passing : colors.status.failing
	return mixHex(originalDiffLineColor(anchor).gutter, accent, 0.45)
}

const diffSideTargets = (diff: DiffRenderable, anchor: DiffCommentAnchor, view: DiffView) => {
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
			hint: retryProgress._tag === "Retrying" ? `Retry ${retryProgress.attempt}/${retryProgress.max}` : "Fetching latest open PRs",
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
	const registry = useContext(RegistryContext)
	const pullRequestResult = useAtomValue(pullRequestsAtom)
	const refreshPullRequestsAtom = useAtomRefresh(pullRequestsAtom)
	const [activeView, setActiveView] = useAtom(activeViewAtom)
	const setQueueLoadCache = useAtomSet(queueLoadCacheAtom)
	const setQueueSelection = useAtomSet(queueSelectionAtom)
	const [selectedIndex, setSelectedIndex] = useAtom(selectedIndexAtom)
	const [notice, setNotice] = useAtom(noticeAtom)
	const [filterQuery, setFilterQuery] = useAtom(filterQueryAtom)
	const [filterDraft, setFilterDraft] = useAtom(filterDraftAtom)
	const [filterMode, setFilterMode] = useAtom(filterModeAtom)
	const [pendingG, setPendingG] = useAtom(pendingGAtom)
	const [detailFullView, setDetailFullView] = useAtom(detailFullViewAtom)
	const setDetailScrollOffset = useAtomSet(detailScrollOffsetAtom)
	const [diffFullView, setDiffFullView] = useAtom(diffFullViewAtom)
	const [diffFileIndex, setDiffFileIndex] = useAtom(diffFileIndexAtom)
	const [diffScrollTop, setDiffScrollTop] = useAtom(diffScrollTopAtom)
	const [diffRenderView, setDiffRenderView] = useAtom(diffRenderViewAtom)
	const [diffWrapMode, setDiffWrapMode] = useAtom(diffWrapModeAtom)
	const [diffCommentMode, setDiffCommentMode] = useAtom(diffCommentModeAtom)
	const [diffCommentAnchorIndex, setDiffCommentAnchorIndex] = useAtom(diffCommentAnchorIndexAtom)
	const [diffCommentThreads, setDiffCommentThreads] = useAtom(diffCommentThreadsAtom)
	const setDiffCommentsLoaded = useAtomSet(diffCommentsLoadedAtom)
	const setPullRequestDiffCache = useAtomSet(pullRequestDiffCacheAtom)
	const [activeModal, setActiveModal] = useAtom(activeModalAtom)
	const [themeId, setThemeId] = useAtom(themeIdAtom)
	const closeActiveModal = () => setActiveModal(initialModal)
	const labelModalActive = Modal.$is("Label")(activeModal)
	const closeModalActive = Modal.$is("Close")(activeModal)
	const mergeModalActive = Modal.$is("Merge")(activeModal)
	const commentModalActive = Modal.$is("Comment")(activeModal)
	const commentThreadModalActive = Modal.$is("CommentThread")(activeModal)
	const themeModalActive = Modal.$is("Theme")(activeModal)
	const commandPaletteActive = Modal.$is("CommandPalette")(activeModal)
	const openRepositoryModalActive = Modal.$is("OpenRepository")(activeModal)
	const labelModal: LabelModalState = labelModalActive ? activeModal : initialLabelModalState
	const closeModal: CloseModalState = closeModalActive ? activeModal : initialCloseModalState
	const mergeModal: MergeModalState = mergeModalActive ? activeModal : initialMergeModalState
	const commentModal: CommentModalState = commentModalActive ? activeModal : initialCommentModalState
	const commentThreadModal: CommentThreadModalState = commentThreadModalActive ? activeModal : initialCommentThreadModalState
	const themeModal: ThemeModalState = themeModalActive ? activeModal : initialThemeModalState
	const commandPalette: CommandPaletteState = commandPaletteActive ? activeModal : initialCommandPaletteState
	const openRepositoryModal: OpenRepositoryModalState = openRepositoryModalActive ? activeModal : initialOpenRepositoryModalState
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
	const setCommandPalette = makeModalSetter("CommandPalette")
	const setOpenRepositoryModal = makeModalSetter("OpenRepository")
	setActiveTheme(themeId)
	const themeIdRef = useRef(themeId)
	const themeModalRef = useRef(themeModal)
	themeIdRef.current = themeId
	themeModalRef.current = themeModal
	const setLabelCache = useAtomSet(labelCacheAtom)
	const setPullRequestOverrides = useAtomSet(pullRequestOverridesAtom)
	const setRecentlyCompletedPullRequests = useAtomSet(recentlyCompletedPullRequestsAtom)
	const retryProgress = useAtomValue(retryProgressAtom)
	const [loadingFrame, setLoadingFrame] = useState(0)
	const [refreshCompletionMessage, setRefreshCompletionMessage] = useState<string | null>(null)
	const [refreshStartedAt, setRefreshStartedAt] = useState<number | null>(null)
	const [terminalFocused, setTerminalFocused] = useState(true)
	const [loadingMoreKey, setLoadingMoreKey] = useState<string | null>(null)
	const usernameResult = useAtomValue(usernameAtom)
	const loadRepoLabels = useAtomSet(listRepoLabelsAtom, { mode: "promise" })
	const loadPullRequestPage = useAtomSet(listOpenPullRequestPageAtom, { mode: "promise" })
	const addPullRequestLabel = useAtomSet(addPullRequestLabelAtom, { mode: "promise" })
	const removePullRequestLabel = useAtomSet(removePullRequestLabelAtom, { mode: "promise" })
	const toggleDraftStatus = useAtomSet(toggleDraftAtom, { mode: "promise" })
	const listPullRequestComments = useAtomSet(listPullRequestCommentsAtom, { mode: "promise" })
	const getPullRequestMergeInfo = useAtomSet(getPullRequestMergeInfoAtom, { mode: "promise" })
	const mergePullRequest = useAtomSet(mergePullRequestAtom, { mode: "promise" })
	const closePullRequest = useAtomSet(closePullRequestAtom, { mode: "promise" })
	const createPullRequestComment = useAtomSet(createPullRequestCommentAtom, { mode: "promise" })
	const copyToClipboard = useAtomSet(copyToClipboardAtom, { mode: "promise" })
	const openInBrowser = useAtomSet(openInBrowserAtom, { mode: "promise" })
	const terminalWidth = width ?? 100
	const terminalHeight = height ?? 24
	const contentWidth = Math.max(1, terminalWidth)
	const isWideLayout = terminalWidth >= 100
	const splitGap = 1
	const sectionPadding = 1
	const leftPaneWidth = isWideLayout ? Math.max(44, Math.floor((contentWidth - splitGap) * 0.56)) : contentWidth
	const rightPaneWidth = isWideLayout ? Math.max(28, contentWidth - leftPaneWidth - splitGap) : contentWidth
	const dividerJunctionAt = Math.max(1, leftPaneWidth)
	const leftContentWidth = isWideLayout ? Math.max(24, leftPaneWidth - 2) : Math.max(24, contentWidth - sectionPadding * 2)
	const rightContentWidth = isWideLayout ? Math.max(24, rightPaneWidth - sectionPadding * 2) : Math.max(24, contentWidth - sectionPadding * 2)
	const wideDetailLines = Math.max(8, terminalHeight - 8)
	const wideBodyHeight = Math.max(8, terminalHeight - 4)
	const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const pendingGTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const diffPrefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const detailPrefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const detailHydrationRef = useRef(new Map<string, DetailHydration>())
	const refreshGenerationRef = useRef(0)
	const didMountQueueModeRef = useRef(false)
	const lastPullRequestRefreshAtRef = useRef(0)
	const terminalFocusedRef = useRef(true)
	const terminalWasBlurredRef = useRef(false)
	const pullRequestStatusRef = useRef<LoadStatus>("loading")
	const refreshPullRequestsRef = useRef<(message?: string) => void>(() => {})
	const maybeRefreshPullRequestsRef = useRef<(minimumAgeMs: number) => void>(() => {})
	const detailScrollRef = useRef<ScrollBoxRenderable | null>(null)
	const detailPreviewScrollRef = useRef<ScrollBoxRenderable | null>(null)
	const diffScrollRef = useRef<ScrollBoxRenderable | null>(null)
	const prListScrollRef = useRef<ScrollBoxRenderable | null>(null)
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
		refreshGenerationRef.current += 1
		detailHydrationRef.current.clear()
		if (noticeTimeoutRef.current !== null) {
			clearTimeout(noticeTimeoutRef.current)
		}
		if (pendingGTimeoutRef.current !== null) {
			clearTimeout(pendingGTimeoutRef.current)
		}
		if (diffPrefetchTimeoutRef.current !== null) {
			clearTimeout(diffPrefetchTimeoutRef.current)
		}
		if (detailPrefetchTimeoutRef.current !== null) {
			clearTimeout(detailPrefetchTimeoutRef.current)
		}
	}, [])

	const pullRequestLoad = useAtomValue(pullRequestLoadAtom)
	const pullRequests = useAtomValue(displayedPullRequestsAtom)
	const pullRequestStatus = useAtomValue(pullRequestStatusAtom)
	const isInitialLoading = pullRequestStatus === "loading" && pullRequests.length === 0
	const pullRequestError = AsyncResult.isFailure(pullRequestResult) ? errorMessage(Cause.squash(pullRequestResult.cause)) : null
	const username = AsyncResult.isSuccess(usernameResult) ? usernameResult.value : null
	pullRequestStatusRef.current = pullRequestStatus

	const visibleFilterText = filterMode ? filterDraft : filterQuery

	const visibleGroups = useAtomValue(visibleGroupsAtom)
	const visiblePullRequests = useAtomValue(visiblePullRequestsAtom)
	const selectedPullRequest = useAtomValue(selectedPullRequestAtom)
	const selectedRepository = viewRepository(activeView)
	const activeViews = activePullRequestViews(activeView)
	const currentQueueCacheKey = viewCacheKey(activeView)
	const loadedPullRequestCount = pullRequestLoad?.data.length ?? 0
	const hasMorePullRequests = Boolean(pullRequestLoad?.hasNextPage && loadedPullRequestCount < config.prFetchLimit)
	const isLoadingMorePullRequests = loadingMoreKey === currentQueueCacheKey
	const pullRequestListRows = useMemo(() => buildPullRequestListRows({
		groups: visibleGroups,
		status: pullRequestStatus,
		error: pullRequestError,
		filterText: visibleFilterText,
		showFilterBar: filterMode || filterQuery.length > 0,
		loadedCount: loadedPullRequestCount,
		hasMore: hasMorePullRequests,
		isLoadingMore: isLoadingMorePullRequests,
	}), [visibleGroups, pullRequestStatus, pullRequestError, visibleFilterText, filterMode, filterQuery, loadedPullRequestCount, hasMorePullRequests, isLoadingMorePullRequests])
	const selectedPullRequestRowIndex = pullRequestListRowIndex(pullRequestListRows, selectedPullRequest?.url ?? null)
	const selectedDiffKey = useAtomValue(selectedDiffKeyAtom)
	const selectedDiffState = useAtomValue(selectedDiffStateAtom)
	const effectiveDiffRenderView = contentWidth >= 100 ? diffRenderView : "unified"
	const readyDiffFiles = selectedDiffState?._tag === "Ready" ? selectedDiffState.files : []
	const stackedDiffFiles = useMemo(() => buildStackedDiffFiles(readyDiffFiles, effectiveDiffRenderView, diffWrapMode, contentWidth), [readyDiffFiles, effectiveDiffRenderView, diffWrapMode, contentWidth])
	const diffCommentAnchors = useMemo(
		() => diffFullView ? getStackedDiffCommentAnchors(stackedDiffFiles, effectiveDiffRenderView, diffWrapMode, contentWidth) : [],
		[diffFullView, stackedDiffFiles, effectiveDiffRenderView, diffWrapMode, contentWidth],
	)
	const selectedDiffCommentAnchor = diffCommentAnchors[Math.max(0, Math.min(diffCommentAnchorIndex, diffCommentAnchors.length - 1))] ?? null
	const selectedDiffCommentThreadKey = selectedDiffKey && selectedDiffCommentAnchor ? `${selectedDiffKey}:${diffCommentLocationKey(selectedDiffCommentAnchor)}` : null
	const selectedDiffCommentThread = selectedDiffCommentThreadKey ? diffCommentThreads[selectedDiffCommentThreadKey] ?? [] : []
	const diffLineColorContextKey = selectedDiffKey ? `${selectedDiffKey}:${effectiveDiffRenderView}:${diffWrapMode}` : null
	const diffCommentRows = useMemo(
		() => [...new Set(diffCommentAnchors.map((anchor) => anchor.renderLine))].sort((left, right) => left - right),
		[diffCommentAnchors],
	)
	const groupStarts = useAtomValue(groupStartsAtom)
	const getCurrentGroupIndex = (current: number) => {
		if (groupStarts.length === 0) return 0
		let low = 0
		let high = groupStarts.length - 1
		while (low < high) {
			const mid = (low + high + 1) >>> 1
			if (groupStarts[mid]! <= current) low = mid
			else high = mid - 1
		}
		return low
	}
	const summaryRight = pullRequestLoad?.fetchedAt
		? `updated ${formatShortDate(pullRequestLoad.fetchedAt)} ${formatTimestamp(pullRequestLoad.fetchedAt)}`
		: pullRequestStatus === "loading"
			? "loading pull requests..."
			: ""
	const headerLeft = username ? `GHUI  ${username}  ${viewLabel(activeView)}` : `GHUI  ${viewLabel(activeView)}`
	const headerLine = `${fitCell(headerLeft, Math.max(0, headerFooterWidth - summaryRight.length))}${summaryRight}`
	const footerNotice = notice ? fitCell(notice, headerFooterWidth) : null
	const selectPullRequestByUrl = (url: string) => {
		const index = visiblePullRequests.findIndex((pullRequest) => pullRequest.url === url)
		if (index >= 0) {
			setSelectedIndex(index)
			setQueueSelection((current) => ({ ...current, [currentQueueCacheKey]: index }))
		}
	}
	const updatePullRequest = (url: string, transform: (pullRequest: PullRequestItem) => PullRequestItem) => {
		const pullRequest = pullRequests.find((item) => item.url === url)
		if (!pullRequest) return
		setPullRequestOverrides((current) => ({ ...current, [url]: transform(pullRequest) }))
	}
	const refreshPullRequests = (message?: string) => {
		refreshGenerationRef.current += 1
		detailHydrationRef.current.clear()
		if (detailPrefetchTimeoutRef.current !== null) clearTimeout(detailPrefetchTimeoutRef.current)
		setLoadingMoreKey(null)
		setPullRequestOverrides({})
		if (message) {
			setNotice(null)
			setRefreshCompletionMessage(message)
			setRefreshStartedAt(lastPullRequestRefreshAtRef.current)
		}
		refreshPullRequestsAtom()
	}
	refreshPullRequestsRef.current = refreshPullRequests
	const switchViewTo = (view: PullRequestView) => {
		if (viewEquals(view, activeView)) return
		refreshGenerationRef.current += 1
		setQueueSelection((current) => ({ ...current, [currentQueueCacheKey]: selectedIndex }))
		setActiveView(view)
		setSelectedIndex(registry.get(queueSelectionAtom)[viewCacheKey(view)] ?? 0)
		setRecentlyCompletedPullRequests({})
		detailHydrationRef.current.clear()
		if (detailPrefetchTimeoutRef.current !== null) clearTimeout(detailPrefetchTimeoutRef.current)
		setLoadingMoreKey(null)
		setDetailFullView(false)
		setDiffFullView(false)
		setDiffCommentMode(false)
		setFilterDraft(filterQuery)
		setNotice(null)
		setRefreshCompletionMessage(null)
		setRefreshStartedAt(null)
	}
	const switchQueueMode = (delta: 1 | -1) => {
		switchViewTo(nextView(activeView, activeViews, delta))
	}
	const loadMorePullRequests = () => {
		if (!pullRequestLoad || !hasMorePullRequests || isLoadingMorePullRequests || !pullRequestLoad.endCursor) return false
		const remaining = config.prFetchLimit - pullRequestLoad.data.length
		if (remaining <= 0) return false
		const cacheKey = currentQueueCacheKey
		const generation = refreshGenerationRef.current
		setLoadingMoreKey(cacheKey)
		void loadPullRequestPage({
			mode: viewMode(activeView),
			repository: selectedRepository,
			cursor: pullRequestLoad.endCursor,
			pageSize: Math.min(pullRequestPageSize, remaining),
		}).then((page) => {
			if (generation !== refreshGenerationRef.current) return
			setQueueLoadCache((current) => {
				const load = current[cacheKey]
				if (!load) return current
				const data = appendPullRequestPage(load.data, page.items)
				return {
					...current,
					[cacheKey]: {
						...load,
						data,
						endCursor: page.endCursor,
						hasNextPage: page.hasNextPage && data.length < config.prFetchLimit,
					},
				}
			})
		}).catch((error) => {
			flashNotice(errorMessage(error))
		}).finally(() => {
			setLoadingMoreKey((current) => current === cacheKey ? null : current)
		})
		return true
	}
	const applyPullRequestDetail = (detail: PullRequestItem) => {
		setQueueLoadCache((current) => {
			const next = { ...current }
			let changed = false
			for (const [cacheKey, load] of Object.entries(current)) {
				if (!load) continue
				const index = load.data.findIndex((pullRequest) => pullRequest.url === detail.url)
				if (index < 0) continue
				const data = [...load.data]
				data[index] = detail
				changed = true
				next[cacheKey] = { ...load, data }
			}
			return changed ? next : current
		})
	}
	const hydratePullRequestDetails = (pullRequest: PullRequestItem, notifyError: boolean) => {
		if (pullRequest.state !== "open" || pullRequest.detailLoaded) return false
		const detailKey = pullRequestDetailKey(pullRequest)
		const existing = detailHydrationRef.current.get(detailKey)
		if (existing) {
			if (notifyError) existing.notifyError = true
			return false
		}
		if (!notifyError && detailHydrationRef.current.size >= DETAIL_PREFETCH_CONCURRENCY) return false
		const entry: DetailHydration = { token: Symbol(detailKey), notifyError }
		detailHydrationRef.current.set(detailKey, entry)
		const generation = refreshGenerationRef.current
		const atom = pullRequestDetailsAtom(pullRequestDetailAtomKey(pullRequest))
		void Effect.runPromise(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).then((detail) => {
			if (generation === refreshGenerationRef.current && detailHydrationRef.current.get(detailKey) === entry) applyPullRequestDetail(detail)
		}).catch((error) => {
			if (entry.notifyError && generation === refreshGenerationRef.current && detailHydrationRef.current.get(detailKey) === entry) flashNotice(errorMessage(error))
		}).finally(() => {
			if (detailHydrationRef.current.get(detailKey) === entry) detailHydrationRef.current.delete(detailKey)
		})
		return true
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
		if (registry.get(queueLoadCacheAtom)[currentQueueCacheKey]) return
		refreshPullRequestsAtom()
	}, [currentQueueCacheKey, refreshPullRequestsAtom, registry])

	useEffect(() => {
		if (!refreshCompletionMessage || refreshStartedAt === null) return
		const fetchedAt = pullRequestLoad?.fetchedAt?.getTime()
		const isHydratingDetails = pullRequestStatus === "ready" && selectedPullRequest?.state === "open" && !selectedPullRequest.detailLoaded
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
		setQueueSelection((current) => current[currentQueueCacheKey] === selectedIndex ? current : { ...current, [currentQueueCacheKey]: selectedIndex })
	}, [currentQueueCacheKey, selectedIndex])

	useEffect(() => {
		if (filterMode || filterQuery.length > 0 || visiblePullRequests.length === 0) return
		const thresholdIndex = Math.max(0, visiblePullRequests.length - LOAD_MORE_SELECTION_THRESHOLD)
		if (selectedIndex >= thresholdIndex) loadMorePullRequests()
	}, [selectedIndex, visiblePullRequests.length, filterMode, filterQuery, hasMorePullRequests, isLoadingMorePullRequests, currentQueueCacheKey])

	useEffect(() => {
		const scroll = prListScrollRef.current
		if (!scroll || selectedPullRequestRowIndex === null) return
		const viewportHeight = scroll.viewport.height
		if (viewportHeight <= 0) return
		const nextTop = scrollTopForVisibleLine(scroll.scrollTop, viewportHeight, selectedPullRequestRowIndex, 2)
		if (nextTop !== scroll.scrollTop) scroll.scrollTo({ x: 0, y: nextTop })
	}, [selectedPullRequestRowIndex])

	useEffect(() => {
		setDiffFileIndex(0)
		setDiffScrollTop(0)
		setDiffCommentAnchorIndex(0)
		detailPreviewScrollRef.current?.scrollTo({ x: 0, y: 0 })
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
				if ((diffCommentThreads[`${selectedDiffKey}:${diffCommentLocationKey(anchor)}`]?.length ?? 0) > 0) {
					applyLineColor(anchor, diffCommentGutterColor(anchor, "thread"))
				}
			}
		}
		if (diffCommentMode && selectedDiffCommentAnchor) {
			applyLineColor(selectedDiffCommentAnchor, diffCommentGutterColor(selectedDiffCommentAnchor, "selected"), true)
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
	const isHydratingPullRequestDetails = pullRequestStatus === "ready" && selectedPullRequest?.state === "open" && !selectedPullRequest.detailLoaded
	const isRefreshingPullRequests = pullRequestResult.waiting && pullRequestLoad !== null
	const hasActiveLoadingIndicator = pullRequestResult.waiting || isHydratingPullRequestDetails || labelModal.loading || closeModal.running || mergeModal.loading || mergeModal.running || selectedDiffState?._tag === "Loading"
	const loadingIndicator = LOADING_FRAMES[loadingFrame % LOADING_FRAMES.length]!

	useEffect(() => {
		if (!hasActiveLoadingIndicator) return
		const interval = globalThis.setInterval(() => {
			setLoadingFrame((current) => (current + 1) % LOADING_FRAMES.length)
		}, 120)
		return () => globalThis.clearInterval(interval)
	}, [hasActiveLoadingIndicator])

	useEffect(() => {
		if (pullRequestStatus !== "ready" || !selectedPullRequest) return
		hydratePullRequestDetails(selectedPullRequest, true)
	}, [pullRequestStatus, selectedPullRequest?.url, selectedPullRequest?.headRefOid, selectedPullRequest?.state, selectedPullRequest?.detailLoaded, selectedPullRequest?.repository, selectedPullRequest?.number])

	useEffect(() => {
		if (detailPrefetchTimeoutRef.current !== null) clearTimeout(detailPrefetchTimeoutRef.current)
		if (pullRequestStatus !== "ready" || visiblePullRequests.length === 0) return
		detailPrefetchTimeoutRef.current = globalThis.setTimeout(() => {
			detailPrefetchTimeoutRef.current = null
			let started = 0
			for (let distance = 1; distance <= Math.max(DETAIL_PREFETCH_AHEAD, DETAIL_PREFETCH_BEHIND); distance++) {
				const offsets = [distance <= DETAIL_PREFETCH_AHEAD ? distance : null, distance <= DETAIL_PREFETCH_BEHIND ? -distance : null]
				for (const offset of offsets) {
					if (offset === null) continue
					if (started >= DETAIL_PREFETCH_CONCURRENCY) return
					const pullRequest = visiblePullRequests[selectedIndex + offset]
					if (pullRequest && hydratePullRequestDetails(pullRequest, false)) started += 1
				}
			}
		}, DETAIL_PREFETCH_DELAY_MS)
		return () => {
			if (detailPrefetchTimeoutRef.current !== null) clearTimeout(detailPrefetchTimeoutRef.current)
		}
	}, [pullRequestStatus, currentQueueCacheKey, selectedIndex, visiblePullRequests])

	const detailPlaceholderContent = getDetailPlaceholderContent({
		status: pullRequestStatus,
		retryProgress,
		loadingIndicator,
		visibleCount: visiblePullRequests.length,
		filterText: visibleFilterText,
	})
	const isSelectedPullRequestDetailLoading = selectedPullRequest !== null && !selectedPullRequest.detailLoaded
	const detailLoadingContent: DetailPlaceholderContent = selectedPullRequest ? {
		title: `${loadingIndicator} Loading pull request details`,
		hint: `${selectedPullRequest.repository} #${selectedPullRequest.number}`,
	} : detailPlaceholderContent
	const detailJunctions = isSelectedPullRequestDetailLoading ? [] : getDetailJunctionRows(selectedPullRequest, rightPaneWidth, true)

	const halfPage = Math.max(1, Math.floor(wideBodyHeight / 2))

	const loadPullRequestComments = (pullRequest: PullRequestItem, force = false) => {
		const key = pullRequestDiffKey(pullRequest)
		const previousLoadState = registry.get(diffCommentsLoadedAtom)[key]
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
		const existing = registry.get(pullRequestDiffCacheAtom)[key]
		if (includeComments) loadPullRequestComments(pullRequest, force)
		if (!force && existing && (existing._tag === "Ready" || existing._tag === "Loading")) return

		setPullRequestDiffCache((current) => ({ ...current, [key]: PullRequestDiffState.Loading() }))
		const atom = pullRequestDiffAtom(pullRequestDiffAtomKey(pullRequest))
		if (force) registry.refresh(atom)
		void Effect.runPromise(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }))
			.then((patch) => {
				setPullRequestDiffCache((current) => ({
					...current,
					[key]: PullRequestDiffState.Ready({ patch, files: splitPatchFiles(patch) }),
				}))
			})
			.catch((error) => {
				setPullRequestDiffCache((current) => ({
					...current,
					[key]: PullRequestDiffState.Error({ error: errorMessage(error) }),
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
		setDiffScrollTop(0)
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
		syncDiffScrollState()
	}

	const syncDiffScrollState = () => {
		const scrollTop = diffScrollRef.current?.scrollTop
		if (scrollTop === undefined || stackedDiffFiles.length === 0) return
		setDiffScrollTop((current) => current === scrollTop ? current : scrollTop)
		const nextIndex = stackedDiffFileAtLine(stackedDiffFiles, scrollTop)?.index ?? 0
		setDiffFileIndex((current) => current === nextIndex ? current : nextIndex)
	}

	const scrollDiffBy = (y: number) => {
		diffScrollRef.current?.scrollBy({ x: 0, y })
		syncDiffScrollState()
	}

	const scrollDiffTo = (y: number) => {
		diffScrollRef.current?.scrollTo({ x: 0, y })
		syncDiffScrollState()
	}
	const scrollDetailPreviewBy = (y: number) => detailPreviewScrollRef.current?.scrollBy({ x: 0, y })
	const scrollDetailPreviewTo = (y: number) => detailPreviewScrollRef.current?.scrollTo({ x: 0, y })

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
		const nextTop = scrollTopForVisibleLine(scroll.scrollTop, viewportHeight, line, DIFF_STICKY_HEADER_LINES)
		if (nextTop !== scroll.scrollTop) {
			scroll.scrollTo({ x: 0, y: nextTop })
			syncDiffScrollState()
		}
	}

	useEffect(() => {
		if (!diffFullView) return
		const interval = globalThis.setInterval(syncDiffScrollState, 80)
		return () => globalThis.clearInterval(interval)
	}, [diffFullView, stackedDiffFiles])

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
		setDiffCommentAnchorIndex(nearestDiffCommentAnchorIndex(diffCommentAnchors, scrollTop + DIFF_STICKY_HEADER_LINES))
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

	const selectDiffCommentLine = (renderLine: number, side: DiffCommentSide | null) => {
		const lineAnchors = diffCommentAnchors.filter((anchor) => anchor.renderLine === renderLine)
		const nextAnchor = (side ? lineAnchors.find((anchor) => anchor.side === side) : undefined) ?? lineAnchors[0]
		if (!nextAnchor) return
		suppressNextDiffCommentScrollRef.current = true
		setDiffCommentAnchorIndex(diffCommentAnchors.indexOf(nextAnchor))
		setDiffFileIndex(nextAnchor.fileIndex)
		setDiffCommentMode(true)
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
		void openInBrowser(pullRequest)
			.then(() => flashNotice(`Opened #${pullRequest.number} in browser`))
			.catch((error) => flashNotice(errorMessage(error)))
	}

	const copySelectedPullRequestMetadata = () => {
		if (!selectedPullRequest) return
		void copyToClipboard(pullRequestMetadataText(selectedPullRequest))
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
		const cachedLabels = registry.get(labelCacheAtom)[repository]
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
		const filtered = filterLabels(labelModal.availableLabels, labelModal.query)
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

	const openCommandPalette = () => {
		setCommandPalette(initialCommandPaletteState)
	}
	const openRepositoryPicker = () => {
		setOpenRepositoryModal({ query: selectedRepository ?? "", error: null })
	}
	const openRepositoryFromInput = () => {
		const repository = parseRepositoryInput(openRepositoryModal.query)
		if (!repository) {
			setOpenRepositoryModal((current) => ({ ...current, error: "Enter a repository as owner/name or a GitHub URL." }))
			return
		}
		closeActiveModal()
		switchViewTo({ _tag: "Repository", repository })
		flashNotice(`Opened ${repository}`)
	}
	const insertPastedText = (text: string) => {
		if (text.length === 0) return false
		if (commandPaletteActive) {
			setCommandPalette((current) => ({ ...current, query: current.query + singleLineText(text), selectedIndex: 0 }))
			return true
		}
		if (openRepositoryModalActive) {
			setOpenRepositoryModal((current) => ({ ...current, query: current.query + singleLineText(text), error: null }))
			return true
		}
		if (themeModalActive && themeModal.filterMode) {
			editThemeQuery((query) => query + singleLineText(text))
			return true
		}
		if (commentModalActive) {
			editComment((state) => insertText(state, text.replace(/\r\n?/g, "\n")))
			return true
		}
		if (labelModalActive) {
			setLabelModal((current) => ({ ...current, query: current.query + singleLineText(text), selectedIndex: 0 }))
			return true
		}
		if (filterMode) {
			setFilterDraft((current) => current + singleLineText(text))
			return true
		}
		return false
	}

	useEffect(() => {
		const handlePaste = (event: PasteEvent) => {
			if (insertPastedText(pasteText(event))) event.preventDefault()
		}
		const keyInput = renderer.keyInput as unknown as {
			on: (event: "paste", handler: (event: PasteEvent) => void) => void
			off: (event: "paste", handler: (event: PasteEvent) => void) => void
		}
		keyInput.on("paste", handlePaste)
		return () => {
			keyInput.off("paste", handlePaste)
		}
	}, [renderer, commandPaletteActive, openRepositoryModalActive, themeModalActive, themeModal.filterMode, commentModalActive, labelModalActive, filterMode])

	const appCommands: readonly AppCommand[] = buildAppCommands({
		pullRequestStatus,
		filterQuery,
		filterMode,
		selectedRepository,
		activeViews,
		activeView,
		loadedPullRequestCount,
		hasMorePullRequests,
		isLoadingMorePullRequests,
		selectedPullRequest,
		detailFullView,
		diffFullView,
		diffReady: selectedDiffState?._tag === "Ready",
		effectiveDiffRenderView,
		diffWrapMode,
		readyDiffFileCount: readyDiffFiles.length,
		diffFileIndex,
		diffCommentMode,
		selectedDiffCommentAnchorLabel: selectedDiffCommentAnchor ? `${selectedDiffCommentAnchor.path}:${selectedDiffCommentAnchor.line}` : null,
		actions: {
			openCommandPalette,
			refreshPullRequests,
			openFilter: () => {
				setFilterDraft(filterQuery)
				setFilterMode(true)
			},
			clearFilter: () => {
				setFilterQuery("")
				setFilterDraft("")
				setFilterMode(false)
			},
			openThemeModal,
			openRepositoryPicker,
			loadMorePullRequests,
			switchViewTo,
			openDetails: () => {
				setDetailFullView(true)
				setDetailScrollOffset(0)
			},
			closeDetails: () => {
				setDetailFullView(false)
				setDetailScrollOffset(0)
			},
			openDiffView,
			closeDiffView: () => {
				setDiffFullView(false)
				setDiffCommentMode(false)
			},
			reloadDiff: () => {
				if (!selectedPullRequest) return
				loadPullRequestDiff(selectedPullRequest, { force: true, includeComments: true })
				flashNotice(`Refreshing diff for #${selectedPullRequest.number}`)
			},
			toggleDiffRenderView: () => setDiffRenderView((current) => current === "unified" ? "split" : "unified"),
			toggleDiffWrapMode: () => setDiffWrapMode((current) => current === "none" ? "word" : "none"),
			jumpDiffFile,
			toggleDiffCommentMode: () => {
				if (diffCommentMode) setDiffCommentMode(false)
				else enterDiffCommentMode()
			},
			openDiffCommentModal,
			togglePullRequestDraftStatus: toggleSelectedPullRequestDraftStatus,
			openLabelModal,
			openMergeModal,
			openCloseModal,
			openPullRequestInBrowser: () => {
				if (selectedPullRequest) openSelectedPullRequestInBrowser(selectedPullRequest)
			},
			copyPullRequestMetadata: copySelectedPullRequestMetadata,
			quit: () => renderer.destroy(),
		},
	})
	const runCommand = (command: AppCommand, options: { readonly notifyDisabled?: boolean; readonly closePalette?: boolean } = {}) => {
		if (!commandEnabled(command)) {
			if (options.notifyDisabled && command.disabledReason) flashNotice(command.disabledReason)
			return false
		}
		if (options.closePalette) closeActiveModal()
		command.run()
		return true
	}
	const runCommandById = (id: string, options: { readonly notifyDisabled?: boolean } = {}) => {
		const command = appCommands.find((entry) => entry.id === id)
		return command ? runCommand(command, options) : false
	}
	const dynamicPaletteCommands: readonly AppCommand[] = (() => {
		if (!commandPaletteActive) return []
		const repository = parseRepositoryInput(commandPalette.query)
		if (!repository || repository === selectedRepository) return []
		return [defineCommand({
			id: `view.repository.dynamic:${repository}`,
			title: `Open ${repository}`,
			scope: "View",
			subtitle: "Switch to this repository",
			run: () => switchViewTo({ _tag: "Repository", repository }),
		})]
	})()
	// Dynamic commands always pin to the top of the palette; they came directly from the
	// user's typed input so they shouldn't be filtered by fuzzy score against themselves.
	const commandPaletteCommands = commandPaletteActive
		? [
			...dynamicPaletteCommands,
			...sortCommandsByScope(filterCommands(appCommands.filter((command) => command.id !== "command.open" && commandEnabled(command)), commandPalette.query)),
		]
		: []
	const selectedCommandIndex = clampCommandIndex(commandPalette.selectedIndex, commandPaletteCommands)
	const selectedCommand = commandPaletteCommands[selectedCommandIndex] ?? null

	// Keymap migration phase 2: simple cmd-id bindings move out of useKeyboard.
	// Gated to "global mode" — no modal active, no full-view, not in filter editing —
	// so these don't dispatch on top of modal-specific handlers below.
	const globalKeymapActiveRef = useRef(false)
	globalKeymapActiveRef.current = !commandPaletteActive
		&& !openRepositoryModalActive
		&& !labelModalActive
		&& !commentModalActive
		&& !commentThreadModalActive
		&& !closeModalActive
		&& !mergeModalActive
		&& !themeModalActive
		&& !diffFullView
		&& !detailFullView
		&& !filterMode
	const runCommandByIdRef = useRef(runCommandById)
	runCommandByIdRef.current = runCommandById
	useBindings(() => ({
		enabled: () => globalKeymapActiveRef.current,
		bindings: [
			{ key: "/", cmd: () => runCommandByIdRef.current("filter.open") },
			{ key: "r", cmd: () => runCommandByIdRef.current("pull.refresh") },
			{ key: "t", cmd: () => runCommandByIdRef.current("theme.open") },
			{ key: "d", cmd: () => runCommandByIdRef.current("diff.open") },
			{ key: "l", cmd: () => runCommandByIdRef.current("pull.labels") },
			{ key: "m", cmd: () => runCommandByIdRef.current("pull.merge") },
			{ key: "shift+m", cmd: () => runCommandByIdRef.current("pull.merge") },
			{ key: "x", cmd: () => runCommandByIdRef.current("pull.close") },
			{ key: "o", cmd: () => runCommandByIdRef.current("pull.open-browser") },
			{ key: "s", cmd: () => runCommandByIdRef.current("pull.toggle-draft") },
			{ key: "shift+s", cmd: () => runCommandByIdRef.current("pull.toggle-draft") },
			{ key: "y", cmd: () => runCommandByIdRef.current("pull.copy-metadata") },
			{ key: "return", cmd: () => runCommandByIdRef.current("detail.open") },
		],
	}), [])
	// Always-on bindings — work even while modals are open.
	useBindings(() => ({
		bindings: [
			{ key: "ctrl+p", cmd: () => runCommandByIdRef.current("command.open") },
			{ key: "meta+k", cmd: () => runCommandByIdRef.current("command.open") },
		],
	}), [])

	// CloseModal: escape closes, enter confirms.
	const closeModalActiveRef = useRef(false)
	closeModalActiveRef.current = closeModalActive
	const closeActiveModalRef = useRef(closeActiveModal)
	closeActiveModalRef.current = closeActiveModal
	const confirmClosePullRequestRef = useRef(confirmClosePullRequest)
	confirmClosePullRequestRef.current = confirmClosePullRequest
	useBindings(() => ({
		enabled: () => closeModalActiveRef.current,
		bindings: [
			{ key: "escape", cmd: () => closeActiveModalRef.current() },
			{ key: "return", cmd: () => confirmClosePullRequestRef.current() },
		],
	}), [])

	// MergeModal: escape, enter (when options>0), up/down/j/k navigation.
	const mergeModalActiveRef = useRef(false)
	mergeModalActiveRef.current = mergeModalActive
	const mergeModalContextRef = useRef({ availableCount: 0, confirm: confirmMergeAction, setMergeModal })
	mergeModalContextRef.current = {
		availableCount: availableMergeActions(mergeModal.info).length,
		confirm: confirmMergeAction,
		setMergeModal,
	}
	const moveMergeSelection = (delta: -1 | 1) => mergeModalContextRef.current.setMergeModal((current) => {
		const max = Math.max(0, mergeModalContextRef.current.availableCount - 1)
		return { ...current, selectedIndex: Math.max(0, Math.min(max, current.selectedIndex + delta)) }
	})
	useBindings(() => ({
		enabled: () => mergeModalActiveRef.current,
		bindings: [
			{ key: "escape", cmd: () => closeActiveModalRef.current() },
			{ key: "return", cmd: () => {
				if (mergeModalContextRef.current.availableCount > 0) mergeModalContextRef.current.confirm()
			} },
			{ key: "up", cmd: () => moveMergeSelection(-1) },
			{ key: "k", cmd: () => moveMergeSelection(-1) },
			{ key: "down", cmd: () => moveMergeSelection(1) },
			{ key: "j", cmd: () => moveMergeSelection(1) },
		],
	}), [])

	// CommentThreadModal: scroll the thread, shortcut to compose a reply.
	const commentThreadModalActiveRef = useRef(false)
	commentThreadModalActiveRef.current = commentThreadModalActive
	const commentThreadCtxRef = useRef({ openDiffCommentModal, setCommentThreadModal, halfPage })
	commentThreadCtxRef.current = { openDiffCommentModal, setCommentThreadModal, halfPage }
	const scrollCommentThread = (delta: number) => commentThreadCtxRef.current.setCommentThreadModal((current) => ({
		...current,
		scrollOffset: Math.max(0, current.scrollOffset + delta),
	}))
	useBindings(() => ({
		enabled: () => commentThreadModalActiveRef.current,
		bindings: [
			{ key: "escape", cmd: () => closeActiveModalRef.current() },
			{ key: "return", cmd: () => commentThreadCtxRef.current.openDiffCommentModal() },
			{ key: "a", cmd: () => commentThreadCtxRef.current.openDiffCommentModal() },
			{ key: "c", cmd: () => commentThreadCtxRef.current.openDiffCommentModal() },
			{ key: "up", cmd: () => scrollCommentThread(-1) },
			{ key: "k", cmd: () => scrollCommentThread(-1) },
			{ key: "down", cmd: () => scrollCommentThread(1) },
			{ key: "j", cmd: () => scrollCommentThread(1) },
			{ key: "pageup", cmd: () => scrollCommentThread(-commentThreadCtxRef.current.halfPage) },
			{ key: "ctrl+u", cmd: () => scrollCommentThread(-commentThreadCtxRef.current.halfPage) },
			{ key: "pagedown", cmd: () => scrollCommentThread(commentThreadCtxRef.current.halfPage) },
			{ key: "ctrl+d", cmd: () => scrollCommentThread(commentThreadCtxRef.current.halfPage) },
			{ key: "ctrl+v", cmd: () => scrollCommentThread(commentThreadCtxRef.current.halfPage) },
		],
	}), [])

	// LabelModal: nav keys via keymap; text input stays in useKeyboard fallback.
	const labelModalActiveRef = useRef(false)
	labelModalActiveRef.current = labelModalActive
	const labelModalCtxRef = useRef({ toggleLabelAtIndex, setLabelModal, filteredCount: 0 })
	labelModalCtxRef.current = {
		toggleLabelAtIndex,
		setLabelModal,
		filteredCount: filterLabels(labelModal.availableLabels, labelModal.query).length,
	}
	const moveLabelSelection = (delta: -1 | 1) => labelModalCtxRef.current.setLabelModal((current) => {
		const max = Math.max(0, labelModalCtxRef.current.filteredCount - 1)
		return { ...current, selectedIndex: Math.max(0, Math.min(max, current.selectedIndex + delta)) }
	})
	useBindings(() => ({
		enabled: () => labelModalActiveRef.current,
		bindings: [
			{ key: "escape", cmd: () => closeActiveModalRef.current() },
			{ key: "return", cmd: () => labelModalCtxRef.current.toggleLabelAtIndex() },
			{ key: "up", cmd: () => moveLabelSelection(-1) },
			{ key: "k", cmd: () => moveLabelSelection(-1) },
			{ key: "down", cmd: () => moveLabelSelection(1) },
			{ key: "j", cmd: () => moveLabelSelection(1) },
		],
	}), [])

	// ThemeModal: nav + filter-mode toggle. j/k only navigate when not in filter mode
	// (so users can type those letters into the query).
	const themeModalActiveRef = useRef(false)
	themeModalActiveRef.current = themeModalActive
	const themeModalCtxRef = useRef({
		filterMode: false,
		hasResults: true,
		closeThemeModal,
		updateThemeQuery,
		moveThemeSelection,
	})
	themeModalCtxRef.current = {
		filterMode: themeModal.filterMode,
		hasResults: filterThemeDefinitions(themeModal.query).length > 0,
		closeThemeModal,
		updateThemeQuery,
		moveThemeSelection,
	}
	useBindings(() => ({
		enabled: () => themeModalActiveRef.current,
		bindings: [
			{ key: "escape", cmd: () => {
				if (themeModalCtxRef.current.filterMode) themeModalCtxRef.current.updateThemeQuery("", { filterMode: false })
				else themeModalCtxRef.current.closeThemeModal(false)
			} },
			{ key: "/", cmd: () => themeModalCtxRef.current.updateThemeQuery("", { filterMode: true }) },
			{ key: "return", cmd: () => {
				if (themeModalCtxRef.current.filterMode && !themeModalCtxRef.current.hasResults) return
				themeModalCtxRef.current.closeThemeModal(true)
			} },
			{ key: "up", cmd: () => themeModalCtxRef.current.moveThemeSelection(-1) },
			{ key: "down", cmd: () => themeModalCtxRef.current.moveThemeSelection(1) },
			{ key: "k", cmd: () => { if (!themeModalCtxRef.current.filterMode) themeModalCtxRef.current.moveThemeSelection(-1) } },
			{ key: "j", cmd: () => { if (!themeModalCtxRef.current.filterMode) themeModalCtxRef.current.moveThemeSelection(1) } },
		],
	}), [])

	// OpenRepositoryModal: escape closes, return submits.
	const openRepositoryModalActiveRef = useRef(false)
	openRepositoryModalActiveRef.current = openRepositoryModalActive
	const openRepositoryFromInputRef = useRef(openRepositoryFromInput)
	openRepositoryFromInputRef.current = openRepositoryFromInput
	useBindings(() => ({
		enabled: () => openRepositoryModalActiveRef.current,
		bindings: [
			{ key: "escape", cmd: () => closeActiveModalRef.current() },
			{ key: "return", cmd: () => openRepositoryFromInputRef.current() },
		],
	}), [])

	// CommentModal: full text editor — escape, submit, all the cursor/edit bindings.
	const commentModalActiveRef = useRef(false)
	commentModalActiveRef.current = commentModalActive
	const commentModalCtxRef = useRef({ submitDiffComment, editComment })
	commentModalCtxRef.current = { submitDiffComment, editComment }
	const editComm = (transform: Parameters<typeof editComment>[0]) => commentModalCtxRef.current.editComment(transform)
	useBindings(() => ({
		enabled: () => commentModalActiveRef.current,
		bindings: [
			{ key: "escape", cmd: () => closeActiveModalRef.current() },
			{ key: "ctrl+s", cmd: () => commentModalCtxRef.current.submitDiffComment() },
			{ key: "ctrl+a", cmd: () => editComm(moveLineStart) },
			{ key: "ctrl+e", cmd: () => editComm(moveLineEnd) },
			{ key: "ctrl+b", cmd: () => editComm(editorMoveLeft) },
			{ key: "ctrl+f", cmd: () => editComm(editorMoveRight) },
			{ key: "ctrl+w", cmd: () => editComm(deleteWordBackward) },
			{ key: "ctrl+u", cmd: () => editComm(deleteToLineStart) },
			{ key: "ctrl+k", cmd: () => editComm(deleteToLineEnd) },
			{ key: "ctrl+d", cmd: () => editComm(editorDeleteForward) },
			{ key: "meta+b", cmd: () => editComm(moveWordBackward) },
			{ key: "meta+left", cmd: () => editComm(moveWordBackward) },
			{ key: "meta+f", cmd: () => editComm(moveWordForward) },
			{ key: "meta+right", cmd: () => editComm(moveWordForward) },
			{ key: "meta+backspace", cmd: () => editComm(deleteWordBackward) },
			{ key: "meta+delete", cmd: () => editComm(deleteWordForward) },
			{ key: "backspace", cmd: () => editComm(editorBackspace) },
			{ key: "delete", cmd: () => editComm(editorDeleteForward) },
			{ key: "left", cmd: () => editComm(editorMoveLeft) },
			{ key: "right", cmd: () => editComm(editorMoveRight) },
			{ key: "up", cmd: () => editComm((state) => moveVertically(state, -1)) },
			{ key: "down", cmd: () => editComm((state) => moveVertically(state, 1)) },
			{ key: "home", cmd: () => editComm(moveLineStart) },
			{ key: "end", cmd: () => editComm(moveLineEnd) },
			{ key: "shift+return", cmd: () => editComm((state) => insertText(state, "\n")) },
			{ key: "return", cmd: () => commentModalCtxRef.current.submitDiffComment() },
		],
	}), [])

	// CommandPalette: escape closes, return runs, up/k & down/j navigate.
	const commandPaletteActiveRef = useRef(false)
	commandPaletteActiveRef.current = commandPaletteActive
	const commandPaletteCtxRef = useRef({
		runSelected: () => {},
		setCommandPalette,
		paletteCommands: commandPaletteCommands,
	})
	commandPaletteCtxRef.current = {
		runSelected: () => { if (selectedCommand) runCommand(selectedCommand, { notifyDisabled: true, closePalette: true }) },
		setCommandPalette,
		paletteCommands: commandPaletteCommands,
	}
	const moveCommandPaletteSelection = (delta: -1 | 1) => commandPaletteCtxRef.current.setCommandPalette((current) => {
		const selectedIndex = clampCommandIndex(current.selectedIndex + delta, commandPaletteCtxRef.current.paletteCommands)
		return selectedIndex === current.selectedIndex ? current : { ...current, selectedIndex }
	})
	useBindings(() => ({
		enabled: () => commandPaletteActiveRef.current,
		bindings: [
			{ key: "escape", cmd: () => closeActiveModalRef.current() },
			{ key: "ctrl+c", cmd: () => closeActiveModalRef.current() },
			{ key: "return", cmd: () => commandPaletteCtxRef.current.runSelected() },
			{ key: "up", cmd: () => moveCommandPaletteSelection(-1) },
			{ key: "down", cmd: () => moveCommandPaletteSelection(1) },
		],
	}), [])

	// FilterMode: escape cancels, return commits.
	const filterModeRef = useRef(false)
	filterModeRef.current = filterMode
	const filterCtxRef = useRef({ filterQuery, filterDraft, setFilterQuery, setFilterDraft, setFilterMode })
	filterCtxRef.current = { filterQuery, filterDraft, setFilterQuery, setFilterDraft, setFilterMode }
	useBindings(() => ({
		enabled: () => filterModeRef.current,
		bindings: [
			{ key: "escape", cmd: () => {
				filterCtxRef.current.setFilterDraft(filterCtxRef.current.filterQuery)
				filterCtxRef.current.setFilterMode(false)
			} },
			{ key: "return", cmd: () => {
				filterCtxRef.current.setFilterQuery(filterCtxRef.current.filterDraft)
				filterCtxRef.current.setFilterMode(false)
			} },
		],
	}), [])

	useKeyboard((key) => {
		if (commandPaletteActive) {
			if (isSingleLineInputKey(key)) {
				setCommandPalette((current) => {
					const query = editSingleLineInput(current.query, key) ?? current.query
					return current.query === query && current.selectedIndex === 0 ? current : { ...current, query, selectedIndex: 0 }
				})
			}
			return
		}

		if (openRepositoryModalActive) {
			if (isSingleLineInputKey(key)) {
				setOpenRepositoryModal((current) => ({
					...current,
					query: editSingleLineInput(current.query, key) ?? current.query,
					error: null,
				}))
			}
			return
		}

		if ((key.name === "q" && !commentModalActive && !(themeModalActive && themeModal.filterMode)) || (key.ctrl && key.name === "c")) {
			if (themeModalActive) {
				closeThemeModal(false)
				return
			}
			if (activeModal._tag !== "None") {
				closeActiveModal()
				return
			}
			runCommandById("app.quit")
			return
		}

		if (themeModalActive) {
			if (themeModal.filterMode && isSingleLineInputKey(key)) {
				editThemeQuery((query) => editSingleLineInput(query, key) ?? query)
			}
			return
		}

		if (commentModalActive) {
			const text = printableKeyText(key)
			if (text) editComment((state) => insertText(state, text))
			return
		}




		if (labelModalActive) {
			if (isSingleLineInputKey(key)) {
				setLabelModal((current) => ({
					...current,
					query: editSingleLineInput(current.query, key) ?? current.query,
					selectedIndex: 0,
				}))
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
					runCommandById("diff.comment-mode")
					return
				}
				if (key.name === "return" || key.name === "enter") {
					if (selectedDiffCommentThread.length > 0) openDiffCommentThreadModal()
					else openDiffCommentModal()
					return
				}
				if (key.name === "a") {
					runCommandById("diff.add-comment")
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
				if (key.name === "]" && selectedDiffState?._tag === "Ready") {
					runCommandById("diff.next-file")
					return
				}
				if (key.name === "[" && selectedDiffState?._tag === "Ready") {
					runCommandById("diff.previous-file")
					return
				}
				return
			}

			if (key.name === "escape" || key.name === "return" || key.name === "enter") {
				runCommandById("diff.close")
				return
			}
			if (key.name === "c" && selectedDiffState?._tag === "Ready") {
				runCommandById("diff.comment-mode")
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
				runCommandById("diff.toggle-view")
				return
			}
			if (key.name === "w") {
				runCommandById("diff.toggle-wrap")
				return
			}
			if (key.name === "r" && selectedPullRequest) {
				runCommandById("diff.reload")
				return
			}
			if ((key.name === "]" || key.name === "right" || key.name === "l") && selectedDiffState?._tag === "Ready") {
				runCommandById("diff.next-file")
				return
			}
			if ((key.name === "[" || key.name === "left" || key.name === "h") && selectedDiffState?._tag === "Ready") {
				runCommandById("diff.previous-file")
				return
			}
			if (key.name === "o" && selectedPullRequest) {
				runCommandById("pull.open-browser")
				return
			}
			return
		}

		if (detailFullView) {
			const plainKey = !key.ctrl && !key.meta && !key.option
			if (key.name === "escape" || (key.name === "return" || key.name === "enter")) {
				runCommandById("detail.close")
				return
			}
			if (isThemeKey(key)) {
				runCommandById("theme.open")
				return
			}
			if (plainKey && key.name === "d" && selectedPullRequest) {
				runCommandById("diff.open")
				return
			}
			if (plainKey && key.name === "x" && selectedPullRequest?.state === "open") {
				runCommandById("pull.close")
				return
			}
			if (plainKey && key.name === "l" && selectedPullRequest) {
				runCommandById("pull.labels")
				return
			}
			if (plainKey && (key.name === "m" || key.name === "M") && selectedPullRequest) {
				runCommandById("pull.merge")
				return
			}
			if (plainKey && (key.name === "s" || key.name === "S") && selectedPullRequest) {
				runCommandById("pull.toggle-draft")
				return
			}
			if (plainKey && key.name === "r") {
				runCommandById("pull.refresh")
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
				runCommandById("pull.open-browser")
				return
			}
			if (plainKey && key.name === "y" && selectedPullRequest) {
				runCommandById("pull.copy-metadata")
				return
			}
			return
		}

		if (filterMode) {
			if (isSingleLineInputKey(key)) {
				setFilterDraft((current) => editSingleLineInput(current, key) ?? current)
			}
			return
		}

		if (key.name === "tab") {
			switchQueueMode(key.shift ? -1 : 1)
			return
		}

		if (key.name === "escape" && filterQuery.length > 0) {
			runCommandById("filter.clear")
			return
		}
		if (isWideLayout && selectedPullRequest && !detailFullView && !diffFullView) {
			if (key.name === "home") {
				scrollDetailPreviewTo(0)
				return
			}
			if (key.name === "end") {
				scrollDetailPreviewTo(Number.MAX_SAFE_INTEGER)
				return
			}
			if (key.name === "pageup") {
				scrollDetailPreviewBy(-halfPage)
				return
			}
			if (key.name === "pagedown") {
				scrollDetailPreviewBy(halfPage)
				return
			}
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
			if (visiblePullRequests.length > 0 && selectedIndex >= visiblePullRequests.length - 1 && hasMorePullRequests) {
				loadMorePullRequests()
				return
			}
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
	})

	const fullscreenContentWidth = Math.max(24, contentWidth - 2)
	const fullscreenBodyLines = Math.max(8, terminalHeight - 8)
	const wideFullscreenDetailScrollable = getDetailsPaneHeight({
		pullRequest: selectedPullRequest,
		contentWidth: fullscreenContentWidth,
		bodyLines: DETAIL_BODY_SCROLL_LIMIT,
		paneWidth: contentWidth,
		showChecks: true,
	}) > wideBodyHeight
	const narrowFullscreenDetailScrollable = getDetailsPaneHeight({
		pullRequest: selectedPullRequest,
		contentWidth: fullscreenContentWidth,
		bodyLines: DETAIL_BODY_SCROLL_LIMIT,
		paneWidth: contentWidth,
	}) > wideBodyHeight
	const wideDetailHeaderHeight = getDetailHeaderHeight(selectedPullRequest, rightPaneWidth, true)
	const wideDetailBodyViewportHeight = Math.max(1, wideBodyHeight - wideDetailHeaderHeight)
	const wideDetailBodyHeight = getScrollableDetailBodyHeight(selectedPullRequest, rightContentWidth)
	const wideDetailBodyScrollable = wideDetailBodyHeight > wideDetailBodyViewportHeight

	const prListProps = {
		groups: visibleGroups,
		selectedUrl: selectedPullRequest?.url ?? null,
		status: pullRequestStatus,
		error: pullRequestError,
		filterText: visibleFilterText,
		showFilterBar: filterMode || filterQuery.length > 0,
		isFilterEditing: filterMode,
		loadedCount: loadedPullRequestCount,
		hasMore: hasMorePullRequests,
		isLoadingMore: isLoadingMorePullRequests,
		onSelectPullRequest: selectPullRequestByUrl,
	} as const

	const longestLabelName = labelModal.availableLabels.reduce((max, label) => Math.max(max, label.name.length), 0)
	const labelModalWidth = Math.min(Math.max(42, longestLabelName + 16), 56, contentWidth - 4)
	const labelModalHeight = Math.min(20, terminalHeight - 4)
	const labelModalLeft = centeredOffset(contentWidth, labelModalWidth)
	const labelModalTop = centeredOffset(terminalHeight, labelModalHeight)
	const sizedModal = (minW: number, maxW: number, padX: number, maxH: number) => {
		const w = Math.min(maxW, Math.max(minW, contentWidth - padX))
		const h = Math.min(maxH, terminalHeight - 4)
		return { width: w, height: h, left: centeredOffset(contentWidth, w), top: centeredOffset(terminalHeight, h) }
	}
	const closeLayout = sizedModal(46, 68, 12, 12)
	const closeModalWidth = closeLayout.width
	const closeModalHeight = closeLayout.height
	const closeModalLeft = closeLayout.left
	const closeModalTop = closeLayout.top
	const commentLayout = sizedModal(46, 76, 8, 16)
	const commentModalWidth = commentLayout.width
	const commentModalHeight = commentLayout.height
	const commentModalLeft = commentLayout.left
	const commentModalTop = commentLayout.top
	const commentThreadLayout = sizedModal(50, 86, 8, 22)
	const commentThreadModalWidth = commentThreadLayout.width
	const commentThreadModalHeight = commentThreadLayout.height
	const commentThreadModalLeft = commentThreadLayout.left
	const commentThreadModalTop = commentThreadLayout.top
	const commentAnchorLabel = selectedDiffCommentAnchor
		? `${selectedDiffCommentAnchor.path}:${selectedDiffCommentAnchor.line} ${selectedDiffCommentAnchor.side === "RIGHT" ? "right" : "left"}`
		: "No diff line selected"
	const mergeLayout = sizedModal(46, 68, 12, 16)
	const mergeModalWidth = mergeLayout.width
	const mergeModalHeight = mergeLayout.height
	const mergeModalLeft = mergeLayout.left
	const mergeModalTop = mergeLayout.top
	const themeLayout = sizedModal(38, 58, 12, 16)
	const themeModalWidth = themeLayout.width
	const themeModalHeight = themeLayout.height
	const themeModalLeft = themeLayout.left
	const themeModalTop = themeLayout.top
	const openRepositoryLayout = sizedModal(46, 76, 8, 8)
	const openRepositoryModalWidth = openRepositoryLayout.width
	const openRepositoryModalHeight = openRepositoryLayout.height
	const openRepositoryModalLeft = openRepositoryLayout.left
	const openRepositoryModalTop = openRepositoryLayout.top
	const commandPaletteLayout = sizedModal(50, 88, 8, 24)
	const commandPaletteWidth = commandPaletteLayout.width
	const commandPaletteHeight = commandPaletteLayout.height
	const commandPaletteLeft = commandPaletteLayout.left
	const commandPaletteTop = commandPaletteLayout.top

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
					scrollTop={diffScrollTop}
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
					onSelectCommentLine={selectDiffCommentLine}
					themeId={themeId}
				/>
			) : detailFullView && isSelectedPullRequestDetailLoading && selectedPullRequest ? (
				<box flexGrow={1} flexDirection="column">
					<DetailHeader pullRequest={selectedPullRequest} viewerUsername={username} contentWidth={fullscreenContentWidth} paneWidth={contentWidth} showChecks={isWideLayout} />
					<LoadingPane content={detailLoadingContent} width={contentWidth} height={Math.max(1, wideBodyHeight - getDetailHeaderHeight(selectedPullRequest, contentWidth, isWideLayout))} />
				</box>
			) : isWideLayout && detailFullView ? (
				<box flexGrow={1} flexDirection="column">
					<scrollbox ref={detailScrollRef} focused flexGrow={1} verticalScrollbarOptions={{ visible: wideFullscreenDetailScrollable }}>
						<DetailsPane
							pullRequest={selectedPullRequest}
							viewerUsername={username}
							contentWidth={fullscreenContentWidth}
							bodyLines={fullscreenBodyLines}
							bodyLineLimit={DETAIL_BODY_SCROLL_LIMIT}
							paneWidth={contentWidth}
							showChecks
							placeholderContent={detailPlaceholderContent}
							loadingIndicator={loadingIndicator}
							themeId={themeId}
						/>
					</scrollbox>
				</box>
			) : isWideLayout ? (
			<box key="wide-main" flexGrow={1} flexDirection="row">
					<box width={leftPaneWidth} height={wideBodyHeight} flexDirection="column">
						<scrollbox ref={prListScrollRef} focusable={false} height={wideBodyHeight} flexGrow={0}>
							<box paddingLeft={sectionPadding} paddingRight={0}>
								<PullRequestList key={`wide-${leftContentWidth}`} {...prListProps} contentWidth={leftContentWidth} />
							</box>
						</scrollbox>
					</box>
					<SeparatorColumn height={wideBodyHeight} junctionRows={detailJunctions} />
					<box width={rightPaneWidth} height={wideBodyHeight} flexDirection="column">
						{isSelectedPullRequestDetailLoading && selectedPullRequest ? (
							<>
								<DetailHeader pullRequest={selectedPullRequest} viewerUsername={username} contentWidth={rightContentWidth} paneWidth={rightPaneWidth} showChecks />
								<LoadingPane content={detailLoadingContent} width={rightPaneWidth} height={Math.max(1, wideBodyHeight - getDetailHeaderHeight(selectedPullRequest, rightPaneWidth, true))} />
							</>
						) : selectedPullRequest ? (
							<>
								<DetailHeader pullRequest={selectedPullRequest} viewerUsername={username} contentWidth={rightContentWidth} paneWidth={rightPaneWidth} showChecks />
								<scrollbox ref={detailPreviewScrollRef} flexGrow={1} verticalScrollbarOptions={{ visible: wideDetailBodyScrollable }}>
									<DetailBody pullRequest={selectedPullRequest} contentWidth={rightContentWidth} bodyLines={wideDetailLines} bodyLineLimit={DETAIL_BODY_SCROLL_LIMIT} loadingIndicator={loadingIndicator} themeId={themeId} />
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
							bodyLineLimit={DETAIL_BODY_SCROLL_LIMIT}
							paneWidth={contentWidth}
							placeholderContent={detailPlaceholderContent}
							loadingIndicator={loadingIndicator}
							themeId={themeId}
						/>
					</scrollbox>
				</box>
			) : (
				<box key="narrow-main" height={wideBodyHeight} flexDirection="column">
					<DetailsPane pullRequest={selectedPullRequest} viewerUsername={username} contentWidth={fullscreenContentWidth} paneWidth={contentWidth} placeholderContent={detailPlaceholderContent} loadingIndicator={loadingIndicator} themeId={themeId} />
					<Divider width={contentWidth} />
					<box flexGrow={1} flexDirection="column">
						<scrollbox ref={prListScrollRef} focusable={false} flexGrow={1}>
							<box paddingLeft={sectionPadding} paddingRight={sectionPadding}>
								<PullRequestList key={`narrow-${fullscreenContentWidth}`} {...prListProps} contentWidth={fullscreenContentWidth} />
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
			{openRepositoryModalActive ? (
				<OpenRepositoryModal
					state={openRepositoryModal}
					modalWidth={openRepositoryModalWidth}
					modalHeight={openRepositoryModalHeight}
					offsetLeft={openRepositoryModalLeft}
					offsetTop={openRepositoryModalTop}
				/>
			) : null}
			{commandPaletteActive ? (
				<CommandPalette
					commands={commandPaletteCommands}
					query={commandPalette.query}
					selectedIndex={selectedCommandIndex}
					modalWidth={commandPaletteWidth}
					modalHeight={commandPaletteHeight}
					offsetLeft={commandPaletteLeft}
					offsetTop={commandPaletteTop}
				/>
			) : null}
		</box>
	)
}
