import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { ScrollBoxRenderable } from "@opentui/core"
import { Cause } from "effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type { MutableRefObject } from "react"
import type { IssueItem, LoadStatus } from "../../domain.js"
import { errorMessage } from "../../errors.js"
import type { IssueView } from "../../issueViews.js"
import { issueViewCacheKey } from "../../issueViews.js"
import type { IssueLoad } from "../../issueLoad.js"
import { useIssuesLoadMore } from "../../hooks/useIssuesLoadMore.js"
import {
	activeIssueViewAtom,
	allIssuesAtom,
	hasMoreIssuesAtom,
	issueListAtom,
	issueLoadMoreSlotAvailableAtom,
	issueFetchInFlightAtom,
	issueOverridesAtom,
	issueQueueLoadCacheAtom,
	issuesAtom,
	issueViewRepository,
	loadMoreIssueRowSelectedAtom,
	loadedIssueCountAtom,
	resolveIssueLoad,
	selectedIssueAtom,
	showIssueRepositoryGroupsAtom,
} from "../../ui/issues/atoms.js"
import { useMemo } from "react"
import { issueListRowIndex } from "../../ui/IssueList.js"
import { selectedIssueIndexAtom } from "../../ui/listSelection/atoms.js"
import { useClampedIndex } from "../../ui/useClampedIndex.js"
import { useScrollFollowSelected } from "../../ui/useScrollFollowSelected.js"
import { useScrollPersistence } from "../../ui/useScrollPersistence.js"
import type { WorkspaceSurface } from "../../workspaceSurfaces.js"

type SetState<T> = (next: T | ((prev: T) => T)) => void

export interface UseIssueSurfaceInput {
	readonly username: string | null
	readonly activeWorkspaceSurface: WorkspaceSurface
	readonly detailFullView: boolean
	readonly diffFullView: boolean
	readonly commentsViewActive: boolean
	readonly refreshGenerationRef: MutableRefObject<number>
	readonly flashNotice: (message: string) => void
	readonly issueListScrollRef: MutableRefObject<ScrollBoxRenderable | null>
	readonly issueListScrollPersistedRef: MutableRefObject<number>
}

export interface IssueSurfaceShell {
	readonly isFullscreen: boolean
	readonly issues: readonly IssueItem[]
	readonly allIssues: readonly IssueItem[]
	readonly issueLoad: IssueLoad | null
	readonly issuesStatus: LoadStatus
	readonly issuesError: string | null
	readonly selectedIssue: IssueItem | null
	readonly selectedIssueRowIndex: number | null
	readonly selectedIssueIndex: number
	readonly setSelectedIssueIndex: SetState<number>
	readonly activeIssueView: IssueView
	readonly setActiveIssueView: SetState<IssueView>
	readonly hasMoreIssues: boolean
	readonly loadedIssueCount: number
	readonly loadMoreIssueRowSelected: boolean
	readonly issueLoadMoreSlotAvailable: boolean
	readonly issueFetchInFlight: boolean
	readonly setIssueQueueLoadCache: SetState<Partial<Record<string, IssueLoad>>>
	readonly currentIssueCacheKey: string
	readonly issueAuthorFilterActive: boolean
	readonly issueActiveFilterLabel: string | null
	readonly setIssueOverrides: SetState<Readonly<Record<string, IssueItem>>>
	readonly selectedIssueRepository: string | null
	readonly showIssueRepositoryGroups: boolean
	readonly loadMoreIssues: () => boolean
	readonly isLoadingMoreIssues: boolean
	readonly resetLoadingMoreIssues: () => void
}

