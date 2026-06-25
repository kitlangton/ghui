import type { MutableRefObject } from "react"
import type * as Atom from "effect/unstable/reactivity/Atom"
import { useAtomSet } from "@effect/atom-react"
import { devLog } from "../devLog.js"
import type { PullRequestItem } from "../domain.js"
import { type PullRequestView, nextView, viewCacheKey, viewEquals } from "../pullRequestViews.js"
import { issueViewForPullRequestView } from "../viewSync.js"
import { type WorkspaceSurface, nextWorkspaceSurface } from "../workspaceSurfaces.js"
import { queueSelectionAtom } from "../ui/pullRequests/atoms.js"
import { recentRepositoriesAtom, workspaceScopeAtom } from "../workspace/atoms.js"
import type { IssueView } from "../issueViews.js"
import { workspaceScopeForRepository } from "../workspaceScope.js"

interface AtomRegistryShape {
	get<T>(atom: Atom.Atom<T>): T
}

export interface UseWorkspaceNavigationInput {
	readonly registry: AtomRegistryShape
	readonly activeView: PullRequestView
	readonly activeViews: readonly PullRequestView[]
	readonly currentQueueCacheKey: string
	readonly selectedIndex: number
	readonly setSelectedIndex: (next: number) => void
	readonly setSelectedIssueIndex: (next: number) => void
	readonly setQueueSelection: (next: (prev: Partial<Record<string, number>>) => Partial<Record<string, number>>) => void
	readonly setActiveView: (next: PullRequestView) => void
	readonly setActiveIssueView: (next: IssueView) => void
	readonly setDetailFullView: (next: boolean) => void
	readonly setDiffFullView: (next: boolean) => void
	readonly setCommentsViewActive: (next: boolean) => void
	readonly setDiffCommentRangeStartIndex: (next: number | null) => void
	readonly setFilterDraft: (next: string) => void
	readonly setFilterMode: (next: boolean) => void
	readonly setNotice: (next: string | null) => void
	readonly cancelRefreshToast: () => void
	readonly filterQuery: string
	readonly filterMode: boolean
	readonly setRecentlyCompletedPullRequests: (next: Record<string, PullRequestItem>) => void
	readonly setActiveWorkspaceSurface: (next: WorkspaceSurface) => void
	readonly activeWorkspaceSurface: WorkspaceSurface
	readonly workspaceTabSurfaces: readonly WorkspaceSurface[]
	readonly selectedRepository: string | null
	readonly refreshGenerationRef: MutableRefObject<number>
	readonly resetHydration: () => void
	readonly resetLoadingMore: () => void
}

export interface WorkspaceNavigation {
	readonly switchViewTo: (view: PullRequestView) => void
	readonly switchQueueMode: (delta: 1 | -1) => void
	readonly switchWorkspaceSurface: (surface: WorkspaceSurface) => void
	readonly cycleWorkspaceSurface: (delta: 1 | -1) => void
	readonly goUpWorkspaceScope: () => boolean
}

/**
 * Bundles the cross-surface navigation actions that move the user between
 * PR views, queue modes, and workspace surfaces. Repo-specific actions
 * (open / favorite / remove) live in `useRepoSurface`; the `Recents` atom
 * is read directly here because `switchViewTo` needs to update it when
 * navigating into a repository view.
 */
