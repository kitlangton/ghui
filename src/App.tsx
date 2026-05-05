import type { DiffRenderable, PasteEvent, ScrollBoxRenderable } from "@opentui/core"
import { RegistryContext, useAtom, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useKeymap } from "@ghui/keymap/react"
import { appKeymap, type AppCtx } from "./keymap/all.js"
import { useOpenTuiSubscribe } from "./keyboard/opentuiAdapter.js"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { Cause, Effect, Layer, Schedule } from "effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import { useContext, useEffect, useMemo, useRef, useState } from "react"
import { buildAppCommands } from "./appCommands.js"
import type { AppCommand } from "./commands.js"
import { clampCommandIndex, type CommandScope, commandEnabled, defineCommand, filterCommands, sortCommandsByActiveScope } from "./commands.js"
import { config } from "./config.js"
import {
	type CreatePullRequestCommentInput,
	type DiffCommentSide,
	type ListPullRequestPageInput,
	type LoadStatus,
	type PullRequestComment,
	type PullRequestItem,
	type PullRequestLabel,
	type PullRequestMergeAction,
	type PullRequestMergeMethod,
	type PullRequestReviewComment,
	type RepositoryMergeMethods,
	type SubmitPullRequestReviewInput,
} from "./domain.js"
import { allowedMergeMethodList, pullRequestMergeMethods } from "./domain.js"
import { formatShortDate, formatTimestamp } from "./date.js"
import { errorMessage } from "./errors.js"
import { getMergeKindDefinition, mergeInfoFromPullRequest, requiresMarkReady, visibleMergeKinds } from "./mergeActions.js"
import { Observability } from "./observability.js"
import { mergeCachedDetails } from "./pullRequestCache.js"
import type { PullRequestLoad } from "./pullRequestLoad.js"
import {
	activePullRequestViews,
	initialPullRequestView,
	nextView,
	parseRepositoryInput,
	type PullRequestView,
	viewCacheKey,
	viewEquals,
	viewLabel,
	viewMode,
	viewRepository,
} from "./pullRequestViews.js"
import { BrowserOpener } from "./services/BrowserOpener.js"
import { CacheService, type PullRequestCacheKey } from "./services/CacheService.js"
import { Clipboard } from "./services/Clipboard.js"
import { CommandRunner } from "./services/CommandRunner.js"
import { GitHubService } from "./services/GitHubService.js"
import { loadStoredDiffWhitespaceMode, loadStoredThemeId, saveStoredDiffWhitespaceMode, saveStoredThemeId } from "./themeStore.js"
import { colors, filterThemeDefinitions, mixHex, pairedThemeId, setActiveTheme, themeDefinitions, themeToneForThemeId, type ThemeId, type ThemeTone } from "./ui/colors.js"
import {
	backspace as editorBackspace,
	deleteForward as editorDeleteForward,
	deleteToLineEnd,
	deleteToLineStart,
	deleteWordBackward,
	deleteWordForward,
	insertText,
	moveLeft as editorMoveLeft,
	moveLineEnd,
	moveLineStart,
	moveRight as editorMoveRight,
	moveVertically,
	moveWordBackward,
	moveWordForward,
	type CommentEditorValue,
} from "./ui/commentEditor.js"
import {
	buildStackedDiffFiles,
	diffAnchorOnSide,
	diffCommentAnchorLabel,
	diffCommentLineLabel,
	diffCommentLocationKey,
	diffCommentSideLabel,
	getStackedDiffCommentAnchors,
	minimizeWhitespaceDiffFiles,
	PullRequestDiffState,
	pullRequestDiffKey,
	safeDiffFileIndex,
	scrollTopForVisibleLine,
	splitPatchFiles,
	stackedDiffFileIndexAtLine,
	type DiffCommentAnchor,
	type DiffCommentKind,
	type DiffView,
	type DiffWhitespaceMode,
	type DiffWrapMode,
	type StackedDiffCommentAnchor,
	verticalDiffAnchor,
} from "./ui/diff.js"
import {
	DETAIL_BODY_SCROLL_LIMIT,
	DetailBody,
	DetailHeader,
	DetailPlaceholder,
	DetailsPane,
	getDetailsPaneHeight,
	getDetailHeaderHeight,
	getDetailJunctionRows,
	getScrollableDetailBodyHeight,
	type DetailCommentsStatus,
	type DetailPlaceholderContent,
} from "./ui/DetailsPane.js"
import { FooterHints, initialRetryProgress, RetryProgress } from "./ui/FooterHints.js"
import { LoadingLogoPane } from "./ui/LoadingLogo.js"
import { Divider, Filler, fitCell, PlainLine, SeparatorColumn } from "./ui/primitives.js"
import { CommandPalette } from "./ui/CommandPalette.js"
import {
	ChangedFilesModal,
	CloseModal,
	CommentModal,
	CommentThreadModal,
	DeleteCommentModal,
	filterChangedFiles,
	filterLabels,
	initialChangedFilesModalState,
	initialCloseModalState,
	initialCommandPaletteState,
	initialCommentModalState,
	initialCommentThreadModalState,
	initialDeleteCommentModalState,
	initialLabelModalState,
	initialMergeModalState,
	initialModal,
	initialOpenRepositoryModalState,
	initialPullRequestStateModalState,
	initialSubmitReviewModalState,
	initialThemeModalState,
	LabelModal,
	MergeModal,
	Modal,
	OpenRepositoryModal,
	PullRequestStateModal,
	submitReviewOptions,
	SubmitReviewModal,
	ThemeModal,
	type ChangedFilesModalState,
	type CloseModalState,
	type CommandPaletteState,
	type CommentModalState,
	type CommentThreadModalState,
	type DeleteCommentModalState,
	type LabelModalState,
	type MergeModalState,
	type ModalState,
	type ModalTag,
	type OpenRepositoryModalState,
	type PullRequestStateModalState,
	type SubmitReviewModalState,
	type ThemeModalState,
} from "./ui/modals.js"
import { groupBy, pullRequestMetadataText } from "./ui/pullRequests.js"
import { quotedReplyBody } from "./ui/comments.js"
import { CommentsPane, commentsViewRowCount, orderCommentsForDisplay } from "./ui/CommentsPane.js"
import { PullRequestDiffPane } from "./ui/PullRequestDiffPane.js"
import { buildPullRequestListRows, pullRequestListRowIndex, PullRequestList } from "./ui/PullRequestList.js"
import { editSingleLineInput, isSingleLineInputKey, printableKeyText, singleLineText } from "./ui/singleLineInput.js"
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "./ui/spinner.js"

const parseOptionalPositiveInt = (value: string | undefined, fallback: number | null) => {
	if (value === undefined) return fallback
	const parsed = Number.parseInt(value, 10)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const mockPrCount = parseOptionalPositiveInt(process.env.GHUI_MOCK_PR_COUNT, null)
const pullRequestPageSize = Math.min(100, parseOptionalPositiveInt(process.env.GHUI_PR_PAGE_SIZE, config.prPageSize) ?? config.prPageSize)
const githubServiceLayer =
	mockPrCount !== null
		? (await import("./services/MockGitHubService.js")).MockGitHubService.layer({
				prCount: mockPrCount,
				repoCount: parseOptionalPositiveInt(process.env.GHUI_MOCK_REPO_COUNT, 4) ?? 4,
			})
		: GitHubService.layerNoDeps
const cacheServiceLayer = mockPrCount !== null ? CacheService.disabledLayer : CacheService.layerFromPath(config.cachePath)

const githubRuntime = Atom.runtime(
	Layer.mergeAll(githubServiceLayer, cacheServiceLayer, Clipboard.layerNoDeps, BrowserOpener.layerNoDeps).pipe(
		Layer.provide(CommandRunner.layer),
		Layer.provideMerge(Observability.layer),
	),
)
const [initialThemeId, initialDiffWhitespaceMode] = await Promise.all([Effect.runPromise(loadStoredThemeId), Effect.runPromise(loadStoredDiffWhitespaceMode)])
setActiveTheme(initialThemeId)

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

interface DiffCommentRangeSelection {
	readonly start: StackedDiffCommentAnchor
	readonly end: StackedDiffCommentAnchor
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
const MAX_REPOSITORY_CACHE_ENTRIES = 8
const LOAD_MORE_SELECTION_THRESHOLD = 8
const LOAD_MORE_SCROLL_THRESHOLD = 3
const DETAIL_PREFETCH_BEHIND = 1
const DETAIL_PREFETCH_AHEAD = 3
const DETAIL_PREFETCH_CONCURRENCY = 3
const DETAIL_PREFETCH_DELAY_MS = 120
const appendPullRequestPage = (existing: readonly PullRequestItem[], incoming: readonly PullRequestItem[]) => {
	const seen = new Set(existing.map((pullRequest) => pullRequest.url))
	const mergedIncoming = mergeCachedDetails(incoming, existing)
	return [...existing, ...mergedIncoming.filter((pullRequest) => !seen.has(pullRequest.url))]
}

const cacheViewerFor = (view: PullRequestView, username: string | null) => (view._tag === "Repository" ? "anonymous" : username)

const retryProgressAtom = Atom.make<RetryProgress>(initialRetryProgress).pipe(Atom.keepAlive)
const activeViewAtom = Atom.make<PullRequestView>(initialPullRequestView()).pipe(Atom.keepAlive)
const queueLoadCacheAtom = Atom.make<Partial<Record<string, PullRequestLoad>>>({}).pipe(Atom.keepAlive)
const queueSelectionAtom = Atom.make<Partial<Record<string, number>>>({}).pipe(Atom.keepAlive)
const trimQueueLoadCache = (cache: Partial<Record<string, PullRequestLoad>>) => {
	const repositoryKeys = Object.keys(cache).filter((key) => key.startsWith("repository:"))
	if (repositoryKeys.length <= MAX_REPOSITORY_CACHE_ENTRIES) return cache
	const remove = new Set(repositoryKeys.slice(0, repositoryKeys.length - MAX_REPOSITORY_CACHE_ENTRIES))
	return Object.fromEntries(Object.entries(cache).filter(([key]) => !remove.has(key))) as Partial<Record<string, PullRequestLoad>>
}
const pullRequestsAtom = githubRuntime
	.atom(
		GitHubService.use((github) =>
			Effect.gen(function* () {
				const cacheService = yield* CacheService
				const view = yield* Atom.get(activeViewAtom)
				const queueMode = viewMode(view)
				const repository = viewRepository(view)
				const cacheKey = viewCacheKey(view)
				const cacheUsername = view._tag === "Repository" ? null : yield* github.getAuthenticatedUser().pipe(Effect.catch(() => Effect.succeed(null)))
				const cacheViewer = cacheViewerFor(view, cacheUsername)
				if (cacheViewer) {
					const cachedLoad = yield* cacheService.readQueue(cacheViewer, view).pipe(Effect.catch(() => Effect.succeed(null)))
					if (cachedLoad) {
						const cache = yield* Atom.get(queueLoadCacheAtom)
						yield* Atom.set(queueLoadCacheAtom, trimQueueLoadCache({ ...cache, [cacheKey]: cachedLoad }))
					}
				}
				yield* Atom.set(retryProgressAtom, initialRetryProgress)
				const page = yield* github
					.listOpenPullRequestPage({
						mode: queueMode,
						repository,
						cursor: null,
						pageSize: Math.min(pullRequestPageSize, config.prFetchLimit),
					})
					.pipe(
						Effect.tapError(() =>
							Atom.update(retryProgressAtom, (current) =>
								RetryProgress.Retrying({
									attempt: Math.min(RetryProgress.$match(current, { Idle: () => 0, Retrying: ({ attempt }) => attempt }) + 1, PR_FETCH_RETRIES),
									max: PR_FETCH_RETRIES,
								}),
							),
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
				if (cacheViewer) yield* cacheService.writeQueue(cacheViewer, load)
				return load
			}),
		),
	)
	.pipe(Atom.keepAlive)
const wrapIndex = (index: number, length: number) => (length === 0 ? 0 : ((index % length) + length) % length)
const selectedIndexAtom = Atom.make(0)
const noticeAtom = Atom.make<string | null>(null)
const filterQueryAtom = Atom.make("")
const filterDraftAtom = Atom.make("")
const filterModeAtom = Atom.make(false)
const detailFullViewAtom = Atom.make(false)
const detailScrollOffsetAtom = Atom.make(0)
const diffFullViewAtom = Atom.make(false)
const commentsViewActiveAtom = Atom.make(false)
const commentsViewSelectionAtom = Atom.make(0)
const diffFileIndexAtom = Atom.make(0)
const diffScrollTopAtom = Atom.make(0)
const diffRenderViewAtom = Atom.make<DiffView>("split")
const diffWrapModeAtom = Atom.make<DiffWrapMode>("none")
const diffWhitespaceModeAtom = Atom.make<DiffWhitespaceMode>(initialDiffWhitespaceMode)
const diffCommentAnchorIndexAtom = Atom.make(0)
const diffPreferredSideAtom = Atom.make<DiffCommentSide | null>(null)
const diffCommentRangeStartIndexAtom = Atom.make<number | null>(null)
const diffCommentThreadsAtom = Atom.make<Record<string, readonly PullRequestReviewComment[]>>({}).pipe(Atom.keepAlive)
const diffCommentsLoadedAtom = Atom.make<Record<string, "loading" | "ready">>({}).pipe(Atom.keepAlive)
const pullRequestCommentsAtom = Atom.make<Record<string, readonly PullRequestComment[]>>({}).pipe(Atom.keepAlive)
const pullRequestCommentsLoadedAtom = Atom.make<Record<string, "loading" | "ready">>({}).pipe(Atom.keepAlive)
const pullRequestDiffCacheAtom = Atom.make<Record<string, PullRequestDiffState>>({}).pipe(Atom.keepAlive)

const activeModalAtom = Atom.make<Modal>(initialModal)
const themeIdAtom = Atom.make<ThemeId>(initialThemeId).pipe(Atom.keepAlive)
const labelCacheAtom = Atom.make<Record<string, readonly PullRequestLabel[]>>({}).pipe(Atom.keepAlive)
const repoMergeMethodsCacheAtom = Atom.make<Record<string, RepositoryMergeMethods>>({}).pipe(Atom.keepAlive)
const lastUsedMergeMethodAtom = Atom.make<Record<string, PullRequestMergeMethod>>({}).pipe(Atom.keepAlive)
const pullRequestOverridesAtom = Atom.make<Record<string, PullRequestItem>>({}).pipe(Atom.keepAlive)
const recentlyCompletedPullRequestsAtom = Atom.make<Record<string, PullRequestItem>>({}).pipe(Atom.keepAlive)
const usernameAtom = githubRuntime.atom(GitHubService.use((github) => github.getAuthenticatedUser())).pipe(Atom.keepAlive)

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
	if (AsyncResult.isFailure(result) && load === null) return "error"
	return "ready"
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
	return [...open, ...Object.values(recentlyCompleted).filter((pullRequest) => !seenUrls.has(pullRequest.url))]
})

const effectiveFilterQueryAtom = Atom.make((get) => (get(filterModeAtom) ? get(filterDraftAtom) : get(filterQueryAtom)).trim().toLowerCase())

const filteredPullRequestsAtom = Atom.make((get) => {
	const pullRequests = get(displayedPullRequestsAtom)
	const query = get(effectiveFilterQueryAtom)
	if (query.length === 0) return pullRequests
	return pullRequests
		.flatMap((pullRequest) => {
			const score = pullRequestFilterScore(pullRequest, query)
			return score === null ? [] : [{ pullRequest, score }]
		})
		.sort((left, right) => left.score - right.score || right.pullRequest.createdAt.getTime() - left.pullRequest.createdAt.getTime())
		.map(({ pullRequest }) => pullRequest)
})

const visibleRepoOrderAtom = Atom.make((get) => {
	const query = get(effectiveFilterQueryAtom)
	if (query.length === 0) return [] as readonly string[]
	return [...new Set(get(filteredPullRequestsAtom).map((pullRequest) => pullRequest.repository))]
})

const visibleGroupsAtom = Atom.make((get) => groupBy(get(filteredPullRequestsAtom), (pullRequest) => pullRequest.repository, get(visibleRepoOrderAtom)))

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

const listRepoLabelsAtom = githubRuntime.fn<string>()((repository) => GitHubService.use((github) => github.listRepoLabels(repository)))
const listOpenPullRequestPageAtom = githubRuntime.fn<ListPullRequestPageInput>()((input) => GitHubService.use((github) => github.listOpenPullRequestPage(input)))
const pullRequestDetailsAtom = Atom.family((key: string) => {
	const { repository, number } = parsePullRequestDetailAtomKey(key)
	return githubRuntime.atom(GitHubService.use((github) => github.getPullRequestDetails(repository, number)))
})
const readCachedPullRequestAtom = githubRuntime.fn<PullRequestCacheKey>()((key) => CacheService.use((cache) => cache.readPullRequest(key)))
const writeCachedPullRequestAtom = githubRuntime.fn<PullRequestItem>()((pullRequest) => CacheService.use((cache) => cache.upsertPullRequest(pullRequest)))
const writeQueueCacheAtom = githubRuntime.fn<{ readonly viewer: string; readonly load: PullRequestLoad }>()(({ viewer, load }) =>
	CacheService.use((cache) => cache.writeQueue(viewer, load)),
)
const pruneCacheAtom = githubRuntime.fn<void>()(() => CacheService.use((cache) => cache.prune()))
const addPullRequestLabelAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly label: string }>()((input) =>
	GitHubService.use((github) => github.addPullRequestLabel(input.repository, input.number, input.label)),
)
const removePullRequestLabelAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly label: string }>()((input) =>
	GitHubService.use((github) => github.removePullRequestLabel(input.repository, input.number, input.label)),
)
const toggleDraftAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly isDraft: boolean }>()((input) =>
	GitHubService.use((github) => github.toggleDraftStatus(input.repository, input.number, input.isDraft)),
)
const pullRequestDiffAtom = Atom.family((key: string) => {
	const { repository, number } = parsePullRequestDiffAtomKey(key)
	return githubRuntime.atom(GitHubService.use((github) => github.getPullRequestDiff(repository, number)))
})
const listPullRequestReviewCommentsAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number }>()((input) =>
	GitHubService.use((github) => github.listPullRequestReviewComments(input.repository, input.number)),
)
const listPullRequestCommentsAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number }>()((input) =>
	GitHubService.use((github) => github.listPullRequestComments(input.repository, input.number)),
)
const getPullRequestMergeInfoAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number }>()((input) =>
	GitHubService.use((github) => github.getPullRequestMergeInfo(input.repository, input.number)),
)
const getRepositoryMergeMethodsAtom = githubRuntime.fn<string>()((repository) => GitHubService.use((github) => github.getRepositoryMergeMethods(repository)))
const mergePullRequestAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly action: PullRequestMergeAction }>()((input) =>
	GitHubService.use((github) => github.mergePullRequest(input.repository, input.number, input.action)),
)
const closePullRequestAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number }>()((input) =>
	GitHubService.use((github) => github.closePullRequest(input.repository, input.number)),
)
const createPullRequestCommentAtom = githubRuntime.fn<CreatePullRequestCommentInput>()((input) => GitHubService.use((github) => github.createPullRequestComment(input)))
const createPullRequestIssueCommentAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly body: string }>()((input) =>
	GitHubService.use((github) => github.createPullRequestIssueComment(input.repository, input.number, input.body)),
)
const replyToReviewCommentAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly inReplyTo: string; readonly body: string }>()((input) =>
	GitHubService.use((github) => github.replyToReviewComment(input.repository, input.number, input.inReplyTo, input.body)),
)
const editPullRequestIssueCommentAtom = githubRuntime.fn<{ readonly repository: string; readonly commentId: string; readonly body: string }>()((input) =>
	GitHubService.use((github) => github.editPullRequestIssueComment(input.repository, input.commentId, input.body)),
)
const editReviewCommentAtom = githubRuntime.fn<{ readonly repository: string; readonly commentId: string; readonly body: string }>()((input) =>
	GitHubService.use((github) => github.editReviewComment(input.repository, input.commentId, input.body)),
)
const deletePullRequestIssueCommentAtom = githubRuntime.fn<{ readonly repository: string; readonly commentId: string }>()((input) =>
	GitHubService.use((github) => github.deletePullRequestIssueComment(input.repository, input.commentId)),
)
const deleteReviewCommentAtom = githubRuntime.fn<{ readonly repository: string; readonly commentId: string }>()((input) =>
	GitHubService.use((github) => github.deleteReviewComment(input.repository, input.commentId)),
)
const submitPullRequestReviewAtom = githubRuntime.fn<SubmitPullRequestReviewInput>()((input) => GitHubService.use((github) => github.submitPullRequestReview(input)))
const copyToClipboardAtom = githubRuntime.fn<string>()((text) => Clipboard.use((clipboard) => clipboard.copy(text)))
const openInBrowserAtom = githubRuntime.fn<PullRequestItem>()((pullRequest) => BrowserOpener.use((browser) => browser.openPullRequest(pullRequest)))
const openUrlAtom = githubRuntime.fn<string>()((url) => BrowserOpener.use((browser) => browser.openUrl(url)))

