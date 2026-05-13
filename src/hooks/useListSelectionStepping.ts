import type { IssueItem, PullRequestItem } from "../domain.js"
import type { WorkspaceSurface } from "../workspaceSurfaces.js"
import type { RepositoryListItem } from "../ui/RepoList.js"

export interface UseListSelectionSteppingInput {
	readonly activeWorkspaceSurface: WorkspaceSurface
	readonly visiblePullRequests: readonly PullRequestItem[]
	readonly issues: readonly IssueItem[]
	readonly repositoryItems: readonly RepositoryListItem[]
	readonly selectedIndex: number
	readonly visibleHasMorePullRequests: boolean
	readonly groupStarts: readonly number[]
	readonly getCurrentGroupIndex: (current: number) => number
	readonly setSelectedIndex: (next: number | ((current: number) => number)) => void
	readonly setSelectedIssueIndex: (next: number | ((current: number) => number)) => void
	readonly setSelectedRepositoryIndex: (next: number | ((current: number) => number)) => void
	readonly loadMorePullRequests: () => boolean | Promise<void> | void
}

export interface ListSelectionStepping {
	readonly stepSelected: (delta: number) => void
	readonly stepSelectedDown: (count?: number) => void
	readonly stepSelectedUp: (count?: number) => void
	readonly stepSelectedDownWithLoadMore: () => void
	readonly stepSelectedUpWrap: () => void
	readonly moveSelectedToPreviousGroup: () => void
	readonly moveSelectedToNextGroup: () => void
}

/**
 * Movement helpers shared across surfaces. Each helper routes to the
 * right list (repo/issue/PR) based on `activeWorkspaceSurface`.
 *
 * `stepSelectedDown` triggers `loadMorePullRequests` when stepping
 * past the tail. `stepSelectedDownWithLoadMore` is the explicit
 * keymap action; it'll fire load-more without wrapping. Up-stepping
 * never wraps — PR/Issue lists are long and load lazily, so wrap-to-
 * bottom would jump past unloaded rows.
 */
export const useListSelectionStepping = ({
	activeWorkspaceSurface,
	visiblePullRequests,
	issues,
	repositoryItems,
	selectedIndex,
	visibleHasMorePullRequests,
	groupStarts,
	getCurrentGroupIndex,
	setSelectedIndex,
	setSelectedIssueIndex,
	setSelectedRepositoryIndex,
	loadMorePullRequests,
}: UseListSelectionSteppingInput): ListSelectionStepping => {
	const moveSelectedToPreviousGroup = () =>
		setSelectedIndex((current) => {
			if (activeWorkspaceSurface !== "pullRequests") return current
			if (visiblePullRequests.length === 0 || groupStarts.length === 0) return 0
			const currentGroup = getCurrentGroupIndex(current)
			if (currentGroup <= 0) return groupStarts[groupStarts.length - 1]!
			return groupStarts[currentGroup - 1]!
		})
	const moveSelectedToNextGroup = () =>
		setSelectedIndex((current) => {
			if (activeWorkspaceSurface !== "pullRequests") return current
			if (visiblePullRequests.length === 0 || groupStarts.length === 0) return 0
			const currentGroup = getCurrentGroupIndex(current)
			if (currentGroup >= groupStarts.length - 1) return groupStarts[0]!
			return groupStarts[currentGroup + 1]!
		})
	const stepSelected = (delta: number) =>
		activeWorkspaceSurface === "repos"
			? setSelectedRepositoryIndex((current) => {
					if (repositoryItems.length === 0) return 0
					return Math.max(0, Math.min(repositoryItems.length - 1, current + delta))
				})
			: activeWorkspaceSurface === "issues"
				? setSelectedIssueIndex((current) => {
						if (issues.length === 0) return 0
						return Math.max(0, Math.min(issues.length - 1, current + delta))
					})
				: setSelectedIndex((current) => {
						if (visiblePullRequests.length === 0) return 0
						return Math.max(0, Math.min(visiblePullRequests.length - 1, current + delta))
					})
	const stepSelectedDown = (count = 1) => {
		if (activeWorkspaceSurface === "repos" || activeWorkspaceSurface === "issues") {
			stepSelected(count)
			return
		}
		if (visiblePullRequests.length === 0) return
		if (selectedIndex + count >= visiblePullRequests.length && visibleHasMorePullRequests) {
			loadMorePullRequests()
		}
		stepSelected(count)
	}
	const stepSelectedUp = (count = 1) => stepSelected(-count)
	const stepSelectedDownWithLoadMore = () => {
		if (activeWorkspaceSurface === "repos") {
			setSelectedRepositoryIndex((current) => {
				if (repositoryItems.length === 0) return 0
				return current >= repositoryItems.length - 1 ? 0 : current + 1
			})
			return
		}
		if (activeWorkspaceSurface === "issues") {
			setSelectedIssueIndex((current) => {
				if (issues.length === 0) return 0
				return current >= issues.length - 1 ? 0 : current + 1
			})
			return
		}
		if (visiblePullRequests.length > 0 && selectedIndex >= visiblePullRequests.length - 1 && visibleHasMorePullRequests) {
			loadMorePullRequests()
			return
		}
		setSelectedIndex((current) => {
			if (visiblePullRequests.length === 0) return 0
			return current >= visiblePullRequests.length - 1 ? 0 : current + 1
		})
	}
	const stepSelectedUpWrap = () =>
		activeWorkspaceSurface === "repos"
			? setSelectedRepositoryIndex((current) => Math.max(0, current - 1))
			: activeWorkspaceSurface === "issues"
				? setSelectedIssueIndex((current) => Math.max(0, current - 1))
				: setSelectedIndex((current) => Math.max(0, current - 1))

	return { stepSelected, stepSelectedDown, stepSelectedUp, stepSelectedDownWithLoadMore, stepSelectedUpWrap, moveSelectedToPreviousGroup, moveSelectedToNextGroup }
}