// Issue Surface shell. Owns the issue list derivation (raw → overrides →
// filter), pagination state, selection/scroll bookkeeping, and view-mode
// filter labels. The detail/diff/comments full-view booleans live in the
// App-shell today; the surface only consumes them to gate scroll
// persistence. Fullscreen modes (detail, comments) will migrate into the
// Item-Surface shell when the PR Surface lands and we collapse shared
// view-mode state.
export const useIssueSurface = (input: UseIssueSurfaceInput): IssueSurfaceShell => {
	const { username, activeWorkspaceSurface, detailFullView, diffFullView, commentsViewActive, refreshGenerationRef, flashNotice, issueListScrollRef, issueListScrollPersistedRef } =
		input

	const [activeIssueView, setActiveIssueView] = useAtom(activeIssueViewAtom)
	const issuesResult = useAtomValue(issuesAtom)
	const issueQueueLoadCache = useAtomValue(issueQueueLoadCacheAtom)
	const hasMoreIssues = useAtomValue(hasMoreIssuesAtom)
	const loadedIssueCount = useAtomValue(loadedIssueCountAtom)
	const setIssueQueueLoadCache = useAtomSet(issueQueueLoadCacheAtom)
	const [selectedIssueIndex, setSelectedIssueIndex] = useAtom(selectedIssueIndexAtom)
	const setIssueOverrides = useAtomSet(issueOverridesAtom)
	const allIssues = useAtomValue(allIssuesAtom)
	const issues = useAtomValue(issueListAtom)
	const selectedIssue = useAtomValue(selectedIssueAtom)
	const loadMoreIssueRowSelected = useAtomValue(loadMoreIssueRowSelectedAtom)
	const issueLoadMoreSlotAvailable = useAtomValue(issueLoadMoreSlotAvailableAtom)
	const issueFetchInFlight = useAtomValue(issueFetchInFlightAtom)
	const showIssueRepositoryGroups = useAtomValue(showIssueRepositoryGroupsAtom)

	const issueLoad = useMemo(() => resolveIssueLoad(activeIssueView, issueQueueLoadCache, issuesResult), [activeIssueView, issueQueueLoadCache, issuesResult])

	const selectedIssueRepository = issueViewRepository(activeIssueView)
	const issueAuthorFilterActive = selectedIssueRepository !== null && activeIssueView._tag === "Queue" && activeIssueView.mode === "authored"
	const issueActiveFilterLabel = issueAuthorFilterActive ? "author:@me" : null
	const rawIssues: readonly IssueItem[] = issueLoad?.data ?? []
	const issuesStatus: LoadStatus = issuesResult.waiting && rawIssues.length === 0 ? "loading" : AsyncResult.isFailure(issuesResult) && rawIssues.length === 0 ? "error" : "ready"
	const issuesError = AsyncResult.isFailure(issuesResult) ? errorMessage(Cause.squash(issuesResult.cause)) : null
	const selectedIssueRowIndex = issueListRowIndex(issues, selectedIssueIndex, showIssueRepositoryGroups, loadMoreIssueRowSelected)

	const currentIssueCacheKey = issueViewCacheKey(activeIssueView)
	const { loadMoreIssues, isLoadingMoreIssues, resetLoadingMoreIssues } = useIssuesLoadMore({
		activeIssueView,
		currentIssueCacheKey,
		issueLoad,
		hasMoreIssues,
		issueFetchInFlight,
		username,
		refreshGenerationRef,
		flashNotice,
		setIssueQueueLoadCache,
	})

	useClampedIndex(issues.length + (issueLoadMoreSlotAvailable ? 1 : 0), setSelectedIssueIndex)
	useScrollFollowSelected(issueListScrollRef, issues.length === 0 ? null : selectedIssueRowIndex)
	useScrollPersistence(issueListScrollRef, issueListScrollPersistedRef, activeWorkspaceSurface === "issues" && !detailFullView && !diffFullView && !commentsViewActive)

	return {
		// The Issue Surface itself is never the source of fullscreen modes
		// today; detail/diff/comments live in the App-shell. Once Item-Surface
		// view modes migrate down, this will start returning a real value.
		isFullscreen: false,
		issues,
		allIssues,
		issueLoad,
		issuesStatus,
		issuesError,
		selectedIssue,
		selectedIssueRowIndex,
		selectedIssueIndex,
		setSelectedIssueIndex,
		activeIssueView,
		setActiveIssueView,
		hasMoreIssues,
		loadedIssueCount,
		loadMoreIssueRowSelected,
		issueLoadMoreSlotAvailable,
		issueFetchInFlight,
		setIssueQueueLoadCache,
		currentIssueCacheKey,
		issueAuthorFilterActive,
		issueActiveFilterLabel,
		setIssueOverrides,
		selectedIssueRepository,
		showIssueRepositoryGroups,
		loadMoreIssues,
		isLoadingMoreIssues,
		resetLoadingMoreIssues,
	}
}