const pickInitialMergeMethod = (allowed: RepositoryMergeMethods | null, preferred: PullRequestMergeMethod | undefined): PullRequestMergeMethod => {
	if (!allowed) return preferred ?? pullRequestMergeMethods[0]
	if (preferred && allowed[preferred]) return preferred
	return allowedMergeMethodList(allowed)[0] ?? pullRequestMergeMethods[0]
}

const centeredOffset = (outer: number, inner: number) => Math.floor((outer - inner) / 2)

const pasteText = (event: PasteEvent) => new TextDecoder().decode(event.bytes)

const pullRequestFilterScore = (pullRequest: PullRequestItem, query: string) => {
	const normalized = query.trim().toLowerCase()
	if (normalized.length === 0) return 0
	const fields = [pullRequest.title.toLowerCase(), pullRequest.repository.toLowerCase(), String(pullRequest.number)]
	const scores = fields.flatMap((field, index) => {
		const matchIndex = field.indexOf(normalized)
		return matchIndex >= 0 ? [index * 1000 + matchIndex] : []
	})
	return scores.length > 0 ? Math.min(...scores) : null
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

const diffCommentThreadMapKey = (diffKey: string, location: Pick<PullRequestReviewComment, "path" | "side" | "line">) => `${diffKey}:${diffCommentLocationKey(location)}`

const diffCommentThreadKey = (pullRequest: PullRequestItem, comment: Pick<PullRequestReviewComment, "path" | "side" | "line">) =>
	diffCommentThreadMapKey(pullRequestDiffKey(pullRequest), comment)

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

const reviewCommentAsPullRequestComment = (comment: PullRequestReviewComment): PullRequestComment => ({ _tag: "review-comment", ...comment })

// Walk the inReplyTo chain to find the thread root id. The /replies endpoint
// rejects ids that aren't roots with "parent comment not found".
const findReviewThreadRootId = (comments: readonly PullRequestComment[], commentId: string): string => {
	const reviewById = new Map<string, PullRequestComment & { readonly _tag: "review-comment" }>()
	for (const entry of comments) if (entry._tag === "review-comment") reviewById.set(entry.id, entry)
	let cursor = reviewById.get(commentId)
	const seen = new Set<string>()
	while (cursor && cursor.inReplyTo && !seen.has(cursor.id)) {
		seen.add(cursor.id)
		const parent = reviewById.get(cursor.inReplyTo)
		if (!parent) break
		cursor = parent
	}
	return cursor?.id ?? commentId
}

const reviewStatusAfterSubmit = {
	COMMENT: null,
	APPROVE: "approved",
	REQUEST_CHANGES: "changes",
} satisfies Record<SubmitPullRequestReviewInput["event"], PullRequestItem["reviewStatus"] | null>

const originalDiffLineColor = (anchor: DiffCommentAnchor): DiffLineColorConfig => {
	if (anchor.kind === "addition") {
		return { gutter: colors.diff.addedLineNumberBg, content: colors.diff.addedBg }
	}
	if (anchor.kind === "deletion") {
		return { gutter: colors.diff.removedLineNumberBg, content: colors.diff.removedBg }
	}
	return { gutter: colors.diff.lineNumberBg, content: colors.diff.contextBg }
}

const selectedDiffCommentAccentByKind = {
	addition: () => colors.status.passing,
	deletion: () => colors.status.failing,
	context: () => colors.muted,
} satisfies Record<DiffCommentKind, () => string>

const selectedDiffCommentAccent = (kind: DiffCommentKind) => selectedDiffCommentAccentByKind[kind]()

const mixDiffLineContentColor = (base: string, accent: string, amount: number) => mixHex(base === "transparent" ? colors.background : base, accent, amount)

const diffCommentLineColor = (anchor: DiffCommentAnchor, kind: "selected" | "range" | "thread"): DiffLineColorConfig => {
	const original = originalDiffLineColor(anchor)
	const accent = kind === "thread" ? colors.status.pending : selectedDiffCommentAccent(anchor.kind)
	if (kind === "thread") return { ...original, gutter: mixHex(original.gutter, accent, 0.3) }
	return {
		gutter: mixHex(original.gutter, accent, kind === "selected" ? 0.38 : 0.26),
		content: mixDiffLineContentColor(original.content, accent, kind === "selected" ? 0.2 : 0.1),
	}
}

const sameDiffCommentTarget = (left: DiffCommentAnchor, right: DiffCommentAnchor) => left.path === right.path && left.side === right.side

const diffCommentRangeSelection = (start: StackedDiffCommentAnchor | null, end: StackedDiffCommentAnchor | null): DiffCommentRangeSelection | null => {
	if (!start || !end || !sameDiffCommentTarget(start, end)) return null
	return start.line <= end.line ? { start, end } : { start: end, end: start }
}

const diffCommentRangeContains = (range: DiffCommentRangeSelection, anchor: StackedDiffCommentAnchor) =>
	sameDiffCommentTarget(range.start, anchor) && anchor.line >= range.start.line && anchor.line <= range.end.line

const diffCommentRangeLabel = (range: DiffCommentRangeSelection) =>
	range.start.line === range.end.line
		? diffCommentAnchorLabel(range.end)
		: `${diffCommentSideLabel(range.end)} ${diffCommentLineLabel(range.start)}-${diffCommentLineLabel(range.end)}`

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

const getDetailPlaceholderContent = ({ status, retryProgress, loadingIndicator, visibleCount, filterText }: DetailPlaceholderInput): DetailPlaceholderContent => {
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
	const [detailFullView, setDetailFullView] = useAtom(detailFullViewAtom)
	const setDetailScrollOffset = useAtomSet(detailScrollOffsetAtom)
	const [diffFullView, setDiffFullView] = useAtom(diffFullViewAtom)
	const [commentsViewActive, setCommentsViewActive] = useAtom(commentsViewActiveAtom)
	const [commentsViewSelection, setCommentsViewSelection] = useAtom(commentsViewSelectionAtom)
	const [diffFileIndex, setDiffFileIndex] = useAtom(diffFileIndexAtom)
	const [diffScrollTop, setDiffScrollTop] = useAtom(diffScrollTopAtom)
	const [diffRenderView, setDiffRenderView] = useAtom(diffRenderViewAtom)
	const [diffWrapMode, setDiffWrapMode] = useAtom(diffWrapModeAtom)
	const [diffWhitespaceMode, setDiffWhitespaceMode] = useAtom(diffWhitespaceModeAtom)
	const [diffCommentAnchorIndex, setDiffCommentAnchorIndex] = useAtom(diffCommentAnchorIndexAtom)
	const [diffPreferredSide, setDiffPreferredSide] = useAtom(diffPreferredSideAtom)
	const [diffCommentRangeStartIndex, setDiffCommentRangeStartIndex] = useAtom(diffCommentRangeStartIndexAtom)
	const [diffCommentThreads, setDiffCommentThreads] = useAtom(diffCommentThreadsAtom)
	const setDiffCommentsLoaded = useAtomSet(diffCommentsLoadedAtom)
	const setPullRequestComments = useAtomSet(pullRequestCommentsAtom)
	const setPullRequestCommentsLoaded = useAtomSet(pullRequestCommentsLoadedAtom)
	const setPullRequestDiffCache = useAtomSet(pullRequestDiffCacheAtom)
	const [activeModal, setActiveModal] = useAtom(activeModalAtom)
	const [themeId, setThemeId] = useAtom(themeIdAtom)
	const closeActiveModal = () => setActiveModal(initialModal)
	const labelModalActive = Modal.$is("Label")(activeModal)
	const closeModalActive = Modal.$is("Close")(activeModal)
	const pullRequestStateModalActive = Modal.$is("PullRequestState")(activeModal)
	const mergeModalActive = Modal.$is("Merge")(activeModal)
	const commentModalActive = Modal.$is("Comment")(activeModal)
	const deleteCommentModalActive = Modal.$is("DeleteComment")(activeModal)
	const commentThreadModalActive = Modal.$is("CommentThread")(activeModal)
	const changedFilesModalActive = Modal.$is("ChangedFiles")(activeModal)
	const submitReviewModalActive = Modal.$is("SubmitReview")(activeModal)
	const themeModalActive = Modal.$is("Theme")(activeModal)
	const commandPaletteActive = Modal.$is("CommandPalette")(activeModal)
	const openRepositoryModalActive = Modal.$is("OpenRepository")(activeModal)
	const labelModal: LabelModalState = labelModalActive ? activeModal : initialLabelModalState
	const closeModal: CloseModalState = closeModalActive ? activeModal : initialCloseModalState
	const pullRequestStateModal: PullRequestStateModalState = pullRequestStateModalActive ? activeModal : initialPullRequestStateModalState
	const mergeModal: MergeModalState = mergeModalActive ? activeModal : initialMergeModalState
	const commentModal: CommentModalState = commentModalActive ? activeModal : initialCommentModalState
	const deleteCommentModal: DeleteCommentModalState = deleteCommentModalActive ? activeModal : initialDeleteCommentModalState
	const commentThreadModal: CommentThreadModalState = commentThreadModalActive ? activeModal : initialCommentThreadModalState
	const changedFilesModal: ChangedFilesModalState = changedFilesModalActive ? activeModal : initialChangedFilesModalState
	const submitReviewModal: SubmitReviewModalState = submitReviewModalActive ? activeModal : initialSubmitReviewModalState
	const themeModal: ThemeModalState = themeModalActive ? activeModal : initialThemeModalState
	const commandPalette: CommandPaletteState = commandPaletteActive ? activeModal : initialCommandPaletteState
	const openRepositoryModal: OpenRepositoryModalState = openRepositoryModalActive ? activeModal : initialOpenRepositoryModalState
	const makeModalSetter =
		<Tag extends Exclude<ModalTag, "None">>(tag: Tag) =>
		(next: ModalState<Tag> | ((prev: ModalState<Tag>) => ModalState<Tag>)) =>
			setActiveModal((current) => {
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
	const setPullRequestStateModal = makeModalSetter("PullRequestState")
	const setMergeModal = makeModalSetter("Merge")
	const setCommentModal = makeModalSetter("Comment")
	const setDeleteCommentModal = makeModalSetter("DeleteComment")
	const setCommentThreadModal = makeModalSetter("CommentThread")
	const setChangedFilesModal = makeModalSetter("ChangedFiles")
	const setSubmitReviewModal = makeModalSetter("SubmitReview")
	const setThemeModal = makeModalSetter("Theme")
	const setCommandPalette = makeModalSetter("CommandPalette")
	const setOpenRepositoryModal = makeModalSetter("OpenRepository")
	const themeIdRef = useRef(themeId)
	const themeModalRef = useRef(themeModal)
	themeIdRef.current = themeId
	themeModalRef.current = themeModal
	const setLabelCache = useAtomSet(labelCacheAtom)
	const setRepoMergeMethodsCache = useAtomSet(repoMergeMethodsCacheAtom)
	const setLastUsedMergeMethod = useAtomSet(lastUsedMergeMethodAtom)
	const setPullRequestOverrides = useAtomSet(pullRequestOverridesAtom)
	const setRecentlyCompletedPullRequests = useAtomSet(recentlyCompletedPullRequestsAtom)
	const retryProgress = useAtomValue(retryProgressAtom)
	const [loadingFrame, setLoadingFrame] = useState(0)
	const [refreshCompletionMessage, setRefreshCompletionMessage] = useState<string | null>(null)
	const [refreshStartedAt, setRefreshStartedAt] = useState<number | null>(null)
	const [terminalFocused, setTerminalFocused] = useState(true)
	const [startupLoadComplete, setStartupLoadComplete] = useState(false)
	const [loadingMoreKey, setLoadingMoreKey] = useState<string | null>(null)
	const usernameResult = useAtomValue(usernameAtom)
	const loadRepoLabels = useAtomSet(listRepoLabelsAtom, { mode: "promise" })
	const loadPullRequestPage = useAtomSet(listOpenPullRequestPageAtom, { mode: "promise" })
	const addPullRequestLabel = useAtomSet(addPullRequestLabelAtom, { mode: "promise" })
	const removePullRequestLabel = useAtomSet(removePullRequestLabelAtom, { mode: "promise" })
	const toggleDraftStatus = useAtomSet(toggleDraftAtom, { mode: "promise" })
	const listPullRequestReviewComments = useAtomSet(listPullRequestReviewCommentsAtom, { mode: "promise" })
	const listPullRequestComments = useAtomSet(listPullRequestCommentsAtom, { mode: "promise" })
	const readCachedPullRequest = useAtomSet(readCachedPullRequestAtom, { mode: "promise" })
	const writeCachedPullRequest = useAtomSet(writeCachedPullRequestAtom, { mode: "promise" })
	const writeQueueCache = useAtomSet(writeQueueCacheAtom, { mode: "promise" })
	const pruneCache = useAtomSet(pruneCacheAtom, { mode: "promise" })
	const getPullRequestMergeInfo = useAtomSet(getPullRequestMergeInfoAtom, { mode: "promise" })
	const getRepositoryMergeMethods = useAtomSet(getRepositoryMergeMethodsAtom, { mode: "promise" })
	const mergePullRequest = useAtomSet(mergePullRequestAtom, { mode: "promise" })
	const closePullRequest = useAtomSet(closePullRequestAtom, { mode: "promise" })
	const createPullRequestComment = useAtomSet(createPullRequestCommentAtom, { mode: "promise" })
	const createPullRequestIssueComment = useAtomSet(createPullRequestIssueCommentAtom, { mode: "promise" })
	const replyToReviewComment = useAtomSet(replyToReviewCommentAtom, { mode: "promise" })
	const editPullRequestIssueComment = useAtomSet(editPullRequestIssueCommentAtom, { mode: "promise" })
	const editReviewComment = useAtomSet(editReviewCommentAtom, { mode: "promise" })
	const deletePullRequestIssueComment = useAtomSet(deletePullRequestIssueCommentAtom, { mode: "promise" })
	const deleteReviewComment = useAtomSet(deleteReviewCommentAtom, { mode: "promise" })
	const submitPullRequestReview = useAtomSet(submitPullRequestReviewAtom, { mode: "promise" })
	const copyToClipboard = useAtomSet(copyToClipboardAtom, { mode: "promise" })
	const openInBrowser = useAtomSet(openInBrowserAtom, { mode: "promise" })
	const openUrl = useAtomSet(openUrlAtom, { mode: "promise" })
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
	const diffPrefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const detailPrefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const detailHydrationRef = useRef(new Map<string, DetailHydration>())
	const refreshGenerationRef = useRef(0)
	const didMountQueueModeRef = useRef(false)
	const lastPullRequestRefreshAtRef = useRef(0)
	const terminalFocusedRef = useRef(true)
	const terminalWasBlurredRef = useRef(false)
	const pullRequestStatusRef = useRef<LoadStatus>("loading")
	const refreshPullRequestsRef = useRef<(message?: string, options?: { readonly resetTransientState?: boolean }) => void>(() => {})
	const maybeRefreshPullRequestsRef = useRef<(minimumAgeMs: number) => void>(() => {})
	const detailScrollRef = useRef<ScrollBoxRenderable | null>(null)
	const detailPreviewScrollRef = useRef<ScrollBoxRenderable | null>(null)
	const cachedDetailKeysRef = useRef(new Set<string>())
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

	useEffect(
		() => () => {
			refreshGenerationRef.current += 1
			detailHydrationRef.current.clear()
			if (noticeTimeoutRef.current !== null) {
				clearTimeout(noticeTimeoutRef.current)
			}
			if (diffPrefetchTimeoutRef.current !== null) {
				clearTimeout(diffPrefetchTimeoutRef.current)
			}
			if (detailPrefetchTimeoutRef.current !== null) {
				clearTimeout(detailPrefetchTimeoutRef.current)
			}
		},
		[],
	)

	const pullRequestLoad = useAtomValue(pullRequestLoadAtom)
	const pullRequests = useAtomValue(displayedPullRequestsAtom)
	const pullRequestStatus = useAtomValue(pullRequestStatusAtom)
	const isInitialLoading = !startupLoadComplete && pullRequestStatus === "loading" && pullRequests.length === 0
	const pullRequestError = AsyncResult.isFailure(pullRequestResult) ? errorMessage(Cause.squash(pullRequestResult.cause)) : null
	const username = AsyncResult.isSuccess(usernameResult) ? usernameResult.value : null
	pullRequestStatusRef.current = pullRequestStatus

	const visibleFilterText = filterMode ? filterDraft : filterQuery
	const visibleGroups = useAtomValue(visibleGroupsAtom)
	const visiblePullRequests = useAtomValue(visiblePullRequestsAtom)
	const selectedPullRequest = useAtomValue(selectedPullRequestAtom)
	const pullRequestComments = useAtomValue(pullRequestCommentsAtom)
	const pullRequestCommentsLoaded = useAtomValue(pullRequestCommentsLoadedAtom)
	const selectedRepository = viewRepository(activeView)
	const activeViews = activePullRequestViews(activeView)
	const currentQueueCacheKey = viewCacheKey(activeView)
	const loadedPullRequestCount = pullRequestLoad?.data.length ?? 0
	const hasMorePullRequests = Boolean(pullRequestLoad?.hasNextPage && loadedPullRequestCount < config.prFetchLimit)
	const isLoadingMorePullRequests = loadingMoreKey === currentQueueCacheKey
	const pullRequestListRows = useMemo(
		() =>
			buildPullRequestListRows({
				groups: visibleGroups,
				status: pullRequestStatus,
				error: pullRequestError,
				filterText: visibleFilterText,
				showFilterBar: filterMode || filterQuery.length > 0,
				loadedCount: loadedPullRequestCount,
				hasMore: hasMorePullRequests,
				isLoadingMore: isLoadingMorePullRequests,
			}),
		[visibleGroups, pullRequestStatus, pullRequestError, visibleFilterText, filterMode, filterQuery, loadedPullRequestCount, hasMorePullRequests, isLoadingMorePullRequests],
	)
	const selectedPullRequestRowIndex = pullRequestListRowIndex(pullRequestListRows, selectedPullRequest?.url ?? null)
	const selectedDiffKey = useAtomValue(selectedDiffKeyAtom)
	// Stabilize the reference so the orderedComments memo only refires when the
	// underlying comment array actually changes (not every App re-render).
	const selectedComments = useMemo(() => (selectedDiffKey ? (pullRequestComments[selectedDiffKey] ?? []) : []), [selectedDiffKey, pullRequestComments])
	const selectedCommentsStatus: DetailCommentsStatus = selectedDiffKey ? (pullRequestCommentsLoaded[selectedDiffKey] ?? "idle") : "idle"
	const selectedDiffState = useAtomValue(selectedDiffStateAtom)
	const effectiveDiffRenderView = contentWidth >= 100 ? diffRenderView : "unified"
	const readyDiffFiles = useMemo(
		() => (selectedDiffState?._tag === "Ready" ? (diffWhitespaceMode === "ignore" ? minimizeWhitespaceDiffFiles(selectedDiffState.files) : selectedDiffState.files) : []),
		[selectedDiffState, diffWhitespaceMode],
	)
	const changedFileResults = useMemo(
		() => (changedFilesModalActive ? filterChangedFiles(readyDiffFiles, changedFilesModal.query) : []),
		[changedFilesModalActive, readyDiffFiles, changedFilesModal.query],
	)
	const displayedDiffState = useMemo(
		() =>
			selectedDiffState?._tag === "Ready" ? PullRequestDiffState.Ready({ patch: readyDiffFiles.map((file) => file.patch).join("\n"), files: readyDiffFiles }) : selectedDiffState,
		[selectedDiffState, readyDiffFiles],
	)
	const stackedDiffFiles = useMemo(
		() => buildStackedDiffFiles(readyDiffFiles, effectiveDiffRenderView, diffWrapMode, contentWidth),
		[readyDiffFiles, effectiveDiffRenderView, diffWrapMode, contentWidth],
	)
	const diffCommentAnchors = useMemo(
		() => (diffFullView ? getStackedDiffCommentAnchors(stackedDiffFiles, effectiveDiffRenderView, diffWrapMode, contentWidth) : []),
		[diffFullView, stackedDiffFiles, effectiveDiffRenderView, diffWrapMode, contentWidth],
	)
	const selectedDiffCommentAnchorIndex = Math.max(0, Math.min(diffCommentAnchorIndex, diffCommentAnchors.length - 1))
	const selectedDiffCommentAnchor = diffCommentAnchors[selectedDiffCommentAnchorIndex] ?? null
	const diffCommentRangeStartAnchor =
		diffCommentRangeStartIndex === null ? null : (diffCommentAnchors[Math.max(0, Math.min(diffCommentRangeStartIndex, diffCommentAnchors.length - 1))] ?? null)
	const selectedDiffCommentRange = useMemo(
		() => diffCommentRangeSelection(diffCommentRangeStartAnchor, selectedDiffCommentAnchor),
		[diffCommentRangeStartAnchor, selectedDiffCommentAnchor],
	)
	const selectedDiffCommentRangeAnchors = useMemo(
		() => (selectedDiffCommentRange ? diffCommentAnchors.filter((anchor) => diffCommentRangeContains(selectedDiffCommentRange, anchor)) : []),
		[diffCommentAnchors, selectedDiffCommentRange],
	)
	const diffCommentRangeActive = selectedDiffCommentRange !== null
	const selectedDiffCommentLabel = selectedDiffCommentRange
		? diffCommentRangeLabel(selectedDiffCommentRange)
		: selectedDiffCommentAnchor
			? diffCommentAnchorLabel(selectedDiffCommentAnchor)
			: null
	const selectedDiffCommentThreadKey = selectedDiffKey && selectedDiffCommentAnchor ? diffCommentThreadMapKey(selectedDiffKey, selectedDiffCommentAnchor) : null
	const selectedDiffCommentThread = selectedDiffCommentThreadKey ? (diffCommentThreads[selectedDiffCommentThreadKey] ?? []) : []
	const diffLineColorContextKey = selectedDiffKey ? `${selectedDiffKey}:${effectiveDiffRenderView}:${diffWrapMode}` : null
	const diffCommentThreadAnchors = useMemo(() => {
		if (!selectedDiffKey) return [] as readonly StackedDiffCommentAnchor[]
		const seen = new Set<string>()
		return diffCommentAnchors.filter((anchor) => {
			const key = diffCommentLocationKey(anchor)
			if (seen.has(key)) return false
			if ((diffCommentThreads[diffCommentThreadMapKey(selectedDiffKey, anchor)]?.length ?? 0) === 0) return false
			seen.add(key)
			return true
		})
	}, [diffCommentAnchors, diffCommentThreads, selectedDiffKey])
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
	const markPullRequestCompleted = (pullRequest: PullRequestItem, state: "closed" | "merged") => {
		setRecentlyCompletedPullRequests((current) => ({
			...current,
			[pullRequest.url]: {
				...pullRequest,
				state,
				autoMergeEnabled: false,
			},
		}))
	}
	const restoreOptimisticPullRequest = (pullRequest: PullRequestItem) => {
		setRecentlyCompletedPullRequests((current) => {
			if (!(pullRequest.url in current)) return current
			const next = { ...current }
			delete next[pullRequest.url]
			return next
		})
		updatePullRequest(pullRequest.url, () => pullRequest)
	}
	const refreshPullRequests = (message?: string, options: { readonly resetTransientState?: boolean } = {}) => {
		refreshGenerationRef.current += 1
		detailHydrationRef.current.clear()
		if (detailPrefetchTimeoutRef.current !== null) clearTimeout(detailPrefetchTimeoutRef.current)
		setLoadingMoreKey(null)
		setPullRequestOverrides({})
		if (options.resetTransientState) {
			setRecentlyCompletedPullRequests({})
			setPullRequestComments({})
			setPullRequestCommentsLoaded({})
		}
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
		setDiffCommentRangeStartIndex(null)
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
		})
			.then((page) => {
				if (generation !== refreshGenerationRef.current) return
				const currentLoad = registry.get(queueLoadCacheAtom)[cacheKey]
				if (!currentLoad) return
				const data = appendPullRequestPage(currentLoad.data, page.items)
				const persistedLoad: PullRequestLoad = {
					...currentLoad,
					data,
					endCursor: page.endCursor,
					hasNextPage: page.hasNextPage && data.length < config.prFetchLimit,
				}
				setQueueLoadCache((current) => {
					if (!current[cacheKey]) return current
					return {
						...current,
						[cacheKey]: persistedLoad,
					}
				})
				const viewer = cacheViewerFor(activeView, username)
				if (viewer) void writeQueueCache({ viewer, load: persistedLoad }).catch(() => {})
			})
			.catch((error) => {
				flashNotice(errorMessage(error))
			})
			.finally(() => {
				setLoadingMoreKey((current) => (current === cacheKey ? null : current))
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
		if (pullRequest.state !== "open") return false
		const detailKey = pullRequestDetailKey(pullRequest)
		const forceRefresh = notifyError && pullRequest.detailLoaded && cachedDetailKeysRef.current.has(detailKey)
		if (pullRequest.detailLoaded && !forceRefresh) return false
		const existing = detailHydrationRef.current.get(detailKey)
		if (existing) {
			if (notifyError) existing.notifyError = true
			return false
		}
		if (!notifyError && detailHydrationRef.current.size >= DETAIL_PREFETCH_CONCURRENCY) return false
		const entry: DetailHydration = { token: Symbol(detailKey), notifyError }
		detailHydrationRef.current.set(detailKey, entry)
		const generation = refreshGenerationRef.current
		if (!pullRequest.detailLoaded) {
			void readCachedPullRequest({ repository: pullRequest.repository, number: pullRequest.number })
				.then((cached) => {
					if (!cached || !cached.detailLoaded || cached.headRefOid !== pullRequest.headRefOid) return
					if (generation !== refreshGenerationRef.current || detailHydrationRef.current.get(detailKey) !== entry) return
					cachedDetailKeysRef.current.add(detailKey)
					applyPullRequestDetail(cached)
				})
				.catch(() => {})
		}
		const atom = pullRequestDetailsAtom(pullRequestDetailAtomKey(pullRequest))
		if (forceRefresh) registry.refresh(atom)
		void Effect.runPromise(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }))
			.then((detail) => {
				if (generation === refreshGenerationRef.current && detailHydrationRef.current.get(detailKey) === entry) {
					cachedDetailKeysRef.current.delete(detailKey)
					applyPullRequestDetail(detail)
					void writeCachedPullRequest(detail).catch(() => {})
				}
			})
			.catch((error) => {
				if (entry.notifyError && generation === refreshGenerationRef.current && detailHydrationRef.current.get(detailKey) === entry) flashNotice(errorMessage(error))
			})
			.finally(() => {
				if (detailHydrationRef.current.get(detailKey) === entry) detailHydrationRef.current.delete(detailKey)
			})
		return true
	}
	const loadPullRequestComments = (pullRequest: PullRequestItem, force = false) => {
		const key = pullRequestDiffKey(pullRequest)
		const previousLoadState = registry.get(pullRequestCommentsLoadedAtom)[key]
		if (!force && previousLoadState) return
		const generation = refreshGenerationRef.current
		setPullRequestCommentsLoaded((current) => ({ ...current, [key]: "loading" }))
		void listPullRequestComments({ repository: pullRequest.repository, number: pullRequest.number })
			.then((items) => {
				if (generation !== refreshGenerationRef.current) return
				setPullRequestComments((current) => ({ ...current, [key]: items }))
				setPullRequestCommentsLoaded((current) => ({ ...current, [key]: "ready" }))
			})
			.catch((error) => {
				if (generation !== refreshGenerationRef.current) return
				setPullRequestCommentsLoaded((current) => {
					if (previousLoadState === "ready") return { ...current, [key]: previousLoadState }
					const next = { ...current }
					delete next[key]
					return next
				})
				flashNotice(errorMessage(error))
			})
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
		} else if (pullRequestStatus === "error" || pullRequestError) {
			flashNotice(pullRequestLoad ? "Refresh failed; showing cached data" : "Refresh failed")
			setRefreshCompletionMessage(null)
			setRefreshStartedAt(null)
		}
	}, [refreshCompletionMessage, refreshStartedAt, pullRequestStatus, pullRequestError, pullRequestLoad?.fetchedAt, pullRequests])

	// Best-effort startup prune: writeQueue prunes after each successful refresh,
	// but a session that only browses cached state (or stays offline) never prunes.
	// Firing once at mount keeps the cache bounded for those sessions.
	useEffect(() => {
		void pruneCache().catch(() => {})
	}, [pruneCache])

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
		setQueueSelection((current) => (current[currentQueueCacheKey] === selectedIndex ? current : { ...current, [currentQueueCacheKey]: selectedIndex }))
	}, [currentQueueCacheKey, selectedIndex])

	useEffect(() => {
		if (filterMode || filterQuery.length > 0 || visiblePullRequests.length === 0) return
		const thresholdIndex = Math.max(0, visiblePullRequests.length - LOAD_MORE_SELECTION_THRESHOLD)
		if (selectedIndex >= thresholdIndex) loadMorePullRequests()
	}, [selectedIndex, visiblePullRequests.length, filterMode, filterQuery, hasMorePullRequests, isLoadingMorePullRequests, currentQueueCacheKey])

	useEffect(() => {
		if (filterMode || filterQuery.length > 0 || visiblePullRequests.length === 0 || detailFullView || diffFullView) return
		if (!hasMorePullRequests || isLoadingMorePullRequests) return
		const checkScroll = () => {
			const scroll = prListScrollRef.current
			if (!scroll || scroll.viewport.height <= 0) return
			const bottom = scroll.scrollTop + scroll.viewport.height
			if (bottom >= scroll.scrollHeight - LOAD_MORE_SCROLL_THRESHOLD) loadMorePullRequests()
		}
		checkScroll()
		const interval = globalThis.setInterval(checkScroll, 120)
		return () => globalThis.clearInterval(interval)
	}, [visiblePullRequests.length, filterMode, filterQuery, detailFullView, diffFullView, hasMorePullRequests, isLoadingMorePullRequests, currentQueueCacheKey])

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
		setDiffPreferredSide(null)
		setDiffCommentRangeStartIndex(null)
		detailPreviewScrollRef.current?.scrollTo({ x: 0, y: 0 })
	}, [selectedIndex])

	useEffect(() => {
		setDiffFileIndex((current) => safeDiffFileIndex(readyDiffFiles, current))
	}, [readyDiffFiles.length])

	useEffect(() => {
		setDiffCommentAnchorIndex((current) => {
			if (diffCommentAnchors.length === 0) return 0
			return Math.max(0, Math.min(current, diffCommentAnchors.length - 1))
		})
		setDiffCommentRangeStartIndex((current) => {
			if (current === null || diffCommentAnchors.length === 0) return null
			return Math.max(0, Math.min(current, diffCommentAnchors.length - 1))
		})
	}, [diffCommentAnchors.length])

	useEffect(() => {
		if (!diffFullView || !selectedDiffCommentAnchor) return
		setDiffFileIndex((current) => (current === selectedDiffCommentAnchor.fileIndex ? current : selectedDiffCommentAnchor.fileIndex))
	}, [diffFullView, selectedDiffCommentAnchor?.fileIndex])

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
		const applyLineColor = (anchor: StackedDiffCommentAnchor, color: DiffLineColorConfig, override = false) => {
			const key = `${effectiveDiffRenderView}:${anchor.side}:${anchor.renderLine}`
			if (appliedKeys.has(key) && !override) return
			appliedKeys.add(key)
			const entry = { anchor, view: effectiveDiffRenderView } satisfies AppliedDiffLineColor
			const diff = diffRenderableRefs.current.get(anchor.fileIndex)
			if (diff) setDiffCommentLineColor(diff, entry, color)
			if (!nextEntries.some((existing) => existing.view === entry.view && existing.anchor.side === anchor.side && existing.anchor.renderLine === anchor.renderLine)) {
				nextEntries.push(entry)
			}
		}

		for (const anchor of diffCommentThreadAnchors) {
			applyLineColor(anchor, diffCommentLineColor(anchor, "thread"))
		}
		if (selectedDiffCommentRangeAnchors.length > 0) {
			for (const anchor of selectedDiffCommentRangeAnchors) {
				applyLineColor(anchor, diffCommentLineColor(anchor, "range"), true)
			}
		}
		if (selectedDiffCommentAnchor) {
			applyLineColor(selectedDiffCommentAnchor, diffCommentLineColor(selectedDiffCommentAnchor, "selected"), true)
			if (suppressNextDiffCommentScrollRef.current) {
				suppressNextDiffCommentScrollRef.current = false
			} else {
				ensureDiffLineVisible(selectedDiffCommentAnchor.renderLine)
			}
		} else {
			suppressNextDiffCommentScrollRef.current = false
		}
		diffCommentLineColorsRef.current = { contextKey: diffLineColorContextKey, entries: nextEntries }
	}, [
		selectedDiffCommentAnchor?.renderLine,
		selectedDiffCommentAnchor?.localRenderLine,
		selectedDiffCommentAnchor?.side,
		selectedDiffCommentAnchor?.fileIndex,
		selectedDiffCommentRangeAnchors,
		diffLineColorContextKey,
		effectiveDiffRenderView,
		diffCommentThreadAnchors,
	])

	// Scroll the selected line into view when the diff view is opened. Previously
	// opentui's `focused` scrollbox did this auto-scroll on mount; with the keymap
	// migration the scrollbox is `focusable={false}` so we have to scroll explicitly.
	useEffect(() => {
		if (!diffFullView) return
		if (!selectedDiffCommentAnchor) return
		ensureDiffLineVisible(selectedDiffCommentAnchor.renderLine)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [diffFullView])
	const isHydratingPullRequestDetails = pullRequestStatus === "ready" && selectedPullRequest?.state === "open" && !selectedPullRequest.detailLoaded
	const isRefreshingPullRequests = pullRequestResult.waiting && pullRequestLoad !== null
	const hasActiveLoadingIndicator =
		pullRequestResult.waiting ||
		isHydratingPullRequestDetails ||
		isLoadingMorePullRequests ||
		selectedCommentsStatus === "loading" ||
		labelModal.loading ||
		closeModal.running ||
		pullRequestStateModal.running ||
		mergeModal.loading ||
		mergeModal.running ||
		submitReviewModal.running ||
		selectedDiffState?._tag === "Loading"
	const loadingIndicator = SPINNER_FRAMES[loadingFrame % SPINNER_FRAMES.length]!

	useEffect(() => {
		if (!hasActiveLoadingIndicator) return
		const interval = globalThis.setInterval(() => {
			setLoadingFrame((current) => current + 1)
		}, SPINNER_INTERVAL_MS)
		return () => globalThis.clearInterval(interval)
	}, [hasActiveLoadingIndicator])

	useEffect(() => {
		if (isInitialLoading) setLoadingFrame(0)
	}, [isInitialLoading])

	useEffect(() => {
		if (startupLoadComplete || pullRequestStatus === "loading") return
		setStartupLoadComplete(true)
	}, [startupLoadComplete, pullRequestStatus])

	useEffect(() => {
		if (pullRequestStatus !== "ready" || !selectedPullRequest) return
		hydratePullRequestDetails(selectedPullRequest, true)
	}, [
		pullRequestStatus,
		selectedPullRequest?.url,
		selectedPullRequest?.headRefOid,
		selectedPullRequest?.state,
		selectedPullRequest?.detailLoaded,
		selectedPullRequest?.repository,
		selectedPullRequest?.number,
	])

	useEffect(() => {
		if (pullRequestStatus !== "ready" || !selectedPullRequest) return
		loadPullRequestComments(selectedPullRequest)
	}, [pullRequestStatus, selectedPullRequest?.url, selectedPullRequest?.headRefOid, selectedPullRequest?.repository, selectedPullRequest?.number])

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
	const halfPage = Math.max(1, Math.floor(wideBodyHeight / 2))

	const loadPullRequestReviewComments = (pullRequest: PullRequestItem, force = false) => {
		const key = pullRequestDiffKey(pullRequest)
		const previousLoadState = registry.get(diffCommentsLoadedAtom)[key]
		if (!force && previousLoadState) return
		setDiffCommentsLoaded((current) => ({ ...current, [key]: "loading" }))
		void listPullRequestReviewComments({ repository: pullRequest.repository, number: pullRequest.number })
			.then((comments) => {
				setDiffCommentsLoaded((current) => ({ ...current, [key]: "ready" }))
				setDiffCommentThreads((current) => {
					const prefix = `${key}:`
					const threads = groupDiffCommentThreads(pullRequest, comments)
					const next: Record<string, readonly PullRequestReviewComment[]> = Object.fromEntries(Object.entries(current).filter(([threadKey]) => !threadKey.startsWith(prefix)))

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
		if (includeComments) loadPullRequestReviewComments(pullRequest, force)
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
		setCommentsViewActive(false)
		setDiffFileIndex(0)
		setDiffScrollTop(0)
		setDiffCommentAnchorIndex(0)
		setDiffPreferredSide(null)
		setDiffCommentRangeStartIndex(null)
		setDiffRenderView(contentWidth >= 100 ? "split" : "unified")
		diffScrollRef.current?.scrollTo({ x: 0, y: 0 })
		loadPullRequestDiff(selectedPullRequest, { includeComments: true })
	}

	const openCommentsView = () => {
		if (!selectedPullRequest) return
		loadPullRequestComments(selectedPullRequest, true)
		setCommentsViewActive(true)
		setDetailFullView(false)
		setDiffFullView(false)
		setCommentsViewSelection(0)
	}

	const closeCommentsView = () => {
		setCommentsViewActive(false)
	}

	// j/k navigates the *visual* (threaded) order, not the raw load order — so
	// the comment under the cursor is the one immediately below the previously
	// highlighted row, regardless of where it lives in the flat array.
	const orderedComments = useMemo(() => orderCommentsForDisplay(selectedComments), [selectedComments])
	const selectedOrderedComment = orderedComments[commentsViewSelection]?.comment ?? null
	const commentsRowCount = commentsViewRowCount(selectedComments.length)
	const moveCommentsSelection = (delta: number) => {
		setCommentsViewSelection((current) => {
			const max = commentsRowCount - 1
			return Math.max(0, Math.min(max, current + delta))
		})
	}

	const setCommentsSelection = (index: number) => {
		const max = commentsRowCount - 1
		setCommentsViewSelection(Math.max(0, Math.min(max, index)))
	}

	const confirmCommentSelection = () => {
		if (commentsViewSelection >= selectedComments.length) {
			openNewIssueCommentModal()
			return
		}
		openReplyToSelectedComment()
	}

	const openSelectedCommentInBrowser = () => {
		const comment = selectedOrderedComment
		if (!comment?.url) return
		void openUrl(comment.url)
			.then(() => flashNotice(`Opened ${comment.url}`))
			.catch((error) => flashNotice(errorMessage(error)))
	}

	const refreshSelectedComments = () => {
		if (!selectedPullRequest) return
		loadPullRequestComments(selectedPullRequest, true)
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
		setDiffScrollTop((current) => (current === scrollTop ? current : scrollTop))
		const nextIndex = Math.max(0, stackedDiffFileIndexAtLine(stackedDiffFiles, scrollTop))
		setDiffFileIndex((current) => (current === nextIndex ? current : nextIndex))
	}

	const scrollDetailPreviewBy = (y: number) => {
		detailPreviewScrollRef.current?.scrollBy({ x: 0, y })
	}
	const scrollDetailPreviewTo = (y: number) => {
		detailPreviewScrollRef.current?.scrollTo({ x: 0, y })
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

	const selectDiffFile = (index: number) => {
		if (readyDiffFiles.length === 0) return
		const nextIndex = safeDiffFileIndex(readyDiffFiles, index)
		setDiffFileIndex(nextIndex)
		setDiffCommentRangeStartIndex(null)
		const targetSide = diffPreferredSide ?? selectedDiffCommentAnchor?.side
		const nextAnchor =
			diffCommentAnchors.find((anchor) => anchor.fileIndex === nextIndex && anchor.side === targetSide) ?? diffCommentAnchors.find((anchor) => anchor.fileIndex === nextIndex)
		if (nextAnchor) setDiffCommentAnchorIndex(diffCommentAnchors.indexOf(nextAnchor))
		scrollToDiffFile(nextIndex)
	}

	const jumpDiffFile = (delta: 1 | -1) => {
		selectDiffFile(diffFileIndex + delta)
	}

	const openChangedFilesModal = () => {
		if (readyDiffFiles.length === 0) return
		setChangedFilesModal({
			query: "",
			selectedIndex: safeDiffFileIndex(readyDiffFiles, diffFileIndex),
		})
	}

	const selectChangedFile = () => {
		const selectedIndex = changedFileResults.length === 0 ? 0 : Math.max(0, Math.min(changedFilesModal.selectedIndex, changedFileResults.length - 1))
		const entry = changedFileResults[selectedIndex]
		if (!entry) return
		closeActiveModal()
		selectDiffFile(entry.index)
	}

	const navigableDiffCommentAnchors = () =>
		diffCommentRangeStartAnchor ? diffCommentAnchors.filter((anchor) => sameDiffCommentTarget(anchor, diffCommentRangeStartAnchor)) : diffCommentAnchors

	const moveDiffCommentAnchor = (delta: number, options: { readonly preserveViewportRow?: boolean } = {}) => {
		const anchors = navigableDiffCommentAnchors()
		if (anchors.length === 0) return
		const currentAnchor = selectedDiffCommentAnchor && anchors.includes(selectedDiffCommentAnchor) ? selectedDiffCommentAnchor : anchors[0]
		const nextAnchor = verticalDiffAnchor(anchors, currentAnchor ?? null, delta, diffPreferredSide)
		if (!nextAnchor) return
		if (options.preserveViewportRow) {
			const scroll = diffScrollRef.current
			if (scroll && currentAnchor) {
				const maxScreenOffset = Math.max(DIFF_STICKY_HEADER_LINES, scroll.viewport.height - 2)
				const screenOffset = Math.max(DIFF_STICKY_HEADER_LINES, Math.min(maxScreenOffset, currentAnchor.renderLine - scroll.scrollTop))
				const maxScrollTop = Math.max(0, scroll.scrollHeight - scroll.viewport.height)
				const nextTop = Math.max(0, Math.min(maxScrollTop, nextAnchor.renderLine - screenOffset))
				suppressNextDiffCommentScrollRef.current = true
				scroll.scrollTo({ x: 0, y: nextTop })
				syncDiffScrollState()
			}
		}
		setDiffCommentAnchorIndex(diffCommentAnchors.indexOf(nextAnchor))
	}

	const moveDiffCommentToBoundary = (boundary: "first" | "last") => {
		const anchors = navigableDiffCommentAnchors()
		const nextAnchor = boundary === "first" ? anchors[0] : anchors[anchors.length - 1]
		if (!nextAnchor) return
		setDiffCommentAnchorIndex(diffCommentAnchors.indexOf(nextAnchor))
		setDiffFileIndex(nextAnchor.fileIndex)
	}

	const alignSelectedDiffCommentAnchor = (position: "top" | "center" | "bottom") => {
		if (!selectedDiffCommentAnchor) return
		const scroll = diffScrollRef.current
		if (!scroll) return
		const viewportHeight = Math.max(1, scroll.viewport.height)
		const offset =
			position === "top"
				? DIFF_STICKY_HEADER_LINES
				: position === "center"
					? Math.max(DIFF_STICKY_HEADER_LINES, Math.floor(viewportHeight / 2))
					: Math.max(DIFF_STICKY_HEADER_LINES, viewportHeight - 2)
		const maxScrollTop = Math.max(0, scroll.scrollHeight - viewportHeight)
		const nextTop = Math.max(0, Math.min(maxScrollTop, selectedDiffCommentAnchor.renderLine - offset))
		scroll.scrollTo({ x: 0, y: nextTop })
		syncDiffScrollState()
	}

	const selectDiffCommentSide = (side: DiffCommentSide) => {
		setDiffPreferredSide(side)
		if (!selectedDiffCommentAnchor) return
		const nextAnchor = diffAnchorOnSide(diffCommentAnchors, selectedDiffCommentAnchor, side)
		if (!nextAnchor) return
		setDiffCommentRangeStartIndex(null)
		setDiffCommentAnchorIndex(diffCommentAnchors.indexOf(nextAnchor))
	}

	const selectDiffCommentLine = (renderLine: number, side: DiffCommentSide | null) => {
		const lineAnchors = diffCommentAnchors.filter((anchor) => anchor.renderLine === renderLine)
		const nextAnchor = (side ? lineAnchors.find((anchor) => anchor.side === side) : undefined) ?? lineAnchors[0]
		if (!nextAnchor) return
		suppressNextDiffCommentScrollRef.current = true
		setDiffPreferredSide(side ?? nextAnchor.side)
		if (diffCommentRangeStartAnchor && !sameDiffCommentTarget(diffCommentRangeStartAnchor, nextAnchor)) {
			setDiffCommentRangeStartIndex(null)
		}
		setDiffCommentAnchorIndex(diffCommentAnchors.indexOf(nextAnchor))
		setDiffFileIndex(nextAnchor.fileIndex)
	}

	const editComment = (transform: (state: CommentEditorValue) => CommentEditorValue) => {
		setCommentModal((current) => {
			const next = transform({ body: current.body, cursor: current.cursor })
			if (next.body === current.body && next.cursor === current.cursor && current.error === null) return current
			return { ...current, body: next.body, cursor: next.cursor, error: null }
		})
	}

	const editSubmitReview = (transform: (state: CommentEditorValue) => CommentEditorValue) => {
		setSubmitReviewModal((current) => {
			const next = transform({ body: current.body, cursor: current.cursor })
			if (next.body === current.body && next.cursor === current.cursor && current.error === null) return current
			return { ...current, body: next.body, cursor: next.cursor, error: null }
		})
	}

	const openSubmitReviewModal = (initialEvent: SubmitPullRequestReviewInput["event"] = "APPROVE") => {
		if (!selectedPullRequest || selectedPullRequest.state !== "open") return
		const selectedIndex = Math.max(
			0,
			submitReviewOptions.findIndex((option) => option.event === initialEvent),
		)
		setSubmitReviewModal({
			repository: selectedPullRequest.repository,
			number: selectedPullRequest.number,
			focus: "action",
			selectedIndex,
			body: "",
			cursor: 0,
			running: false,
			error: null,
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

	const openSelectedDiffComment = () => {
		if (diffCommentRangeActive) {
			openDiffCommentModal()
			return
		}
		if (selectedDiffCommentThread.length > 0) openDiffCommentThreadModal()
		else openDiffCommentModal()
	}

	const toggleDiffCommentRange = () => {
		if (!selectedDiffCommentAnchor) return
		setDiffCommentRangeStartIndex((current) => (current === null ? selectedDiffCommentAnchorIndex : null))
	}

	const moveDiffCommentThread = (delta: 1 | -1) => {
		if (diffCommentThreadAnchors.length === 0) {
			flashNotice("No diff comments")
			return
		}
		const currentIndex = selectedDiffCommentAnchor
			? diffCommentThreadAnchors.findIndex((anchor) => diffCommentLocationKey(anchor) === diffCommentLocationKey(selectedDiffCommentAnchor))
			: -1
		const nextAnchor =
			currentIndex >= 0
				? diffCommentThreadAnchors[(currentIndex + delta + diffCommentThreadAnchors.length) % diffCommentThreadAnchors.length]
				: delta > 0
					? (diffCommentThreadAnchors.find((anchor) => !selectedDiffCommentAnchor || anchor.renderLine > selectedDiffCommentAnchor.renderLine) ?? diffCommentThreadAnchors[0])
					: ([...diffCommentThreadAnchors].reverse().find((anchor) => !selectedDiffCommentAnchor || anchor.renderLine < selectedDiffCommentAnchor.renderLine) ??
						diffCommentThreadAnchors[diffCommentThreadAnchors.length - 1])
		if (!nextAnchor) return
		setDiffCommentRangeStartIndex(null)
		setDiffCommentAnchorIndex(diffCommentAnchors.indexOf(nextAnchor))
		setDiffFileIndex(nextAnchor.fileIndex)
	}

	const submitDiffComment = () => {
		if (!selectedPullRequest || !selectedDiffCommentAnchor) return
		const body = commentModal.body.trim()
		if (body.length === 0) {
			setCommentModal((current) => ({ ...current, error: "Write a comment before saving." }))
			return
		}

		const targetRange = selectedDiffCommentRange
		const target = targetRange?.end ?? selectedDiffCommentAnchor
		const key = pullRequestDiffKey(selectedPullRequest)
		const threadKey = selectedDiffKey ? diffCommentThreadMapKey(selectedDiffKey, target) : null
		const optimisticComment = {
			id: `local:${Date.now()}`,
			path: target.path,
			line: target.line,
			side: target.side,
			author: username ?? "you",
			body,
			createdAt: new Date(),
			url: null,
			inReplyTo: null,
		} satisfies PullRequestReviewComment
		const rangeInput = targetRange && targetRange.start.line !== targetRange.end.line ? { startLine: targetRange.start.line, startSide: targetRange.start.side } : {}
		const input = {
			repository: selectedPullRequest.repository,
			number: selectedPullRequest.number,
			commitId: selectedPullRequest.headRefOid,
			path: target.path,
			line: target.line,
			side: target.side,
			body,
			...rangeInput,
		} satisfies CreatePullRequestCommentInput

		if (threadKey) {
			setDiffCommentThreads((current) => ({
				...current,
				[threadKey]: [...(current[threadKey] ?? []), optimisticComment],
			}))
		}
		setPullRequestComments((current) => ({
			...current,
			[key]: [...(current[key] ?? []), reviewCommentAsPullRequestComment(optimisticComment)],
		}))
		closeActiveModal()
		setDiffCommentRangeStartIndex(null)
		flashNotice(`Commenting on ${target.path}:${target.line}`)
		void createPullRequestComment(input)
			.then((comment) => {
				if (threadKey) {
					setDiffCommentThreads((current) => ({
						...current,
						[threadKey]: (current[threadKey] ?? []).map((existing) => (existing.id === optimisticComment.id ? comment : existing)),
					}))
				}
				setPullRequestComments((current) => ({
					...current,
					[key]: (current[key] ?? []).map((existing) => (existing.id === optimisticComment.id ? reviewCommentAsPullRequestComment(comment) : existing)),
				}))
				flashNotice(`Commented on ${target.path}:${target.line}`)
			})
			.catch((error) => {
				if (threadKey) {
					setDiffCommentThreads((current) => {
						const next = { ...current }
						const comments = (next[threadKey] ?? []).filter((comment) => comment.id !== optimisticComment.id)
						if (comments.length > 0) next[threadKey] = comments
						else delete next[threadKey]
						return next
					})
				}
				setPullRequestComments((current) => ({
					...current,
					[key]: (current[key] ?? []).filter((comment) => comment.id !== optimisticComment.id),
				}))
				flashNotice(errorMessage(error))
			})
	}

	const openNewIssueCommentModal = () => {
		if (!selectedPullRequest) return
		setCommentModal({ ...initialCommentModalState, target: { kind: "issue" } })
	}

	const openReplyToSelectedComment = () => {
		if (!selectedPullRequest) return
		const comment = selectedOrderedComment
		if (!comment) {
			flashNotice("No comment selected")
			return
		}
		if (comment._tag !== "review-comment") {
			// Issue comments don't thread on GitHub; pre-fill a quote so the reply
			// reads as a response in the chronological list.
			const quote = quotedReplyBody(comment.author, comment.body)
			setCommentModal({ ...initialCommentModalState, body: quote, cursor: quote.length, target: { kind: "issue" } })
			return
		}
		// GitHub /comments/{id}/replies wants the *thread root* id; replying via a
		// reply id can return "parent comment not found".
		const rootId = findReviewThreadRootId(selectedComments, comment.id)
		const anchor = `${comment.path}:${comment.line}`
		setCommentModal({ ...initialCommentModalState, target: { kind: "reply", inReplyTo: rootId, anchorLabel: anchor } })
	}

	// Optimistic insert + post + swap-or-revert. Shared by issue and reply.
	const submitOptimisticComment = (input: {
		readonly key: string
		readonly optimistic: PullRequestComment
		readonly postingMessage: string
		readonly successMessage: string
		readonly request: () => Promise<PullRequestComment>
		readonly onOptimistic?: (comment: PullRequestComment) => void
		readonly onCreated?: (optimistic: PullRequestComment, created: PullRequestComment) => void
		readonly onRevert?: (comment: PullRequestComment) => void
	}) => {
		const { key, optimistic, postingMessage, successMessage, request, onOptimistic, onCreated, onRevert } = input
		setPullRequestComments((current) => ({ ...current, [key]: [...(current[key] ?? []), optimistic] }))
		onOptimistic?.(optimistic)
		closeActiveModal()
		flashNotice(postingMessage)
		void request()
			.then((created) => {
				setPullRequestComments((current) => ({ ...current, [key]: (current[key] ?? []).map((entry) => (entry.id === optimistic.id ? created : entry)) }))
				onCreated?.(optimistic, created)
				flashNotice(successMessage)
			})
			.catch((error) => {
				setPullRequestComments((current) => ({ ...current, [key]: (current[key] ?? []).filter((entry) => entry.id !== optimistic.id) }))
				onRevert?.(optimistic)
				flashNotice(errorMessage(error))
			})
	}

	const requireCommentBody = (): string | null => {
		const body = commentModal.body.trim()
		if (body.length === 0) {
			setCommentModal((current) => ({ ...current, error: "Write a comment before saving." }))
			return null
		}
		return body
	}

	const submitIssueComment = () => {
		if (!selectedPullRequest) return
		const body = requireCommentBody()
		if (body === null) return
		const { repository, number } = selectedPullRequest
		submitOptimisticComment({
			key: pullRequestDiffKey(selectedPullRequest),
			optimistic: { _tag: "comment", id: `local:issue:${Date.now()}`, author: username ?? "you", body, createdAt: new Date(), url: null },
			postingMessage: `Posting comment on #${number}`,
			successMessage: `Commented on #${number}`,
			request: () => createPullRequestIssueComment({ repository, number, body }),
		})
	}

	const submitReplyComment = () => {
		if (!selectedPullRequest || commentModal.target.kind !== "reply") return
		const body = requireCommentBody()
		if (body === null) return
		const { repository, number } = selectedPullRequest
		const target = commentModal.target
		const parent = selectedComments.find((entry) => entry._tag === "review-comment" && entry.id === target.inReplyTo)
		const reviewParent = parent?._tag === "review-comment" ? parent : null
		const key = pullRequestDiffKey(selectedPullRequest)
		const threadKey = reviewParent ? diffCommentThreadMapKey(key, reviewParent) : null
		submitOptimisticComment({
			key,
			optimistic: {
				_tag: "review-comment",
				id: `local:reply:${Date.now()}`,
				path: reviewParent?.path ?? "",
				line: reviewParent?.line ?? 0,
				side: reviewParent?.side ?? "RIGHT",
				author: username ?? "you",
				body,
				createdAt: new Date(),
				url: null,
				inReplyTo: target.inReplyTo,
			},
			postingMessage: `Replying on ${target.anchorLabel}`,
			successMessage: `Replied on ${target.anchorLabel}`,
			request: () => replyToReviewComment({ repository, number, inReplyTo: target.inReplyTo, body }),
			onOptimistic: (comment) => {
				if (!threadKey || comment._tag !== "review-comment") return
				setDiffCommentThreads((current) => ({ ...current, [threadKey]: [...(current[threadKey] ?? []), comment] }))
			},
			onCreated: (optimistic, created) => {
				if (!threadKey || created._tag !== "review-comment") return
				setDiffCommentThreads((current) => ({
					...current,
					[threadKey]: (current[threadKey] ?? []).map((comment) => (comment.id === optimistic.id ? created : comment)),
				}))
			},
			onRevert: (comment) => {
				if (!threadKey) return
				setDiffCommentThreads((current) => {
					const next = { ...current }
					const comments = (next[threadKey] ?? []).filter((entry) => entry.id !== comment.id)
					if (comments.length > 0) next[threadKey] = comments
					else delete next[threadKey]
					return next
				})
			},
		})
	}

	// Selected comment must belong to the viewer and have a server id (not the
	// optimistic `local:` prefix) before we offer edit/delete affordances.
	const canEditComment = (comment: PullRequestComment | null): comment is PullRequestComment =>
		comment !== null && username !== null && comment.author === username && !comment.id.startsWith("local:")

	const openEditSelectedComment = () => {
		if (!selectedPullRequest) return
		const comment = selectedOrderedComment
		if (!canEditComment(comment)) {
			flashNotice(comment ? "Can't edit this comment" : "No comment selected")
			return
		}
		const anchorLabel = comment._tag === "review-comment" ? `Editing ${comment.path}:${comment.line}` : `Editing comment on #${selectedPullRequest.number}`
		setCommentModal({
			body: comment.body,
			cursor: comment.body.length,
			error: null,
			target: { kind: "edit", commentId: comment.id, commentTag: comment._tag, anchorLabel },
		})
	}

	const submitEditComment = () => {
		if (!selectedPullRequest || commentModal.target.kind !== "edit") return
		const body = requireCommentBody()
		if (body === null) return
		const target = commentModal.target
		const key = pullRequestDiffKey(selectedPullRequest)
		const previous = (pullRequestComments[key] ?? []).find((entry) => entry.id === target.commentId)
		if (!previous) {
			setCommentModal((current) => ({ ...current, error: "Comment not found in cache." }))
			return
		}
		const repository = selectedPullRequest.repository

		// Optimistically swap the body in both caches; restore the previous on failure.
		const previousReview = previous._tag === "review-comment" ? previous : null
		const threadKey = previousReview ? diffCommentThreadMapKey(key, previousReview) : null
		const replaceInList = <T extends { readonly id: string }>(list: readonly T[], next: T) => list.map((entry) => (entry.id === target.commentId ? next : entry))

		setPullRequestComments((current) => ({ ...current, [key]: replaceInList(current[key] ?? [], { ...previous, body }) }))
		if (threadKey && previousReview) {
			setDiffCommentThreads((current) => ({
				...current,
				[threadKey]: replaceInList(current[threadKey] ?? [], { ...previousReview, body }),
			}))
		}
		closeActiveModal()
		flashNotice("Saving comment edit")

		const request =
			target.commentTag === "comment"
				? () => editPullRequestIssueComment({ repository, commentId: target.commentId, body })
				: () => editReviewComment({ repository, commentId: target.commentId, body })

		void request()
			.then((updated) => {
				setPullRequestComments((current) => ({ ...current, [key]: replaceInList(current[key] ?? [], updated) }))
				if (threadKey && updated._tag === "review-comment") {
					setDiffCommentThreads((current) => ({
						...current,
						[threadKey]: replaceInList(current[threadKey] ?? [], updated),
					}))
				}
				flashNotice("Comment updated")
			})
			.catch((error) => {
				setPullRequestComments((current) => ({ ...current, [key]: replaceInList(current[key] ?? [], previous) }))
				if (threadKey && previousReview) {
					setDiffCommentThreads((current) => ({
						...current,
						[threadKey]: replaceInList(current[threadKey] ?? [], previousReview),
					}))
				}
				flashNotice(errorMessage(error))
			})
	}

	const submitCommentModal = () => {
		switch (commentModal.target.kind) {
			case "diff":
				submitDiffComment()
				return
			case "issue":
				submitIssueComment()
				return
			case "reply":
				submitReplyComment()
				return
			case "edit":
				submitEditComment()
				return
		}
	}

	const openDeleteSelectedComment = () => {
		if (!selectedPullRequest) return
		const comment = selectedOrderedComment
		if (!canEditComment(comment)) {
			flashNotice(comment ? "Can't delete this comment" : "No comment selected")
			return
		}
		const firstLine = comment.body.split("\n").find((line) => line.trim().length > 0) ?? ""
		const preview = firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine
		setDeleteCommentModal({
			commentId: comment.id,
			commentTag: comment._tag,
			author: comment.author,
			preview,
			running: false,
			error: null,
		})
	}

	const confirmDeleteComment = () => {
		if (!selectedPullRequest || deleteCommentModal.running) return
		const target = { commentId: deleteCommentModal.commentId, commentTag: deleteCommentModal.commentTag }
		const key = pullRequestDiffKey(selectedPullRequest)
		const list = pullRequestComments[key] ?? []
		const previousIndex = list.findIndex((entry) => entry.id === target.commentId)
		const previous = previousIndex >= 0 ? list[previousIndex] : undefined
		if (!previous) {
			setDeleteCommentModal((current) => ({ ...current, error: "Comment not found in cache." }))
			return
		}
		const previousReview = previous._tag === "review-comment" ? previous : null
		const threadKey = previousReview ? diffCommentThreadMapKey(key, previousReview) : null
		const previousThread = threadKey ? (diffCommentThreads[threadKey] ?? []) : []
		const previousThreadIndex = previousReview ? previousThread.findIndex((entry) => entry.id === previous.id) : -1
		const repository = selectedPullRequest.repository

		setPullRequestComments((current) => ({
			...current,
			[key]: (current[key] ?? []).filter((entry) => entry.id !== target.commentId),
		}))
		if (threadKey) {
			setDiffCommentThreads((current) => {
				const next = { ...current }
				const filtered = (next[threadKey] ?? []).filter((entry) => entry.id !== target.commentId)
				if (filtered.length > 0) next[threadKey] = filtered
				else delete next[threadKey]
				return next
			})
		}
		closeActiveModal()
		flashNotice("Deleting comment")

		const request =
			target.commentTag === "comment"
				? () => deletePullRequestIssueComment({ repository, commentId: target.commentId })
				: () => deleteReviewComment({ repository, commentId: target.commentId })

		void request()
			.then(() => flashNotice("Comment deleted"))
			.catch((error) => {
				// Splice the previous entry back at its original index in both caches.
				setPullRequestComments((current) => {
					const arr = current[key] ?? []
					if (arr.some((entry) => entry.id === previous.id)) return current
					const restored = [...arr]
					restored.splice(Math.min(previousIndex, restored.length), 0, previous)
					return { ...current, [key]: restored }
				})
				if (threadKey && previousReview) {
					setDiffCommentThreads((current) => {
						const arr = current[threadKey] ?? []
						if (arr.some((entry) => entry.id === previousReview.id)) return current
						const restored = [...arr]
						const insertIndex = previousThreadIndex >= 0 ? previousThreadIndex : restored.length
						restored.splice(Math.min(insertIndex, restored.length), 0, previousReview)
						return { ...current, [threadKey]: restored }
					})
				}
				flashNotice(errorMessage(error))
			})
	}

	const confirmSubmitReview = () => {
		if (!submitReviewModal.repository || submitReviewModal.number === null || submitReviewModal.running) return
		const option = submitReviewOptions[submitReviewModal.selectedIndex]
		if (!option) return
		const repository = submitReviewModal.repository
		const number = submitReviewModal.number
		const body = submitReviewModal.body.trim()
		const targetPullRequest = pullRequests.find((pullRequest) => pullRequest.repository === repository && pullRequest.number === number) ?? null
		const nextReviewStatus = reviewStatusAfterSubmit[option.event]

		setSubmitReviewModal((current) => ({ ...current, running: true, error: null }))
		void submitPullRequestReview({ repository, number, event: option.event, body })
			.then(() => {
				if (targetPullRequest && nextReviewStatus) {
					updatePullRequest(targetPullRequest.url, (pullRequest) => ({ ...pullRequest, reviewStatus: nextReviewStatus }))
				}
				closeActiveModal()
				flashNotice(`Submitted ${option.title.toLowerCase()} review for #${number}`)
			})
			.catch((error) => {
				setSubmitReviewModal((current) => ({ ...current, running: false, error: errorMessage(error) }))
				flashNotice(errorMessage(error))
			})
	}

	const openSelectedPullRequestInBrowser = (pullRequest: PullRequestItem) => {
		void openInBrowser(pullRequest)
			.then(() => flashNotice(`Opened #${pullRequest.number} in browser`))
			.catch((error) => flashNotice(errorMessage(error)))
	}

	const openLinkInBrowser = (url: string) => {
		void openUrl(url)
			.then(() => flashNotice(`Opened ${url}`))
			.catch((error) => flashNotice(errorMessage(error)))
	}

	const copySelectedPullRequestMetadata = () => {
		if (!selectedPullRequest) return
		void copyToClipboard(pullRequestMetadataText(selectedPullRequest))
			.then(() => flashNotice(`Copied #${selectedPullRequest.number} metadata`))
			.catch((error) => flashNotice(errorMessage(error)))
	}

	const openPullRequestStateModal = () => {
		if (!selectedPullRequest || selectedPullRequest.state !== "open") return
		setPullRequestStateModal({
			repository: selectedPullRequest.repository,
			number: selectedPullRequest.number,
			title: selectedPullRequest.title,
			url: selectedPullRequest.url,
			isDraft: selectedPullRequest.reviewStatus === "draft",
			selectedIsDraft: selectedPullRequest.reviewStatus !== "draft",
			running: false,
			error: null,
		})
	}

	const movePullRequestStateSelection = () => {
		setPullRequestStateModal((current) => ({ ...current, selectedIsDraft: !current.selectedIsDraft }))
	}

	const confirmPullRequestStateChange = () => {
		if (!pullRequestStateModal.repository || pullRequestStateModal.number === null || !pullRequestStateModal.url || pullRequestStateModal.running) return
		const { repository, number, url, isDraft, selectedIsDraft } = pullRequestStateModal
		if (selectedIsDraft === isDraft) {
			closeActiveModal()
			return
		}
		const previousPullRequest = pullRequests.find((pullRequest) => pullRequest.url === url) ?? null
		const nextReviewStatus = selectedIsDraft ? "draft" : "review"

		if (previousPullRequest) {
			updatePullRequest(url, (pullRequest) => ({
				...pullRequest,
				reviewStatus: nextReviewStatus,
			}))
		}
		closeActiveModal()
		flashNotice(selectedIsDraft ? `Converted #${number} to draft` : `Marked #${number} ready for review`)
		void toggleDraftStatus({ repository, number, isDraft }).catch((error) => {
			if (previousPullRequest) updatePullRequest(url, () => previousPullRequest)
			const message = errorMessage(error)
			flashNotice(message)
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
				if (previousPullRequest) markPullRequestCompleted(previousPullRequest, "closed")
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
			tone: themeToneForThemeId(themeId),
			initialThemeId: themeId,
		})
	}

	const closeThemeModal = (confirm: boolean) => {
		const selectedTheme = themeDefinitions.find((theme) => theme.id === themeIdRef.current)
		if (!confirm) {
			setActiveTheme(themeModal.initialThemeId)
			themeIdRef.current = themeModal.initialThemeId
			setThemeId(themeModal.initialThemeId)
		} else if (selectedTheme) {
			void Effect.runPromise(saveStoredThemeId(selectedTheme.id)).catch((error) => flashNotice(errorMessage(error)))
			flashNotice(`Theme: ${selectedTheme.name}`)
		}
		closeActiveModal()
	}

	const previewTheme = (id: ThemeId) => {
		if (id === themeIdRef.current) return
		setActiveTheme(id)
		themeIdRef.current = id
		setThemeId(id)
	}

	const toggleDiffWhitespaceMode = () => {
		const next = diffWhitespaceMode === "ignore" ? "show" : "ignore"
		setDiffWhitespaceMode(next)
		void Effect.runPromise(saveStoredDiffWhitespaceMode(next)).catch((error) => flashNotice(errorMessage(error)))
	}

	const moveThemeSelection = (delta: number) => {
		const filteredThemes = filterThemeDefinitions(themeModalRef.current.query, themeModalRef.current.tone)
		if (filteredThemes.length === 0) return
		const currentIndex = Math.max(
			0,
			filteredThemes.findIndex((theme) => theme.id === themeIdRef.current),
		)
		const selectedIndex = wrapIndex(currentIndex + delta, filteredThemes.length)
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
			const firstTheme = filterThemeDefinitions(query, next.tone)[0]
			if (firstTheme) previewTheme(firstTheme.id)
		}
	}

	const toggleThemeTone = () => {
		const current = themeModalRef.current
		const tone: ThemeTone = current.tone === "dark" ? "light" : "dark"
		const next = { ...current, query: "", filterMode: false, tone }
		themeModalRef.current = next
		setThemeModal(next)

		const nextThemeId = pairedThemeId(themeIdRef.current, tone) ?? filterThemeDefinitions("", tone)[0]?.id
		if (nextThemeId) previewTheme(nextThemeId)
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
				setLabelModal((current) => (current.repository === repository ? { ...current, availableLabels: labels, loading: false } : current))
			})
			.catch((error) => {
				setLabelModal((current) => (current.repository === repository ? { ...current, loading: false } : current))
				flashNotice(errorMessage(error))
			})
	}

	const openMergeModal = () => {
		if (!selectedPullRequest) return
		const repository = selectedPullRequest.repository
		const number = selectedPullRequest.number
		const seededInfo = mergeInfoFromPullRequest(selectedPullRequest)

		const cachedAllowedMethods = registry.get(repoMergeMethodsCacheAtom)[repository] ?? null
		const lastUsed = registry.get(lastUsedMergeMethodAtom)[repository]
		const selectedMethod = pickInitialMergeMethod(cachedAllowedMethods, lastUsed)

		setMergeModal({
			repository,
			number,
			selectedIndex: 0,
			loading: true,
			running: false,
			info: seededInfo,
			error: null,
			selectedMethod,
			allowedMethods: cachedAllowedMethods,
			pendingConfirm: null,
		})

		void getPullRequestMergeInfo({ repository, number })
			.then((info) => {
				setMergeModal((current) => (current.repository === repository && current.number === number ? { ...current, loading: false, info, selectedIndex: 0 } : current))
			})
			.catch((error) => {
				setMergeModal((current) => (current.repository === repository && current.number === number ? { ...current, loading: false, error: errorMessage(error) } : current))
			})

		if (!cachedAllowedMethods) {
			void getRepositoryMergeMethods(repository)
				.then((methods) => {
					setRepoMergeMethodsCache((current) => ({ ...current, [repository]: methods }))
					setMergeModal((current) => {
						if (current.repository !== repository || current.number !== number) return current
						const nextSelected = pickInitialMergeMethod(methods, registry.get(lastUsedMergeMethodAtom)[repository])
						return { ...current, allowedMethods: methods, selectedMethod: nextSelected }
					})
				})
				.catch((error) => {
					setMergeModal((current) =>
						current.repository === repository && current.number === number ? { ...current, error: `Unable to load repository merge methods: ${errorMessage(error)}` } : current,
					)
				})
		}
	}

	const executeMergeAction = (
		kindDef: ReturnType<typeof getMergeKindDefinition>,
		method: PullRequestMergeMethod,
		info: NonNullable<typeof mergeModal.info>,
		markReady: boolean,
	) => {
		const { repository, number } = info
		const targetPullRequest = pullRequests.find((pullRequest) => pullRequest.repository === repository && pullRequest.number === number)
		const previousPullRequest = targetPullRequest ?? null

		if (targetPullRequest && markReady) {
			updatePullRequest(targetPullRequest.url, (pullRequest) => (pullRequest.reviewStatus === "draft" ? { ...pullRequest, reviewStatus: "none" } : pullRequest))
		}
		if (targetPullRequest && kindDef.optimisticAutoMergeEnabled !== undefined) {
			updatePullRequest(targetPullRequest.url, (pullRequest) => ({ ...pullRequest, autoMergeEnabled: kindDef.optimisticAutoMergeEnabled! }))
		}
		if (targetPullRequest && kindDef.optimisticState === "merged") markPullRequestCompleted(targetPullRequest, "merged")

		const kind = kindDef.kind
		const action: PullRequestMergeAction = kind === "disable-auto" ? { kind } : { kind, method }
		const pastTense = kindDef.pastTense(method)

		closeActiveModal()
		if (!kindDef.methodAgnostic) {
			setLastUsedMergeMethod((current) => ({ ...current, [repository]: method }))
		}

		let markedReady = false
		const run = async () => {
			if (markReady) {
				await toggleDraftStatus({ repository, number, isDraft: true })
				markedReady = true
			}
			await mergePullRequest({ repository, number, action })
		}

		void run()
			.then(() => {
				if (kindDef.refreshOnSuccess) {
					refreshPullRequests(`${pastTense} #${number}`)
				} else {
					flashNotice(`${pastTense} #${number}`)
				}
			})
			.catch((error) => {
				if (markReady && markedReady) {
					refreshPullRequests(`Merge failed for #${number}`)
				} else if (previousPullRequest) {
					restoreOptimisticPullRequest(previousPullRequest)
				}
				flashNotice(errorMessage(error))
			})
	}

	const confirmMergeAction = () => {
		if (!mergeModal.info || !mergeModal.allowedMethods || mergeModal.loading || mergeModal.running) return

		// Second confirm: enter while pending executes the queued action with mark-ready.
		if (mergeModal.pendingConfirm) {
			const pending = mergeModal.pendingConfirm
			const kindDef = getMergeKindDefinition(pending.kind)
			executeMergeAction(kindDef, pending.method, mergeModal.info, /* markReady = */ true)
			return
		}

		const selectedMethod = mergeModal.selectedMethod
		const kinds = visibleMergeKinds(mergeModal.info, mergeModal.allowedMethods, selectedMethod)
		const kind = kinds[mergeModal.selectedIndex]
		if (!kind) return

		// Draft PR + non-agnostic kind → enter confirm mode rather than merge immediately.
		if (requiresMarkReady(mergeModal.info, kind)) {
			setMergeModal((current) => ({ ...current, pendingConfirm: { kind: kind.kind, method: selectedMethod } }))
			return
		}

		executeMergeAction(kind, selectedMethod, mergeModal.info, /* markReady = */ false)
	}

	const cancelOrCloseMergeModal = () => {
		if (mergeModal.pendingConfirm) {
			setMergeModal((current) => ({ ...current, pendingConfirm: null }))
			return
		}
		closeActiveModal()
	}

	const cycleMergeMethod = (delta: -1 | 1) => {
		setMergeModal((current) => {
			if (current.pendingConfirm) return current
			if (!current.allowedMethods) return current
			const allowed = allowedMergeMethodList(current.allowedMethods)
			if (allowed.length <= 1) return current
			const currentIndex = Math.max(0, allowed.indexOf(current.selectedMethod))
			const nextMethod = allowed[wrapIndex(currentIndex + delta, allowed.length)]!
			return { ...current, selectedMethod: nextMethod, selectedIndex: 0 }
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
		if (submitReviewModalActive) {
			setSubmitReviewModal((current) => {
				const next = insertText({ body: current.body, cursor: current.cursor }, text.replace(/\r\n?/g, "\n"))
				return { ...current, focus: "body", body: next.body, cursor: next.cursor, error: null }
			})
			return true
		}
		if (labelModalActive) {
			setLabelModal((current) => ({ ...current, query: current.query + singleLineText(text), selectedIndex: 0 }))
			return true
		}
		if (changedFilesModalActive) {
			setChangedFilesModal((current) => ({ ...current, query: current.query + singleLineText(text), selectedIndex: 0 }))
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
	}, [
		renderer,
		commandPaletteActive,
		openRepositoryModalActive,
		themeModalActive,
		themeModal.filterMode,
		commentModalActive,
		submitReviewModalActive,
		labelModalActive,
		changedFilesModalActive,
		filterMode,
	])

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
		commentsViewActive,
		hasSelectedComment: selectedCommentsStatus === "ready" && selectedOrderedComment !== null,
		canEditSelectedComment: canEditComment(selectedOrderedComment),
		diffReady: selectedDiffState?._tag === "Ready",
		effectiveDiffRenderView,
		diffWrapMode,
		diffWhitespaceMode,
		readyDiffFileCount: readyDiffFiles.length,
		diffFileIndex,
		diffRangeActive: diffCommentRangeActive,
		selectedDiffCommentAnchorLabel: selectedDiffCommentLabel,
		selectedDiffCommentThreadCount: selectedDiffCommentThread.length,
		hasDiffCommentThreads: diffCommentThreadAnchors.length > 0,
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
				setDiffCommentRangeStartIndex(null)
			},
			openCommentsView,
			closeCommentsView,
			openNewIssueCommentModal,
			openReplyToSelectedComment,
			openEditSelectedComment,
			openDeleteSelectedComment,
			reloadDiff: () => {
				if (!selectedPullRequest) return
				loadPullRequestDiff(selectedPullRequest, { force: true, includeComments: true })
				flashNotice(`Refreshing diff for #${selectedPullRequest.number}`)
			},
			toggleDiffRenderView: () => setDiffRenderView((current) => (current === "unified" ? "split" : "unified")),
			toggleDiffWrapMode: () => setDiffWrapMode((current) => (current === "none" ? "word" : "none")),
			toggleDiffWhitespaceMode,
			openChangedFilesModal,
			jumpDiffFile,
			openSelectedDiffComment,
			toggleDiffCommentRange,
			moveDiffCommentThread,
			openDiffCommentModal,
			openSubmitReviewModal,
			openPullRequestStateModal,
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
	const runCommandByIdRef = useRef(runCommandById)
	runCommandByIdRef.current = runCommandById
	const dynamicPaletteCommands: readonly AppCommand[] = (() => {
		if (!commandPaletteActive) return []
		const repository = parseRepositoryInput(commandPalette.query)
		if (!repository || repository === selectedRepository) return []
		return [
			defineCommand({
				id: `view.repository.dynamic:${repository}`,
				title: `Open ${repository}`,
				scope: "View",
				subtitle: "Switch to this repository",
				run: () => switchViewTo({ _tag: "Repository", repository }),
			}),
		]
	})()
	// Dynamic commands always pin to the top of the palette; they came directly from the
	// user's typed input so they shouldn't be filtered by fuzzy score against themselves.
	const staticPaletteCommands = commandPaletteActive
		? filterCommands(
				appCommands.filter((command) => command.id !== "command.open" && commandEnabled(command)),
				commandPalette.query,
			)
		: []
	const activePaletteScope: CommandScope | null = commentsViewActive ? "Comments" : diffFullView ? "Diff" : detailFullView ? "Pull request" : null
	const commandPaletteCommands = commandPaletteActive
		? [...dynamicPaletteCommands, ...(commandPalette.query.trim().length > 0 ? staticPaletteCommands : sortCommandsByActiveScope(staticPaletteCommands, activePaletteScope))]
		: []
	const selectedCommandIndex = clampCommandIndex(commandPalette.selectedIndex, commandPaletteCommands)
	const selectedCommand = commandPaletteCommands[selectedCommandIndex] ?? null

	// === Helpers used by the keymap layers ===
	const moveMergeSelection = (delta: -1 | 1) =>
		setMergeModal((current) => {
			if (current.pendingConfirm) return current
			const kinds = visibleMergeKinds(current.info, current.allowedMethods, current.selectedMethod)
			const selectedIndex = wrapIndex(current.selectedIndex + delta, kinds.length)
			return selectedIndex === current.selectedIndex ? current : { ...current, selectedIndex }
		})
	const scrollCommentThread = (delta: number) =>
		setCommentThreadModal((current) => ({
			...current,
			scrollOffset: Math.max(0, current.scrollOffset + delta),
		}))
	const moveLabelSelection = (delta: -1 | 1) =>
		setLabelModal((current) => {
			const filtered = filterLabels(labelModal.availableLabels, labelModal.query)
			const selectedIndex = wrapIndex(current.selectedIndex + delta, filtered.length)
			return selectedIndex === current.selectedIndex ? current : { ...current, selectedIndex }
		})
	const moveChangedFileSelection = (delta: -1 | 1) =>
		setChangedFilesModal((current) => {
			const selectedIndex = wrapIndex(current.selectedIndex + delta, changedFileResults.length)
			return selectedIndex === current.selectedIndex ? current : { ...current, selectedIndex }
		})
	const moveSubmitReviewActionSelection = (delta: -1 | 1) =>
		setSubmitReviewModal((current) => {
			const selectedIndex = wrapIndex(current.selectedIndex + delta, submitReviewOptions.length)
			return { ...current, selectedIndex, error: null }
		})
	const moveCommandPaletteSelection = (delta: -1 | 1) =>
		setCommandPalette((current) => {
			const selectedIndex = wrapIndex(current.selectedIndex + delta, commandPaletteCommands.length)
			return selectedIndex === current.selectedIndex ? current : { ...current, selectedIndex }
		})
	const selectCommandPaletteIndex = (index: number) =>
		setCommandPalette((current) => {
			const selectedIndex = clampCommandIndex(index, commandPaletteCommands)
			return selectedIndex === current.selectedIndex ? current : { ...current, selectedIndex }
		})
	const runCommandPaletteCommand = (command: AppCommand) => {
		runCommand(command, { notifyDisabled: true, closePalette: true })
	}
	const scrollDetailFullViewBy = (delta: number) => {
		detailScrollRef.current?.scrollBy({ x: 0, y: delta })
		setDetailScrollOffset((current) => Math.max(0, current + delta))
	}
	const scrollDetailFullViewTo = (y: number) => {
		detailScrollRef.current?.scrollTo({ x: 0, y })
		setDetailScrollOffset(y)
	}
	const moveSelectedToPreviousGroup = () =>
		setSelectedIndex((current) => {
			if (visiblePullRequests.length === 0 || groupStarts.length === 0) return 0
			const currentGroup = getCurrentGroupIndex(current)
			if (currentGroup <= 0) return groupStarts[groupStarts.length - 1]!
			return groupStarts[currentGroup - 1]!
		})
	const moveSelectedToNextGroup = () =>
		setSelectedIndex((current) => {
			if (visiblePullRequests.length === 0 || groupStarts.length === 0) return 0
			const currentGroup = getCurrentGroupIndex(current)
			if (currentGroup >= groupStarts.length - 1) return groupStarts[0]!
			return groupStarts[currentGroup + 1]!
		})
	const stepSelected = (delta: number) =>
		setSelectedIndex((current) => {
			if (visiblePullRequests.length === 0) return 0
			return Math.max(0, Math.min(visiblePullRequests.length - 1, current + delta))
		})
	const stepSelectedDown = (count = 1) => {
		if (visiblePullRequests.length === 0) return
		if (selectedIndex + count >= visiblePullRequests.length && hasMorePullRequests) {
			loadMorePullRequests()
		}
		stepSelected(count)
	}
	const stepSelectedUp = (count = 1) => stepSelected(-count)
	const stepSelectedDownWithLoadMore = () => {
		if (visiblePullRequests.length > 0 && selectedIndex >= visiblePullRequests.length - 1 && hasMorePullRequests) {
			loadMorePullRequests()
			return
		}
		setSelectedIndex((current) => {
			if (visiblePullRequests.length === 0) return 0
			return current >= visiblePullRequests.length - 1 ? 0 : current + 1
		})
	}
	const stepSelectedUpWrap = () =>
		setSelectedIndex((current) => {
			if (visiblePullRequests.length === 0) return 0
			return current <= 0 ? visiblePullRequests.length - 1 : current - 1
		})
	const handleQuitOrClose = () => {
		if (themeModalActive) {
			closeThemeModal(false)
			return
		}
		if (activeModal._tag !== "None") {
			closeActiveModal()
			return
		}
		runCommandById("app.quit")
	}

	// === Build the keymap context ===
	const appCtx: AppCtx = {
		closeModalActive,
		pullRequestStateModalActive,
		mergeModalActive,
		commentThreadModalActive,
		changedFilesModalActive,
		submitReviewModalActive,
		labelModalActive,
		themeModalActive,
		openRepositoryModalActive,
		commentModalActive,
		deleteCommentModalActive,
		commandPaletteActive,
		filterMode,
		diffFullView,
		detailFullView,
		commentsViewActive,
		textInputActive:
			commentModalActive ||
			commandPaletteActive ||
			openRepositoryModalActive ||
			changedFilesModalActive ||
			submitReviewModalActive ||
			labelModalActive ||
			filterMode ||
			(themeModalActive && themeModal.filterMode),
		closeModal: {
			closeModal: closeActiveModal,
			confirmClose: confirmClosePullRequest,
		},
		pullRequestStateModal: {
			closeModal: closeActiveModal,
			confirmStateChange: confirmPullRequestStateChange,
			moveSelection: movePullRequestStateSelection,
		},
		mergeModal: {
			availableActionCount: visibleMergeKinds(mergeModal.info, mergeModal.allowedMethods, mergeModal.selectedMethod).length,
			multipleMethodsAllowed: mergeModal.allowedMethods ? allowedMergeMethodList(mergeModal.allowedMethods).length > 1 : false,
			inConfirmMode: mergeModal.pendingConfirm !== null,
			closeOrBackOut: cancelOrCloseMergeModal,
			confirmMerge: confirmMergeAction,
			cycleMethod: cycleMergeMethod,
			moveSelection: moveMergeSelection,
		},
		commentThreadModal: {
			halfPage,
			closeModal: closeActiveModal,
			openInlineComment: openDiffCommentModal,
			scrollBy: scrollCommentThread,
		},
		changedFilesModal: {
			hasResults: changedFileResults.length > 0,
			closeModal: closeActiveModal,
			selectFile: selectChangedFile,
			moveSelection: moveChangedFileSelection,
		},
		submitReviewModal: {
			summaryFocused: submitReviewModal.focus === "body",
			handleEscape: () => {
				if (submitReviewModal.focus === "body") setSubmitReviewModal((current) => ({ ...current, focus: "action" }))
				else closeActiveModal()
			},
			submit: confirmSubmitReview,
			focusSummary: () => setSubmitReviewModal((current) => ({ ...current, focus: "body", error: null })),
			insertNewline: () => editSubmitReview((state) => insertText(state, "\n")),
			moveActionSelection: moveSubmitReviewActionSelection,
			moveLeft: () => editSubmitReview(editorMoveLeft),
			moveRight: () => editSubmitReview(editorMoveRight),
			moveUp: () => editSubmitReview((state) => moveVertically(state, -1)),
			moveDown: () => editSubmitReview((state) => moveVertically(state, 1)),
			moveLineStart: () => editSubmitReview(moveLineStart),
			moveLineEnd: () => editSubmitReview(moveLineEnd),
			moveWordBackward: () => editSubmitReview(moveWordBackward),
			moveWordForward: () => editSubmitReview(moveWordForward),
			backspace: () => editSubmitReview(editorBackspace),
			deleteForward: () => editSubmitReview(editorDeleteForward),
			deleteWordBackward: () => editSubmitReview(deleteWordBackward),
			deleteWordForward: () => editSubmitReview(deleteWordForward),
			deleteToLineStart: () => editSubmitReview(deleteToLineStart),
			deleteToLineEnd: () => editSubmitReview(deleteToLineEnd),
		},
		labelModal: {
			closeModal: closeActiveModal,
			toggleSelected: toggleLabelAtIndex,
			moveSelection: moveLabelSelection,
		},
		themeModal: {
			filterMode: themeModal.filterMode,
			hasFilteredResults: filterThemeDefinitions(themeModal.query, themeModal.tone).length > 0,
			closeWithoutSaving: () => closeThemeModal(false),
			clearFilter: () => updateThemeQuery("", { filterMode: false }),
			enterFilterMode: () => updateThemeQuery("", { filterMode: true }),
			toggleTone: toggleThemeTone,
			confirmSelection: () => closeThemeModal(true),
			moveSelection: moveThemeSelection,
		},
		openRepositoryModal: {
			closeModal: closeActiveModal,
			openFromInput: openRepositoryFromInput,
		},
		commentModal: {
			closeModal: closeActiveModal,
			submit: submitCommentModal,
			insertNewline: () => editComment((state) => insertText(state, "\n")),
			moveLeft: () => editComment(editorMoveLeft),
			moveRight: () => editComment(editorMoveRight),
			moveUp: () => editComment((state) => moveVertically(state, -1)),
			moveDown: () => editComment((state) => moveVertically(state, 1)),
			moveLineStart: () => editComment(moveLineStart),
			moveLineEnd: () => editComment(moveLineEnd),
			moveWordBackward: () => editComment(moveWordBackward),
			moveWordForward: () => editComment(moveWordForward),
			backspace: () => editComment(editorBackspace),
			deleteForward: () => editComment(editorDeleteForward),
			deleteWordBackward: () => editComment(deleteWordBackward),
			deleteWordForward: () => editComment(deleteWordForward),
			deleteToLineStart: () => editComment(deleteToLineStart),
			deleteToLineEnd: () => editComment(deleteToLineEnd),
		},
		deleteCommentModal: {
			closeModal: closeActiveModal,
			confirmDelete: confirmDeleteComment,
		},
		commandPalette: {
			closeModal: closeActiveModal,
			runSelected: () => {
				if (selectedCommand) runCommandPaletteCommand(selectedCommand)
			},
			moveSelection: moveCommandPaletteSelection,
		},
		filterModeCtx: {
			cancel: () => {
				setFilterDraft(filterQuery)
				setFilterMode(false)
			},
			commit: () => {
				setFilterQuery(filterDraft)
				setFilterMode(false)
			},
		},
		diff: {
			halfPage,
			handleEscape: () => {
				if (diffCommentRangeActive) setDiffCommentRangeStartIndex(null)
				else runCommandById("diff.close")
			},
			openSelectedComment: openSelectedDiffComment,
			toggleRange: () => runCommandById("diff.toggle-range"),
			toggleView: () => runCommandById("diff.toggle-view"),
			toggleWrap: () => runCommandById("diff.toggle-wrap"),
			reload: () => runCommandById("diff.reload"),
			nextThread: () => runCommandById("diff.next-thread"),
			previousThread: () => runCommandById("diff.previous-thread"),
			moveAnchor: moveDiffCommentAnchor,
			moveAnchorToBoundary: moveDiffCommentToBoundary,
			alignAnchor: alignSelectedDiffCommentAnchor,
			selectSide: selectDiffCommentSide,
			openChangedFiles: () => runCommandById("diff.changed-files"),
			openSubmitReview: () => runCommandById("pull.submit-review"),
			nextFile: () => runCommandById("diff.next-file"),
			previousFile: () => runCommandById("diff.previous-file"),
			openInBrowser: () => runCommandById("pull.open-browser"),
		},
		detail: {
			halfPage,
			scrollBy: scrollDetailFullViewBy,
			scrollTo: scrollDetailFullViewTo,
			closeDetail: () => runCommandById("detail.close"),
			openTheme: () => runCommandById("theme.open"),
			openDiff: () => runCommandById("diff.open"),
			openComments: () => runCommandById("comments.open"),
			closePullRequest: () => runCommandById("pull.close"),
			openLabels: () => runCommandById("pull.labels"),
			openMerge: () => runCommandById("pull.merge"),
			toggleDraft: () => runCommandById("pull.toggle-draft"),
			openReview: () => runCommandById("pull.submit-review"),
			refresh: () => runCommandById("pull.refresh"),
			openInBrowser: () => runCommandById("pull.open-browser"),
			copyMetadata: () => runCommandById("pull.copy-metadata"),
		},
		commentsView: {
			halfPage,
			scrollBy: moveCommentsSelection,
			scrollTo: setCommentsSelection,
			visibleCount: commentsRowCount,
			canEditSelected: canEditComment(selectedOrderedComment),
			closeCommentsView,
			openInBrowser: openSelectedCommentInBrowser,
			refresh: refreshSelectedComments,
			newComment: () => runCommandById("comments.new"),
			confirmSelection: confirmCommentSelection,
			editSelected: () => runCommandById("comments.edit"),
			deleteSelected: () => runCommandById("comments.delete"),
		},
		listNav: {
			halfPage,
			visibleCount: visiblePullRequests.length,
			hasFilter: filterQuery.length > 0,
			canScrollDetailPreview: isWideLayout && selectedPullRequest !== null,
			runCommandById: (id) => {
				runCommandById(id)
			},
			switchQueueMode,
			scrollDetailPreviewBy,
			scrollDetailPreviewTo,
			clearFilter: () => {
				runCommandById("filter.clear")
			},
			stepSelected,
			stepSelectedUp,
			stepSelectedDown,
			stepSelectedUpWrap,
			stepSelectedDownWithLoadMore,
			moveSelectedToPreviousGroup,
			moveSelectedToNextGroup,
			setSelected: (index) => setSelectedIndex(index),
		},
		openCommandPalette: () => {
			runCommandById("command.open")
		},
		handleQuitOrClose,
	}

	useKeymap(appKeymap, appCtx, useOpenTuiSubscribe())

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

		// q / ctrl+c quit/close-modal logic now lives in the keymap layer
		// (handleQuitOrClose). This useKeyboard callback only handles raw text
		// input for modals that need character-by-character accumulation.

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

		if (submitReviewModalActive) {
			if (submitReviewModal.focus !== "body") return
			const text = printableKeyText(key)
			if (text) editSubmitReview((state) => insertText(state, text))
			return
		}

		if (changedFilesModalActive) {
			if (isSingleLineInputKey(key)) {
				setChangedFilesModal((current) => {
					const query = editSingleLineInput(current.query, key) ?? current.query
					return query === current.query ? current : { ...current, query, selectedIndex: 0 }
				})
			}
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

		if (filterMode) {
			if (isSingleLineInputKey(key)) {
				setFilterDraft((current) => editSingleLineInput(current, key) ?? current)
			}
		}
	})

	if (isInitialLoading) {
		return (
			<box width={terminalWidth} height={terminalHeight} flexDirection="column" backgroundColor={colors.background}>
				<LoadingLogoPane content={detailPlaceholderContent} width={contentWidth} height={terminalHeight} frame={loadingFrame} />
			</box>
		)
	}

	const fullscreenContentWidth = Math.max(24, contentWidth - 2)
	const fullscreenBodyLines = Math.max(8, terminalHeight - 8)
	const fullscreenDetailHeaderHeight = getDetailHeaderHeight(selectedPullRequest, contentWidth, isWideLayout, selectedComments, selectedCommentsStatus)
	const fullscreenDetailBodyViewportHeight = Math.max(1, wideBodyHeight - fullscreenDetailHeaderHeight)
	const fullscreenDetailBodyHeight = getScrollableDetailBodyHeight(selectedPullRequest, fullscreenContentWidth)
	const fullscreenDetailBodyScrollable = fullscreenDetailBodyHeight > fullscreenDetailBodyViewportHeight
	const wideDetailHeaderHeight = getDetailHeaderHeight(selectedPullRequest, rightPaneWidth, true, selectedComments, selectedCommentsStatus)
	const wideDetailBodyViewportHeight = Math.max(1, wideBodyHeight - wideDetailHeaderHeight)
	const wideDetailBodyHeight = getScrollableDetailBodyHeight(selectedPullRequest, rightContentWidth)
	const wideDetailBodyScrollable = wideDetailBodyHeight > wideDetailBodyViewportHeight
	const narrowDetailsPaneHeight = getDetailsPaneHeight({
		pullRequest: selectedPullRequest,
		contentWidth: fullscreenContentWidth,
		paneWidth: contentWidth,
		comments: selectedComments,
		commentsStatus: selectedCommentsStatus,
	})
	const narrowPullRequestListHeight = Math.max(1, wideBodyHeight - narrowDetailsPaneHeight - 1)
	const widePullRequestListNeedsScroll = pullRequestStatus === "ready" && pullRequestListRows.length > wideBodyHeight
	const narrowPullRequestListNeedsScroll = pullRequestStatus === "ready" && pullRequestListRows.length > narrowPullRequestListHeight
	const detailJunctions = isSelectedPullRequestDetailLoading
		? []
		: getDetailJunctionRows({
				pullRequest: selectedPullRequest,
				paneWidth: rightPaneWidth,
				showChecks: true,
				comments: selectedComments,
				commentsStatus: selectedCommentsStatus,
			})

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
		loadingIndicator,
		onSelectPullRequest: selectPullRequestByUrl,
	} as const
	const widePullRequestList = (
		<box paddingLeft={sectionPadding} paddingRight={0}>
			<PullRequestList key={`wide-${leftContentWidth}`} {...prListProps} contentWidth={leftContentWidth} />
		</box>
	)
	const narrowPullRequestList = (
		<box paddingLeft={sectionPadding} paddingRight={sectionPadding}>
			<PullRequestList key={`narrow-${fullscreenContentWidth}`} {...prListProps} contentWidth={fullscreenContentWidth} />
		</box>
	)

	const longestLabelName = labelModal.availableLabels.reduce((max, label) => Math.max(max, label.name.length), 0)
	const labelModalWidth = Math.min(Math.max(42, longestLabelName + 16), 56, contentWidth - 4)
	const labelModalHeight = Math.min(20, terminalHeight - 4)
	const labelModalLeft = centeredOffset(contentWidth, labelModalWidth)
	const labelModalTop = centeredOffset(terminalHeight, labelModalHeight)
	const longestDiffFileName = changedFilesModalActive ? readyDiffFiles.reduce((max, file) => Math.max(max, file.name.length), 0) : 0
	const changedFilesModalWidth = changedFilesModalActive ? Math.min(Math.max(46, longestDiffFileName + 16), 88, contentWidth - 4) : 46
	const changedFilesModalHeight = Math.min(22, terminalHeight - 4)
	const changedFilesModalLeft = centeredOffset(contentWidth, changedFilesModalWidth)
	const changedFilesModalTop = centeredOffset(terminalHeight, changedFilesModalHeight)
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
	const deleteCommentLayout = sizedModal(46, 68, 12, 12)
	const deleteCommentModalWidth = deleteCommentLayout.width
	const deleteCommentModalHeight = deleteCommentLayout.height
	const deleteCommentModalLeft = deleteCommentLayout.left
	const deleteCommentModalTop = deleteCommentLayout.top
	const pullRequestStateLayout = sizedModal(46, 68, 12, 9)
	const pullRequestStateModalWidth = pullRequestStateLayout.width
	const pullRequestStateModalHeight = pullRequestStateLayout.height
	const pullRequestStateModalLeft = pullRequestStateLayout.left
	const pullRequestStateModalTop = pullRequestStateLayout.top
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
	const submitReviewLayout = sizedModal(54, 84, 8, 18)
	const submitReviewModalWidth = submitReviewLayout.width
	const submitReviewModalHeight = submitReviewLayout.height
	const submitReviewModalLeft = submitReviewLayout.left
	const submitReviewModalTop = submitReviewLayout.top
	const commentAnchorLabel = ((): string => {
		if (commentModalActive) {
			if (commentModal.target.kind === "issue") return selectedPullRequest ? `New comment on #${selectedPullRequest.number}` : "New comment"
			if (commentModal.target.kind === "reply") return `Reply on ${commentModal.target.anchorLabel}`
			if (commentModal.target.kind === "edit") return commentModal.target.anchorLabel
		}
		return selectedDiffCommentAnchor && selectedDiffCommentLabel ? `${selectedDiffCommentAnchor.path} ${selectedDiffCommentLabel}` : "No diff line selected"
	})()
	const mergeLayout = sizedModal(46, 68, 14, 20)
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
			{isWideLayout && !detailFullView && !diffFullView && !commentsViewActive ? (
				<Divider width={contentWidth} junctionAt={dividerJunctionAt} junctionChar="┬" />
			) : (
				<Divider width={contentWidth} />
			)}
			{commentsViewActive && selectedPullRequest ? (
				<CommentsPane
					pullRequest={selectedPullRequest}
					comments={selectedComments}
					orderedComments={orderedComments}
					status={selectedCommentsStatus}
					selectedIndex={commentsViewSelection}
					contentWidth={fullscreenContentWidth}
					paneWidth={contentWidth}
					height={wideBodyHeight}
					loadingIndicator={loadingIndicator}
				/>
			) : diffFullView ? (
				<PullRequestDiffPane
					pullRequest={selectedPullRequest}
					diffState={displayedDiffState}
					stackedFiles={stackedDiffFiles}
					scrollTop={diffScrollTop}
					view={effectiveDiffRenderView}
					whitespaceMode={diffWhitespaceMode}
					wrapMode={diffWrapMode}
					paneWidth={contentWidth}
					height={wideBodyHeight}
					loadingIndicator={loadingIndicator}
					scrollRef={diffScrollRef}
					setDiffRef={setDiffRenderableRef}
					selectedCommentAnchor={selectedDiffCommentAnchor}
					selectedCommentLabel={selectedDiffCommentLabel}
					selectedCommentThread={selectedDiffCommentThread}
					onSelectCommentLine={selectDiffCommentLine}
					themeId={themeId}
				/>
			) : detailFullView && isSelectedPullRequestDetailLoading && selectedPullRequest ? (
				<box flexGrow={1} flexDirection="column">
					<DetailHeader
						pullRequest={selectedPullRequest}
						viewerUsername={username}
						contentWidth={fullscreenContentWidth}
						paneWidth={contentWidth}
						showChecks={isWideLayout}
						comments={selectedComments}
						commentsStatus={selectedCommentsStatus}
					/>
					<Filler rows={Math.max(1, wideBodyHeight - fullscreenDetailHeaderHeight)} prefix="detail-loading-full" />
				</box>
			) : isWideLayout && detailFullView ? (
				<box flexGrow={1} flexDirection="column">
					{selectedPullRequest ? (
						<>
							<DetailHeader
								pullRequest={selectedPullRequest}
								viewerUsername={username}
								contentWidth={fullscreenContentWidth}
								paneWidth={contentWidth}
								showChecks
								comments={selectedComments}
								commentsStatus={selectedCommentsStatus}
							/>
							<scrollbox ref={detailScrollRef} focusable={false} flexGrow={1} verticalScrollbarOptions={{ visible: fullscreenDetailBodyScrollable }}>
								<DetailBody
									pullRequest={selectedPullRequest}
									contentWidth={fullscreenContentWidth}
									bodyLines={fullscreenBodyLines}
									bodyLineLimit={DETAIL_BODY_SCROLL_LIMIT}
									loadingIndicator={loadingIndicator}
									themeId={themeId}
									onLinkOpen={openLinkInBrowser}
								/>
							</scrollbox>
						</>
					) : (
						<DetailsPane
							pullRequest={null}
							viewerUsername={username}
							contentWidth={fullscreenContentWidth}
							paneWidth={contentWidth}
							placeholderContent={detailPlaceholderContent}
							loadingIndicator={loadingIndicator}
							themeId={themeId}
							onLinkOpen={openLinkInBrowser}
						/>
					)}
				</box>
			) : isWideLayout ? (
				<box key="wide-main" flexGrow={1} flexDirection="row">
					<box width={leftPaneWidth} height={wideBodyHeight} flexDirection="column">
						{widePullRequestListNeedsScroll ? (
							<scrollbox ref={prListScrollRef} focusable={false} height={wideBodyHeight} flexGrow={0}>
								{widePullRequestList}
							</scrollbox>
						) : (
							<box height={wideBodyHeight} flexDirection="column">
								{widePullRequestList}
							</box>
						)}
					</box>
					<SeparatorColumn height={wideBodyHeight} junctionRows={detailJunctions} />
					<box width={rightPaneWidth} height={wideBodyHeight} flexDirection="column">
						{isSelectedPullRequestDetailLoading && selectedPullRequest ? (
							<>
								<DetailHeader
									pullRequest={selectedPullRequest}
									viewerUsername={username}
									contentWidth={rightContentWidth}
									paneWidth={rightPaneWidth}
									showChecks
									comments={selectedComments}
									commentsStatus={selectedCommentsStatus}
								/>
								<Filler rows={Math.max(1, wideBodyHeight - wideDetailHeaderHeight)} prefix="detail-loading-preview" />
							</>
						) : selectedPullRequest ? (
							<>
								<DetailHeader
									pullRequest={selectedPullRequest}
									viewerUsername={username}
									contentWidth={rightContentWidth}
									paneWidth={rightPaneWidth}
									showChecks
									comments={selectedComments}
									commentsStatus={selectedCommentsStatus}
								/>
								<scrollbox ref={detailPreviewScrollRef} flexGrow={1} verticalScrollbarOptions={{ visible: wideDetailBodyScrollable }}>
									<DetailBody
										pullRequest={selectedPullRequest}
										contentWidth={rightContentWidth}
										bodyLines={wideDetailLines}
										bodyLineLimit={DETAIL_BODY_SCROLL_LIMIT}
										loadingIndicator={loadingIndicator}
										themeId={themeId}
										onLinkOpen={openLinkInBrowser}
									/>
								</scrollbox>
							</>
						) : (
							<DetailPlaceholder content={detailPlaceholderContent} paneWidth={rightPaneWidth} />
						)}
					</box>
				</box>
			) : detailFullView ? (
				<box flexGrow={1} flexDirection="column">
					{selectedPullRequest ? (
						<>
							<DetailHeader
								pullRequest={selectedPullRequest}
								viewerUsername={username}
								contentWidth={fullscreenContentWidth}
								paneWidth={contentWidth}
								comments={selectedComments}
								commentsStatus={selectedCommentsStatus}
							/>
							<scrollbox ref={detailScrollRef} focusable={false} flexGrow={1} verticalScrollbarOptions={{ visible: fullscreenDetailBodyScrollable }}>
								<DetailBody
									pullRequest={selectedPullRequest}
									contentWidth={fullscreenContentWidth}
									bodyLines={fullscreenBodyLines}
									bodyLineLimit={DETAIL_BODY_SCROLL_LIMIT}
									loadingIndicator={loadingIndicator}
									themeId={themeId}
									onLinkOpen={openLinkInBrowser}
								/>
							</scrollbox>
						</>
					) : (
						<DetailsPane
							pullRequest={null}
							viewerUsername={username}
							contentWidth={fullscreenContentWidth}
							paneWidth={contentWidth}
							placeholderContent={detailPlaceholderContent}
							loadingIndicator={loadingIndicator}
							themeId={themeId}
							onLinkOpen={openLinkInBrowser}
						/>
					)}
				</box>
			) : (
				<box key="narrow-main" height={wideBodyHeight} flexDirection="column">
					<DetailsPane
						pullRequest={selectedPullRequest}
						viewerUsername={username}
						contentWidth={fullscreenContentWidth}
						paneWidth={contentWidth}
						comments={selectedComments}
						commentsStatus={selectedCommentsStatus}
						placeholderContent={detailPlaceholderContent}
						loadingIndicator={loadingIndicator}
						themeId={themeId}
						onLinkOpen={openLinkInBrowser}
					/>
					<Divider width={contentWidth} />
					<box flexGrow={1} flexDirection="column">
						{narrowPullRequestListNeedsScroll ? (
							<scrollbox ref={prListScrollRef} focusable={false} flexGrow={1}>
								{narrowPullRequestList}
							</scrollbox>
						) : (
							<box flexGrow={1} flexDirection="column">
								{narrowPullRequestList}
							</box>
						)}
					</box>
				</box>
			)}

			{isWideLayout && !detailFullView && !diffFullView && !commentsViewActive ? (
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
						diffRangeActive={diffCommentRangeActive}
						commentsViewActive={commentsViewActive}
						commentsViewOnRealComment={commentsViewActive && selectedCommentsStatus === "ready" && selectedOrderedComment !== null}
						commentsViewCanEditSelected={canEditComment(selectedOrderedComment)}
						commentsViewCount={selectedComments.length}
						hasSelection={selectedPullRequest !== null}
						hasError={pullRequestStatus === "error"}
						isLoading={
							pullRequestStatus === "loading" ||
							isRefreshingPullRequests ||
							isHydratingPullRequestDetails ||
							closeModal.running ||
							pullRequestStateModal.running ||
							mergeModal.running ||
							submitReviewModal.running
						}
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
			{pullRequestStateModalActive ? (
				<PullRequestStateModal
					state={pullRequestStateModal}
					modalWidth={pullRequestStateModalWidth}
					modalHeight={pullRequestStateModalHeight}
					offsetLeft={pullRequestStateModalLeft}
					offsetTop={pullRequestStateModalTop}
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
			{deleteCommentModalActive ? (
				<DeleteCommentModal
					state={deleteCommentModal}
					modalWidth={deleteCommentModalWidth}
					modalHeight={deleteCommentModalHeight}
					offsetLeft={deleteCommentModalLeft}
					offsetTop={deleteCommentModalTop}
					loadingIndicator={loadingIndicator}
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
			{changedFilesModalActive ? (
				<ChangedFilesModal
					state={changedFilesModal}
					results={changedFileResults}
					totalCount={readyDiffFiles.length}
					modalWidth={changedFilesModalWidth}
					modalHeight={changedFilesModalHeight}
					offsetLeft={changedFilesModalLeft}
					offsetTop={changedFilesModalTop}
				/>
			) : null}
			{submitReviewModalActive ? (
				<SubmitReviewModal
					state={submitReviewModal}
					modalWidth={submitReviewModalWidth}
					modalHeight={submitReviewModalHeight}
					offsetLeft={submitReviewModalLeft}
					offsetTop={submitReviewModalTop}
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
				<ThemeModal state={themeModal} activeThemeId={themeId} modalWidth={themeModalWidth} modalHeight={themeModalHeight} offsetLeft={themeModalLeft} offsetTop={themeModalTop} />
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
					onSelectCommandIndex={selectCommandPaletteIndex}
					onRunCommand={runCommandPaletteCommand}
				/>
			) : null}
		</box>
	)
}
