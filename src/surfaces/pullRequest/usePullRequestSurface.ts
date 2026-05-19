import { RegistryContext, useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { ScrollBoxRenderable } from "@opentui/core"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { Cause } from "effect"
import { type MutableRefObject, useCallback, useContext, useMemo, useRef } from "react"
import type { LoadStatus, PullRequestItem } from "../../domain.js"
import { errorMessage } from "../../errors.js"
import { type PullRequestView, viewCacheKey } from "../../pullRequestViews.js"
import { type PullRequestLoad } from "../../pullRequestLoad.js"
import { useDetailHydration, type DetailHydrationState } from "../../ui/pullRequests/useDetailHydration.js"
import { useLoadMore } from "../../ui/pullRequests/useLoadMore.js"
import { useRefreshCompletionToast } from "../../ui/pullRequests/useRefreshCompletionToast.js"
import { useFocusReturnRefresh } from "../../hooks/useFocusReturnRefresh.js"
import { usePullRequestRefresh } from "../../hooks/usePullRequestRefresh.js"
import { RetryProgress } from "../../ui/FooterHints.js"
import { pullRequestCommentsAtom, pullRequestCommentsLoadedAtom } from "../../ui/comments/atoms.js"
import { noticeAtom } from "../../ui/notice/atoms.js"
import {
	activeViewAtom,
	activeViewsAtom,
	displayedPullRequestsAtom,
	groupStartsAtom,
	hasMorePullRequestsAtom,
	loadMoreRowSelectedAtom,
	loadedPullRequestCountAtom,
	pullRequestLoadAtom,
	pullRequestOverridesAtom,
	pullRequestsForView,
	pullRequestStatusAtom,
	queueLoadCacheAtom,
	recentlyCompletedPullRequestsAtom,
	retryProgressAtom,
	selectedPullRequestAtom,
	selectedRepositoryAtom,
	visibleGroupsAtom,
	visiblePullRequestsAtom,
} from "../../ui/pullRequests/atoms.js"
import { buildPullRequestListRows, pullRequestListRowIndex, type PullRequestGroups, type PullRequestListRow } from "../../ui/PullRequestList.js"
import { useScrollFollowSelected } from "../../ui/useScrollFollowSelected.js"
import { useScrollPersistence } from "../../ui/useScrollPersistence.js"
import { AUTO_REFRESH_JITTER_MS, FOCUS_RETURN_REFRESH_MIN_MS, FOCUSED_IDLE_REFRESH_MS } from "../../workspace/placeholders.js"
import type { WorkspaceSurface } from "../../workspaceSurfaces.js"

type SetState<T> = (next: T | ((prev: T) => T)) => void

// Structural type for the bits of the OpenTUI renderer that
// `useFocusReturnRefresh` needs — keeps the Surface decoupled from the
// concrete `Renderer` class.
interface RendererFocusEvents {
	on: (event: "focus" | "blur", handler: () => void) => void
	off: (event: "focus" | "blur", handler: () => void) => void
}

export interface UsePullRequestSurfaceInput {
	readonly renderer: RendererFocusEvents
	readonly refreshGenerationRef: MutableRefObject<number>
	readonly username: string | null
	readonly selectedIndex: number
	readonly setSelectedIndex: SetState<number>
	readonly setQueueSelection: SetState<Partial<Record<string, number>>>
	readonly filterMode: boolean
	readonly filterQuery: string
	readonly visibleFilterText: string
	readonly activeWorkspaceSurface: WorkspaceSurface
	readonly detailFullView: boolean
	readonly diffFullView: boolean
	readonly commentsViewActive: boolean
	readonly flashNotice: (message: string) => void
	readonly prListScrollRef: MutableRefObject<ScrollBoxRenderable | null>
	readonly prListScrollPersistedRef: MutableRefObject<number>
}

export interface PullRequestSurfaceShell {
	readonly isFullscreen: boolean
	// Async result + derived status
	readonly pullRequestResult: AsyncResult.AsyncResult<unknown, unknown>
	readonly pullRequestStatus: LoadStatus
	readonly pullRequestError: string | null
	readonly pullRequestFetchInFlight: boolean
	readonly isInitialLoading: (startupLoadComplete: boolean) => boolean
	// View + pagination state
	readonly activeView: PullRequestView
	readonly setActiveView: (next: PullRequestView) => void
	readonly activeViews: readonly PullRequestView[]
	readonly currentQueueCacheKey: string
	readonly pullRequestLoad: PullRequestLoad | null
	readonly setQueueLoadCache: SetState<Partial<Record<string, PullRequestLoad>>>
	readonly hasMorePullRequests: boolean
	readonly loadedPullRequestCount: number
	readonly loadMoreRowSelected: boolean
	readonly visibleHasMorePullRequests: boolean
	readonly loadMoreSlotAvailable: boolean
	// PR list + selection
	readonly pullRequests: readonly PullRequestItem[]
	readonly visiblePullRequests: readonly PullRequestItem[]
	readonly visibleGroups: PullRequestGroups
	readonly groupStarts: readonly number[]
	readonly selectedPullRequest: PullRequestItem | null
	readonly selectedRepository: string | null
	readonly pullRequestActiveFilterLabel: string | null
	readonly pullRequestListRows: readonly PullRequestListRow[]
	readonly selectedPullRequestRowIndex: number | null
	// Atom setters re-exposed for App-shell-level consumers (modals, mutations,
	// workspace navigation). Will dissolve once those consumers read atoms
	// directly via the command registry (step 5).
	readonly setPullRequestOverrides: SetState<Readonly<Record<string, PullRequestItem>>>
	readonly setRecentlyCompletedPullRequests: SetState<Readonly<Record<string, PullRequestItem>>>
	readonly retryProgress: RetryProgress
	// Load-more + refresh subsystems
	readonly loadMorePullRequests: () => boolean
	readonly isLoadingMorePullRequests: boolean
	readonly resetLoadingMore: () => void
	readonly armRefreshToast: (message: string) => void
	readonly cancelRefreshToast: () => void
	readonly refreshPullRequests: (message?: string, options?: { readonly resetTransientState?: boolean }) => void
	readonly detailHydrationState: Record<string, DetailHydrationState>
	readonly resetHydration: () => void
	// Selection helper used by link navigation + comment view jump
	readonly selectPullRequestByUrl: (url: string) => void
}

// PR Surface shell — step 4a. Owns the PR data layer:
//   • PR atom reads (queue, list, status, selection, repository).
//   • `useLoadMore` + `useDetailHydration` + the refresh subsystem
//     (`useFocusReturnRefresh` + `useRefreshCompletionToast` +
//     `usePullRequestRefresh`).
//   • PR list-row build, the row-index lookup that drives the scroll-follow
//     effect, and the scroll persistence wiring for the PR list.
//
// Refs that gate the refresh state machine
// (`lastPullRequestRefreshAtRef`, `pullRequestStatusRef`,
// `refreshPullRequestsRef`, `maybeRefreshPullRequestsRef`) live here because
// they're only read/written by the four refresh hooks above.
//
// The shell exposes its setters (overrides, recently-completed) so App-shell
// can wire them into `useItemMutations` and `useWorkspaceNavigation` during
// the transition. Once commands read atoms directly (step 5) the setters
// stop crossing the boundary.
export const usePullRequestSurface = (input: UsePullRequestSurfaceInput): PullRequestSurfaceShell => {
	const {
		renderer,
		refreshGenerationRef,
		username,
		selectedIndex,
		setSelectedIndex,
		setQueueSelection,
		filterMode,
		filterQuery,
		visibleFilterText,
		activeWorkspaceSurface,
		detailFullView,
		diffFullView,
		commentsViewActive,
		flashNotice,
		prListScrollRef,
		prListScrollPersistedRef,
	} = input
	const registry = useContext(RegistryContext)

	// Refresh refs — Surface-internal; passed to refresh sub-hooks below.
	const lastPullRequestRefreshAtRef = useRef(0)
	const pullRequestStatusRef = useRef<LoadStatus>("loading")
	const refreshPullRequestsRef = useRef<(message?: string, options?: { readonly resetTransientState?: boolean }) => void>(() => {})
	const maybeRefreshPullRequestsRef = useRef<(minimumAgeMs: number) => void>(() => {})

	// PR atom reads.
	// `pullRequestsForView` is a family of runtime atoms keyed by view —
	// each view gets its own atom node. Read the family member for the
	// current `activeView` so the subscription is always against the
	// freshly-keyed atom; view switches simply read a different member
	// rather than invalidating one shared atom.
	const [activeView, setActiveView] = useAtom(activeViewAtom)
	const currentPullRequestsAtom = useMemo(() => pullRequestsForView(activeView), [activeView])
	const pullRequestResult = useAtomValue(currentPullRequestsAtom)
	const refreshPullRequestsAtom = useCallback(() => {
		const atom = pullRequestsForView(activeView)
		if (registry.get(atom).waiting) return
		registry.refresh(atom)
	}, [registry, activeView])
	const setQueueLoadCache = useAtomSet(queueLoadCacheAtom)
	const setPullRequestOverrides = useAtomSet(pullRequestOverridesAtom)
	const setRecentlyCompletedPullRequests = useAtomSet(recentlyCompletedPullRequestsAtom)
	const setPullRequestComments = useAtomSet(pullRequestCommentsAtom)
	const setPullRequestCommentsLoaded = useAtomSet(pullRequestCommentsLoadedAtom)
	const setNotice = useAtomSet(noticeAtom)
	const retryProgress = useAtomValue(retryProgressAtom)

	const pullRequestLoad = useAtomValue(pullRequestLoadAtom)
	const pullRequests = useAtomValue(displayedPullRequestsAtom)
	const pullRequestStatus = useAtomValue(pullRequestStatusAtom)
	const pullRequestFetchInFlight = pullRequestResult.waiting
	const selectedRepository = useAtomValue(selectedRepositoryAtom)
	const pullRequestAuthorFilterActive = selectedRepository !== null && activeView._tag === "Queue" && activeView.mode === "authored"
	const pullRequestActiveFilterLabel = pullRequestAuthorFilterActive ? "author:@me" : null
	const pullRequestError = AsyncResult.isFailure(pullRequestResult) ? errorMessage(Cause.squash(pullRequestResult.cause)) : null

	const visibleGroups = useAtomValue(visibleGroupsAtom)
	const visiblePullRequests = useAtomValue(visiblePullRequestsAtom)
	const selectedPullRequest = useAtomValue(selectedPullRequestAtom)
	const activeViews = useAtomValue(activeViewsAtom)
	const currentQueueCacheKey = viewCacheKey(activeView)
	const loadedPullRequestCount = useAtomValue(loadedPullRequestCountAtom)
	const hasMorePullRequests = useAtomValue(hasMorePullRequestsAtom)
	const loadMoreRowSelected = useAtomValue(loadMoreRowSelectedAtom)
	const groupStarts = useAtomValue(groupStartsAtom)
	const pullRequestListFilterActive = filterMode || filterQuery.length > 0
	const visibleHasMorePullRequests = !pullRequestListFilterActive && hasMorePullRequests

	pullRequestStatusRef.current = pullRequestStatus

	const { loadMorePullRequests, isLoadingMorePullRequests, resetLoadingMore } = useLoadMore({
		activeView,
		currentQueueCacheKey,
		pullRequestLoad,
		hasMorePullRequests,
		username,
		refreshGenerationRef,
		flashNotice,
		setQueueLoadCache,
	})

	const pullRequestListRows = useMemo(
		() =>
			buildPullRequestListRows({
				groups: visibleGroups,
				status: pullRequestStatus,
				error: pullRequestError,
				filterText: visibleFilterText,
				loadedCount: loadedPullRequestCount,
				hasMore: visibleHasMorePullRequests,
				isLoadingMore: isLoadingMorePullRequests,
			}),
		[visibleGroups, pullRequestStatus, pullRequestError, visibleFilterText, loadedPullRequestCount, visibleHasMorePullRequests, isLoadingMorePullRequests],
	)
	const selectedPullRequestRowIndex = pullRequestListRowIndex(pullRequestListRows, selectedPullRequest?.url ?? null, loadMoreRowSelected)

	const { detailHydrationState, resetHydration } = useDetailHydration({
		selectedPullRequest,
		pullRequestStatus,
		visiblePullRequests,
		selectedIndex,
		currentQueueCacheKey,
		refreshGenerationRef,
		queueFetchedAtMs: pullRequestLoad?.fetchedAt?.getTime() ?? null,
		flashNotice,
		setQueueLoadCache,
	})

	const { terminalFocusedRef } = useFocusReturnRefresh({
		renderer,
		lastRefreshAtRef: lastPullRequestRefreshAtRef,
		refreshGeneration: pullRequestLoad?.fetchedAt?.getTime(),
		focusReturnMinMs: FOCUS_RETURN_REFRESH_MIN_MS,
		idleAfterMs: FOCUSED_IDLE_REFRESH_MS,
		jitterMs: AUTO_REFRESH_JITTER_MS,
		// Skip the focus-return refresh while a load-more is in flight. A
		// concurrent queue refetch would otherwise clobber the pagination
		// merge (the cache write order isn't deterministic), reverting a
		// freshly-loaded next page.
		onRefresh: (ms) => {
			if (isLoadingMorePullRequests) return
			maybeRefreshPullRequestsRef.current(ms)
		},
	})

	const { armRefreshToast, cancelRefreshToast } = useRefreshCompletionToast({
		pullRequestStatus,
		pullRequestError,
		fetchedAt: pullRequestLoad?.fetchedAt?.getTime(),
		pullRequestLoad,
		selectedPullRequest,
		lastPullRequestRefreshAtRef,
		flashNotice,
	})

	const { refreshPullRequests } = usePullRequestRefresh({
		pullRequestLoad,
		pullRequestFetchInFlight,
		refreshGenerationRef,
		lastPullRequestRefreshAtRef,
		pullRequestStatusRef,
		terminalFocusedRef,
		maybeRefreshPullRequestsRef,
		refreshPullRequestsRef,
		resetHydration,
		resetLoadingMore,
		setPullRequestOverrides,
		setRecentlyCompletedPullRequests,
		setPullRequestComments,
		setPullRequestCommentsLoaded,
		setNotice,
		armRefreshToast,
		refreshPullRequestsAtom,
	})

	useScrollFollowSelected(prListScrollRef, selectedPullRequestRowIndex)
	useScrollPersistence(prListScrollRef, prListScrollPersistedRef, activeWorkspaceSurface === "pullRequests" && !detailFullView && !diffFullView && !commentsViewActive)

	const loadMoreSlotAvailable = visibleHasMorePullRequests && visiblePullRequests.length > 0

	const selectPullRequestByUrl = (url: string) => {
		const index = visiblePullRequests.findIndex((pullRequest) => pullRequest.url === url)
		if (index >= 0) {
			setSelectedIndex(index)
			setQueueSelection((current) => ({ ...current, [currentQueueCacheKey]: index }))
		}
	}

	// `isFullscreen` is provisionally `false` for the PR Surface here — the
	// detail/diff/comments full-view booleans still live in App-shell during
	// the transition. After step 4c (diff system collapse) and step 5
	// (atom-driven commands), this should derive from PR-Surface-owned
	// view-mode atoms.
	const isFullscreen = false

	return {
		isFullscreen,
		pullRequestResult,
		pullRequestStatus,
		pullRequestError,
		pullRequestFetchInFlight,
		isInitialLoading: (startupLoadComplete: boolean) => !startupLoadComplete && pullRequestStatus === "loading" && pullRequests.length === 0,
		activeView,
		setActiveView,
		activeViews,
		currentQueueCacheKey,
		pullRequestLoad,
		setQueueLoadCache,
		hasMorePullRequests,
		loadedPullRequestCount,
		loadMoreRowSelected,
		visibleHasMorePullRequests,
		loadMoreSlotAvailable,
		pullRequests,
		visiblePullRequests,
		visibleGroups,
		groupStarts,
		selectedPullRequest,
		selectedRepository,
		pullRequestActiveFilterLabel,
		pullRequestListRows,
		selectedPullRequestRowIndex,
		setPullRequestOverrides,
		setRecentlyCompletedPullRequests,
		retryProgress,
		loadMorePullRequests,
		isLoadingMorePullRequests,
		resetLoadingMore,
		armRefreshToast,
		cancelRefreshToast,
		refreshPullRequests,
		detailHydrationState,
		resetHydration,
		selectPullRequestByUrl,
	}
}
