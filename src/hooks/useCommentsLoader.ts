import type { MutableRefObject } from "react"
import type { IssueItem, PullRequestComment, PullRequestItem } from "../domain.js"
import { errorMessage } from "../errors.js"
import { pullRequestDiffKey } from "../ui/diff.js"

type CommentStatus = "loading" | "ready"

export interface UseCommentsLoaderInput {
	readonly refreshGenerationRef: MutableRefObject<number>
	readonly readCommentsLoadState: () => Record<string, CommentStatus>
	readonly setPullRequestComments: (next: (prev: Record<string, readonly PullRequestComment[]>) => Record<string, readonly PullRequestComment[]>) => void
	readonly setPullRequestCommentsLoaded: (next: (prev: Record<string, CommentStatus>) => Record<string, CommentStatus>) => void
	readonly listPullRequestComments: (input: { repository: string; number: number }) => Promise<readonly PullRequestComment[]>
	readonly listIssueComments: (input: { repository: string; number: number }) => Promise<readonly PullRequestComment[]>
	readonly flashNotice: (msg: string) => void
}

export interface CommentsLoader {
	readonly loadPullRequestComments: (pullRequest: PullRequestItem, force?: boolean) => void
	readonly loadIssueComments: (issue: IssueItem, force?: boolean) => void
}

/**
 * Two parallel loaders (PR + issue comments). Both:
 *   - Skip if a load for this key already happened (unless `force`).
 *   - Mark the key "loading", call the GH service, store results.
 *   - Snapshot a refresh generation up front; ignore the response if the
 *     generation has moved on (a refresh wiped the cache mid-flight).
 *   - On error: roll the key's load state back to its previous value
 *     (or clear it) and flash the notice.
 */
export const useCommentsLoader = ({
	refreshGenerationRef,
	readCommentsLoadState,
	setPullRequestComments,
	setPullRequestCommentsLoaded,
	listPullRequestComments,
	listIssueComments,
	flashNotice,
}: UseCommentsLoaderInput): CommentsLoader => {
	const load = (key: string, fetch: () => Promise<readonly PullRequestComment[]>, force: boolean) => {
		const previousLoadState = readCommentsLoadState()[key]
		if (!force && previousLoadState) return
		const generation = refreshGenerationRef.current
		setPullRequestCommentsLoaded((current) => ({ ...current, [key]: "loading" }))
		void fetch()
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

	return {
		loadPullRequestComments: (pullRequest, force = false) =>
			load(pullRequestDiffKey(pullRequest), () => listPullRequestComments({ repository: pullRequest.repository, number: pullRequest.number }), force),
		loadIssueComments: (issue, force = false) =>
			load(`issue:${issue.repository}#${issue.number}`, () => listIssueComments({ repository: issue.repository, number: issue.number }), force),
	}
}
