import { devLog } from "../../devLog.js"
import { type IssueView, issueViewEquals } from "../../issueViews.js"
import type { PullRequestView } from "../../pullRequestViews.js"
import type { WorkspaceSurface } from "../../workspaceSurfaces.js"
import { filterOptions } from "../modals/FilterModal.js"
import type { FilterModalState } from "../modals/types.js"

// Duplicated in App.tsx, useMergeFlow, and useThemeModal — small enough to
// not warrant its own module yet.
const wrapIndex = (index: number, length: number) => (length === 0 ? 0 : ((index % length) + length) % length)

export interface UseFilterModalInput {
	readonly activeWorkspaceSurface: WorkspaceSurface
	readonly activeView: PullRequestView
	readonly activeIssueView: IssueView
	readonly selectedRepository: string | null
	readonly filterModal: FilterModalState
	readonly setFilterModal: (next: FilterModalState | ((prev: FilterModalState) => FilterModalState)) => void
	readonly switchViewTo: (view: PullRequestView) => void
	readonly setActiveIssueView: (view: IssueView) => void
	readonly closeActiveModal: () => void
	// Issue-side counterparts to the resets `switchViewTo` performs on the
	// PR side. Without these, applying the issue filter modal leaves stale
	// selection and load-more state behind.
	readonly setSelectedIssueIndex: (next: number) => void
	readonly resetLoadingMoreIssues: () => void
	readonly bumpRefreshGeneration: () => void
}

export interface UseFilterModalResult {
	readonly openFilterModal: () => void
	readonly moveFilterSelection: (delta: -1 | 1) => void
	readonly applySelectedFilter: () => void
}

/**
 * Owns the filter modal lifecycle: opening with the right preset for the
 * surface, cycling the highlight, and committing the choice to whichever view
 * the surface uses (PR view or issue view).
 *
 * The modal's "active filter" is read from the surface's own view — one
 * source of truth — and committed back to the same view on apply. PR and
 * issue surfaces never share state through the filter modal itself.
 */
export const useFilterModal = ({
	activeWorkspaceSurface,
	activeView,
	activeIssueView,
	selectedRepository,
	filterModal,
	setFilterModal,
	switchViewTo,
	setActiveIssueView,
	closeActiveModal,
	setSelectedIssueIndex,
	resetLoadingMoreIssues,
	bumpRefreshGeneration,
}: UseFilterModalInput): UseFilterModalResult => {
	const openFilterModal = () => {
		if (!selectedRepository || (activeWorkspaceSurface !== "pullRequests" && activeWorkspaceSurface !== "issues")) return
		const isMine =
			activeWorkspaceSurface === "pullRequests"
				? activeView._tag === "Queue" && activeView.mode === "authored"
				: activeIssueView._tag === "Queue" && activeIssueView.mode === "authored"
		setFilterModal({
			surface: activeWorkspaceSurface,
			selectedIndex: Math.max(
				0,
				filterOptions.findIndex((option) => option.value === (isMine ? "mine" : "all")),
			),
		})
	}

	const moveFilterSelection = (delta: -1 | 1) => {
		setFilterModal((current) => ({ ...current, selectedIndex: wrapIndex(current.selectedIndex + delta, filterOptions.length) }))
	}

	const applySelectedFilter = () => {
		const option = filterOptions[filterModal.selectedIndex]
		devLog("applySelectedFilter", { option, surface: filterModal.surface, selectedRepository, activeView, activeIssueView })
		if (!option) return
		if (filterModal.surface === "pullRequests" && selectedRepository) {
			switchViewTo(option.value === "mine" ? { _tag: "Queue", mode: "authored", repository: selectedRepository } : { _tag: "Repository", repository: selectedRepository })
		} else if (filterModal.surface === "issues" && selectedRepository) {
			const nextView: IssueView =
				option.value === "mine" ? { _tag: "Queue", mode: "authored", repository: selectedRepository } : { _tag: "Repository", repository: selectedRepository }
			if (!issueViewEquals(nextView, activeIssueView)) {
				// Mirror the resets `switchViewTo` does for PR-side filter
				// changes. Without these, the previous queue's load-more
				// state can land on the new view and stale selection sticks
				// past the visible row count.
				bumpRefreshGeneration()
				setSelectedIssueIndex(0)
				resetLoadingMoreIssues()
			}
			setActiveIssueView(nextView)
		}
		closeActiveModal()
	}

	return { openFilterModal, moveFilterSelection, applySelectedFilter }
}
