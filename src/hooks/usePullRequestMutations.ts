import type { IssueItem, PullRequestItem } from "../domain.js"

export interface UsePullRequestMutationsInput {
	readonly pullRequests: readonly PullRequestItem[]
	readonly issues: readonly IssueItem[]
	readonly setPullRequestOverrides: (next: (prev: Readonly<Record<string, PullRequestItem>>) => Readonly<Record<string, PullRequestItem>>) => void
	readonly setIssueOverrides: (next: (prev: Readonly<Record<string, IssueItem>>) => Readonly<Record<string, IssueItem>>) => void
	readonly setRecentlyCompletedPullRequests: (
		next: Readonly<Record<string, PullRequestItem>> | ((prev: Readonly<Record<string, PullRequestItem>>) => Readonly<Record<string, PullRequestItem>>),
	) => void
}

export interface PullRequestMutations {
	readonly updatePullRequest: (url: string, transform: (pr: PullRequestItem) => PullRequestItem) => void
	readonly updateIssue: (url: string, transform: (issue: IssueItem) => IssueItem) => void
	readonly markPullRequestCompleted: (pullRequest: PullRequestItem, state: "closed" | "merged") => void
	readonly restoreOptimisticPullRequest: (pullRequest: PullRequestItem) => void
}

/**
 * Optimistic-update helpers for PRs and issues. `updatePullRequest` /
 * `updateIssue` write to per-url override atoms that the list memos
 * fold in. `markPullRequestCompleted` parks a PR in the recently-
 * completed map so a freshly merged/closed PR stays visible until
 * the next server refresh removes it. `restoreOptimisticPullRequest`
 * is the rollback path used by failed mutations.
 */
export const usePullRequestMutations = ({
	pullRequests,
	issues,
	setPullRequestOverrides,
	setIssueOverrides,
	setRecentlyCompletedPullRequests,
}: UsePullRequestMutationsInput): PullRequestMutations => {
	const updatePullRequest = (url: string, transform: (pr: PullRequestItem) => PullRequestItem) => {
		const pullRequest = pullRequests.find((item) => item.url === url)
		if (!pullRequest) return
		setPullRequestOverrides((current) => ({ ...current, [url]: transform(pullRequest) }))
	}
	const updateIssue = (url: string, transform: (issue: IssueItem) => IssueItem) => {
		const issue = issues.find((item) => item.url === url)
		if (!issue) return
		setIssueOverrides((current) => ({ ...current, [url]: transform(issue) }))
	}
	const markPullRequestCompleted = (pullRequest: PullRequestItem, state: "closed" | "merged") => {
		setRecentlyCompletedPullRequests((current) => ({
			...current,
			[pullRequest.url]: { ...pullRequest, state, autoMergeEnabled: false },
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
	return { updatePullRequest, updateIssue, markPullRequestCompleted, restoreOptimisticPullRequest }
}
