import { useMemo } from "react"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { Cause } from "effect"
import type { IssueItem, LoadStatus } from "../domain.js"
import { errorMessage } from "../errors.js"
import { issueListRowIndex, orderIssuesForDisplay } from "../ui/IssueList.js"
import { filterByScore, issueFilterScore } from "../ui/filter/scoring.js"

type IssuesResult = AsyncResult.AsyncResult<unknown, unknown>

export interface UseIssueListDerivationsInput {
	readonly rawIssues: readonly IssueItem[]
	readonly issueOverrides: Readonly<Record<string, IssueItem>>
	readonly showIssueRepositoryGroups: boolean
	readonly activeWorkspaceSurface: string
	readonly visibleFilterText: string
	readonly selectedRepository: string | null
	readonly issuesResult: IssuesResult
	readonly selectedIssueIndex: number
	readonly hasMoreIssues: boolean
}

export interface IssueListDerivations {
	readonly allIssues: readonly IssueItem[]
	readonly issues: readonly IssueItem[]
	readonly issuesStatus: LoadStatus
	readonly issuesError: string | null
	readonly selectedIssue: IssueItem | null
	readonly selectedIssueRowIndex: number | null
	// Whether selection is currently parked on the synthetic "load more"
	// pseudo-row at index `issues.length` (the filtered visible length).
	// The previous design read this from `loadMoreIssueRowSelectedAtom`
	// which compares against `issueListAtom.length` (the unfiltered list).
	// When a filter is active, those lengths diverge and Enter on the
	// visible load-more row fell through to detail.open. Computing it here
	// against the same `issues` we render keeps Enter wired correctly.
	readonly loadMoreIssueRowSelected: boolean
	// Same gate the surface used to compute inline. Off when a filter is
	// active (matching `visibleHasMorePullRequests` on the PR side) — a
	// "load more" against an active client-side filter would be meaningless.
	readonly issueLoadMoreSlotAvailable: boolean
}

/**
 * Folds three layers into the displayed issue list:
 *   1. `rawIssues` from the server.
 *   2. `issueOverrides` for optimistic local mutations + closed orphans
 *      that should stay visible until the next refresh removes them.
 *   3. The active filter text (fuzzy score order, preserving load order
 *      when the query is empty).
 *
 * Server applies mode-based filtering (authored / assigned / mentioned)
 * upstream, so there's no client-side scope filter here.
 */
export const useIssueListDerivations = ({
	rawIssues,
	issueOverrides,
	showIssueRepositoryGroups,
	activeWorkspaceSurface,
	visibleFilterText,
	selectedRepository,
	issuesResult,
	selectedIssueIndex,
	hasMoreIssues,
}: UseIssueListDerivationsInput): IssueListDerivations => {
	const allIssues = useMemo(() => {
		const inScope = (issue: IssueItem) => selectedRepository === null || issue.repository === selectedRepository
		const seen = new Set<string>()
		const mapped: IssueItem[] = []
		for (const issue of rawIssues.filter(inScope)) {
			seen.add(issue.url)
			mapped.push(issueOverrides[issue.url] ?? issue)
		}
		const orphans = Object.values(issueOverrides).filter((issue) => inScope(issue) && !seen.has(issue.url) && issue.state === "closed")
		const merged = [...mapped, ...orphans].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
		return orderIssuesForDisplay(merged, showIssueRepositoryGroups)
	}, [rawIssues, issueOverrides, showIssueRepositoryGroups, selectedRepository])

	const issues = useMemo(() => {
		if (activeWorkspaceSurface !== "issues" || visibleFilterText.trim().length === 0) return allIssues
		const filtered = filterByScore(allIssues, visibleFilterText, issueFilterScore, (issue) => issue.updatedAt.getTime())
		return orderIssuesForDisplay(filtered, showIssueRepositoryGroups)
	}, [activeWorkspaceSurface, allIssues, visibleFilterText, showIssueRepositoryGroups])

	const issuesStatus: LoadStatus = issuesResult.waiting && rawIssues.length === 0 ? "loading" : AsyncResult.isFailure(issuesResult) && rawIssues.length === 0 ? "error" : "ready"
	const issuesError = AsyncResult.isFailure(issuesResult) ? errorMessage(Cause.squash(issuesResult.cause)) : null
	const selectedIssue = issues[Math.max(0, Math.min(selectedIssueIndex, issues.length - 1))] ?? null
	const filterActive = activeWorkspaceSurface === "issues" && visibleFilterText.trim().length > 0
	const issueLoadMoreSlotAvailable = !filterActive && hasMoreIssues && issues.length > 0
	const loadMoreIssueRowSelected = issueLoadMoreSlotAvailable && selectedIssueIndex === issues.length
	const selectedIssueRowIndex = issueListRowIndex(issues, selectedIssueIndex, showIssueRepositoryGroups, loadMoreIssueRowSelected)

	return { allIssues, issues, issuesStatus, issuesError, selectedIssue, selectedIssueRowIndex, loadMoreIssueRowSelected, issueLoadMoreSlotAvailable }
}
