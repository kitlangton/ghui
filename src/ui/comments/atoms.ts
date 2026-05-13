import * as Atom from "effect/unstable/reactivity/Atom"
import type { CreatePullRequestCommentInput, IssueItem, PullRequestComment, PullRequestItem } from "../../domain.js"
import { GitHubService } from "../../services/GitHubService.js"
import { githubRuntime } from "../../services/runtime.js"
import { pullRequestDiffKey } from "../diff.js"
import { selectedIssueAtom } from "../issues/atoms.js"
import { selectedPullRequestAtom } from "../pullRequests/atoms.js"
import { workspaceSurfaceAtom } from "../../workspace/atoms.js"
import { commentsViewRowCount, orderCommentsForDisplay, type OrderedComment } from "../CommentsPane.js"

// === UI state atoms ===
export const commentsViewActiveAtom = Atom.make(false)
export const commentsViewSelectionAtom = Atom.make(0)
export const pullRequestCommentsAtom = Atom.make<Record<string, readonly PullRequestComment[]>>({}).pipe(Atom.keepAlive)
export const pullRequestCommentsLoadedAtom = Atom.make<Record<string, "loading" | "ready">>({}).pipe(Atom.keepAlive)

// === Derived selection atoms ===
//
// The "comment subject" is whichever entity (issue or PR) the user is currently
// looking at — that's what comments attach to. It cascades through the comment-
// key, comments list, ordered list, and row count. Promoting these to derived
// atoms means CommentsPane / footer / keymap can subscribe directly instead of
// receiving them as props through useAppShell.
export const selectedCommentSubjectAtom = Atom.make((get): IssueItem | PullRequestItem | null => {
	const surface = get(workspaceSurfaceAtom)
	if (surface === "issues") return get(selectedIssueAtom)
	if (surface === "pullRequests") return get(selectedPullRequestAtom)
	return null
})

export const selectedCommentKeyAtom = Atom.make((get): string | null => {
	const surface = get(workspaceSurfaceAtom)
	if (surface === "issues") {
		const issue = get(selectedIssueAtom)
		return issue ? `issue:${issue.repository}#${issue.number}` : null
	}
	if (surface === "pullRequests") {
		const pr = get(selectedPullRequestAtom)
		return pr ? pullRequestDiffKey(pr) : null
	}
	return null
})

export const selectedCommentsAtom = Atom.make((get): readonly PullRequestComment[] => {
	const key = get(selectedCommentKeyAtom)
	if (!key) return []
	return get(pullRequestCommentsAtom)[key] ?? []
})

export const selectedCommentsStatusAtom = Atom.make((get): "idle" | "loading" | "ready" => {
	const key = get(selectedCommentKeyAtom)
	if (!key) return "idle"
	return get(pullRequestCommentsLoadedAtom)[key] ?? "idle"
})

export const orderedCommentsAtom = Atom.make((get): readonly OrderedComment[] => orderCommentsForDisplay(get(selectedCommentsAtom)))

export const commentsRowCountAtom = Atom.make((get) => commentsViewRowCount(get(selectedCommentsAtom).length))

export const selectedOrderedCommentAtom = Atom.make((get): PullRequestComment | null => {
	const ordered = get(orderedCommentsAtom)
	const index = get(commentsViewSelectionAtom)
	return ordered[index]?.comment ?? null
})

export const selectedItemLabelsAtom = Atom.make((get) => get(selectedCommentSubjectAtom)?.labels ?? [])

// `commentCount` differs from `comments.length` for issues — GitHub returns a
// count on the issue object that may exceed our locally-loaded comment array
// (e.g. before comments are loaded). For PRs they coincide.
export const selectedCommentCountAtom = Atom.make((get) => {
	const surface = get(workspaceSurfaceAtom)
	const localCount = get(selectedCommentsAtom).length
	if (surface !== "issues") return localCount
	return Math.max(get(selectedIssueAtom)?.commentCount ?? 0, localCount)
})

// === Data-fetching atoms ===
export const listPullRequestCommentsAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number }>()((input) =>
	GitHubService.use((github) => github.listPullRequestComments(input.repository, input.number)),
)
export const listIssueCommentsAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number }>()((input) =>
	GitHubService.use((github) => github.listIssueComments(input.repository, input.number)),
)
export const createPullRequestCommentAtom = githubRuntime.fn<CreatePullRequestCommentInput>()((input) => GitHubService.use((github) => github.createPullRequestComment(input)))
export const createPullRequestIssueCommentAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly body: string }>()((input) =>
	GitHubService.use((github) => github.createPullRequestIssueComment(input.repository, input.number, input.body)),
)
export const replyToReviewCommentAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly inReplyTo: string; readonly body: string }>()((input) =>
	GitHubService.use((github) => github.replyToReviewComment(input.repository, input.number, input.inReplyTo, input.body)),
)
export const editPullRequestIssueCommentAtom = githubRuntime.fn<{ readonly repository: string; readonly commentId: string; readonly body: string }>()((input) =>
	GitHubService.use((github) => github.editPullRequestIssueComment(input.repository, input.commentId, input.body)),
)
export const editReviewCommentAtom = githubRuntime.fn<{ readonly repository: string; readonly commentId: string; readonly body: string }>()((input) =>
	GitHubService.use((github) => github.editReviewComment(input.repository, input.commentId, input.body)),
)
export const deletePullRequestIssueCommentAtom = githubRuntime.fn<{ readonly repository: string; readonly commentId: string }>()((input) =>
	GitHubService.use((github) => github.deletePullRequestIssueComment(input.repository, input.commentId)),
)
export const deleteReviewCommentAtom = githubRuntime.fn<{ readonly repository: string; readonly commentId: string }>()((input) =>
	GitHubService.use((github) => github.deleteReviewComment(input.repository, input.commentId)),
)