export const useWorkspaceNavigation = (input: UseWorkspaceNavigationInput): WorkspaceNavigation => {
	const {
		registry,
		activeView,
		activeViews,
		currentQueueCacheKey,
		selectedIndex,
		setSelectedIndex,
		setSelectedIssueIndex,
		setQueueSelection,
		setActiveView,
		setActiveIssueView,
		setDetailFullView,
		setDiffFullView,
		setCommentsViewActive,
		setDiffCommentRangeStartIndex,
		setFilterDraft,
		setFilterMode,
		setNotice,
		cancelRefreshToast,
		filterQuery,
		filterMode,
		setRecentlyCompletedPullRequests,
		setActiveWorkspaceSurface,
		activeWorkspaceSurface,
		workspaceTabSurfaces,
		selectedRepository,
		refreshGenerationRef,
		resetHydration,
		resetLoadingMore,
	} = input
	const setRecentRepositories = useAtomSet(recentRepositoriesAtom)
	const setWorkspaceScope = useAtomSet(workspaceScopeAtom)

	const switchViewTo = (view: PullRequestView) => {
		devLog("switchViewTo:enter", { from: activeView, to: view, equal: viewEquals(view, activeView) })
		if (viewEquals(view, activeView)) {
			if (view.repository !== selectedRepository) setWorkspaceScope(workspaceScopeForRepository(view.repository))
			return
		}
		refreshGenerationRef.current += 1
		if (!filterMode && filterQuery.length === 0) setQueueSelection((current) => ({ ...current, [currentQueueCacheKey]: selectedIndex }))
		const issueView = issueViewForPullRequestView(view)
		setActiveView(view)
		setActiveIssueView(issueView)
		setWorkspaceScope(workspaceScopeForRepository(view.repository))
		setSelectedIndex(registry.get(queueSelectionAtom)[viewCacheKey(view)] ?? 0)
		setSelectedIssueIndex(0)
		setRecentlyCompletedPullRequests({})
		resetHydration()
		resetLoadingMore()
		setDetailFullView(false)
		setDiffFullView(false)
		setDiffCommentRangeStartIndex(null)
		setFilterDraft(filterQuery)
		setNotice(null)
		cancelRefreshToast()
		if (view._tag === "Repository") {
			setRecentRepositories((current) => [view.repository, ...current.filter((repository) => repository !== view.repository)].slice(0, 12))
			if (activeWorkspaceSurface === "repos") setActiveWorkspaceSurface("pullRequests")
		} else if (view.repository === null && selectedRepository !== null) {
			setActiveWorkspaceSurface("repos")
		}
	}

	const switchQueueMode = (delta: 1 | -1) => switchViewTo(nextView(activeView, activeViews, delta))

	const switchWorkspaceSurface = (surface: WorkspaceSurface) => {
		if (!workspaceTabSurfaces.includes(surface)) return
		if (surface === activeWorkspaceSurface) return
		setActiveWorkspaceSurface(surface)
		setDetailFullView(false)
		setDiffFullView(false)
		setCommentsViewActive(false)
		setDiffCommentRangeStartIndex(null)
		setFilterMode(false)
		setFilterDraft(filterQuery)
		setNotice(null)
		// Previously this unconditionally synced the issue view to whatever
		// the current PR view projects to — but a tab toggle should not
		// clobber a filter the user explicitly applied to the issue surface
		// (e.g. "author:@me" applied via the filter modal). The PR
		// `switchViewTo` path keeps them in sync when the PR view actually
		// changes; that's enough.
		// The PR-side selection reset is also gone: switching tabs and
		// coming back kept `selectedIndex`/`selectedRepositoryIndex` intact,
		// so symmetric behaviour for issues is to keep `selectedIssueIndex`
		// too. `useClampedIndex` will rein in any stale value if the list
		// shrunk in the meantime.
	}

	const cycleWorkspaceSurface = (delta: 1 | -1) => switchWorkspaceSurface(nextWorkspaceSurface(activeWorkspaceSurface, delta, workspaceTabSurfaces))

	const goUpWorkspaceScope = (): boolean => {
		if (!selectedRepository) return false
		// Route through `switchViewTo` so the activeView atom write propagates
		// cleanly through the same atom-graph path as every other nav action.
		// Earlier attempt to call `setActiveView`/`setActiveIssueView`/
		// `setActiveWorkspaceSurface` directly (to skip PR-scoped side effects
		// when triggered from the Issue surface) left the runtime atom graph
		// in a state where the next `switchViewTo` invocation no longer
		// triggered `pullRequestsAtom`'s body — so reopening any repo from
		// the global Repos hub hung forever on "Loading pull requests...".
		// The trade-off is worth it: a single extra invalidation cycle vs.
		// a complete freeze. See the audit note in
		// `plans/app-shell-deepening.md` for the underlying effect-atom
		// dep-tracking quirk this is dodging.
		switchViewTo({ _tag: "Queue", mode: "authored", repository: null })
		return true
	}

	return {
		switchViewTo,
		switchQueueMode,
		switchWorkspaceSurface,
		cycleWorkspaceSurface,
		goUpWorkspaceScope,
	}
}
