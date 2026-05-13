import type { MutableRefObject } from "react"
import type * as Atom from "effect/unstable/reactivity/Atom"
import type { PullRequestItem } from "../domain.js"
import { type PullRequestView, nextView, viewCacheKey, viewEquals } from "../pullRequestViews.js"
import { issueViewForPullRequestView } from "../viewSync.js"
import type { RepositoryListItem } from "../ui/RepoList.js"
import { type WorkspaceSurface, nextWorkspaceSurface } from "../workspaceSurfaces.js"
import { queueSelectionAtom } from "../ui/pullRequests/atoms.js"
import type { IssueView } from "../issueViews.js"

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
	readonly setRecentlyCompletedPullRequests: (next: Record<string, PullRequestItem>) => void
	readonly setRecentRepositories: (next: (prev: readonly string[]) => readonly string[]) => void
	readonly setFavoriteRepositories: (next: (prev: Readonly<Record<string, true>>) => Readonly<Record<string, true>>) => void
	readonly setActiveWorkspaceSurface: (next: WorkspaceSurface) => void
	readonly activeWorkspaceSurface: WorkspaceSurface
	readonly workspaceTabSurfaces: readonly WorkspaceSurface[]
	readonly selectedRepository: string | null
	readonly selectedRepositoryItem: RepositoryListItem | null
	readonly detectedRepository: string | null
	readonly refreshGenerationRef: MutableRefObject<number>
	readonly resetHydration: () => void
	readonly resetLoadingMore: () => void
	readonly flashNotice: (msg: string) => void
}

export interface WorkspaceNavigation {
	readonly switchViewTo: (view: PullRequestView) => void
	readonly switchQueueMode: (delta: 1 | -1) => void
	readonly switchWorkspaceSurface: (surface: WorkspaceSurface) => void
	readonly cycleWorkspaceSurface: (delta: 1 | -1) => void
	readonly goUpWorkspaceScope: () => boolean
	readonly openSelectedRepository: () => void
	readonly toggleFavoriteRepository: () => void
	readonly removeSelectedRepository: () => void
}

/**
 * Bundles the navigation actions that move the user between PR views,
 * surfaces, and repos. Each action coordinates many cooperating atoms
 * (selection, filter, recently-completed, scope mirror, etc.) — keeping
 * them together is what makes the contract maintainable.
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
		setRecentlyCompletedPullRequests,
		setRecentRepositories,
		setFavoriteRepositories,
		setActiveWorkspaceSurface,
		activeWorkspaceSurface,
		workspaceTabSurfaces,
		selectedRepository,
		selectedRepositoryItem,
		detectedRepository,
		refreshGenerationRef,
		resetHydration,
		resetLoadingMore,
		flashNotice,
	} = input

	const switchViewTo = (view: PullRequestView) => {
		if (viewEquals(view, activeView)) return
		refreshGenerationRef.current += 1
		setQueueSelection((current) => ({ ...current, [currentQueueCacheKey]: selectedIndex }))
		setActiveView(view)
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
		setActiveIssueView(issueViewForPullRequestView(view))
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
		setSelectedIssueIndex(0)
		setDetailFullView(false)
		setDiffFullView(false)
		setCommentsViewActive(false)
		setDiffCommentRangeStartIndex(null)
		setFilterMode(false)
		setFilterDraft(filterQuery)
		setNotice(null)
		setActiveIssueView(issueViewForPullRequestView(activeView))
	}

	const cycleWorkspaceSurface = (delta: 1 | -1) => switchWorkspaceSurface(nextWorkspaceSurface(activeWorkspaceSurface, delta, workspaceTabSurfaces))

	const goUpWorkspaceScope = (): boolean => {
		if (!selectedRepository) return false
		switchViewTo({ _tag: "Queue", mode: "authored", repository: null })
		return true
	}

	const openSelectedRepository = () => {
		if (!selectedRepositoryItem) return
		switchViewTo({ _tag: "Repository", repository: selectedRepositoryItem.repository })
	}

	const toggleFavoriteRepository = () => {
		if (!selectedRepositoryItem) return
		const repository = selectedRepositoryItem.repository
		setFavoriteRepositories((current) => {
			if (current[repository]) {
				const next = { ...current }
				delete next[repository]
				return next
			}
			return { ...current, [repository]: true }
		})
	}

	const removeSelectedRepository = () => {
		if (!selectedRepositoryItem) return
		const repository = selectedRepositoryItem.repository
		setFavoriteRepositories((current) => {
			if (!current[repository]) return current
			const next = { ...current }
			delete next[repository]
			return next
		})
		setRecentRepositories((current) => current.filter((item) => item !== repository))
		flashNotice(repository === detectedRepository ? `Removed saved state for ${repository}; current repo stays pinned` : `Removed ${repository} from tracked repositories`)
	}

	return {
		switchViewTo,
		switchQueueMode,
		switchWorkspaceSurface,
		cycleWorkspaceSurface,
		goUpWorkspaceScope,
		openSelectedRepository,
		toggleFavoriteRepository,
		removeSelectedRepository,
	}
}
