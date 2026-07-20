import type { IssueView } from "./issueViews.js"
import type { PullRequestView } from "./pullRequestViews.js"

// Project a pull-request view onto the matching issue view. The two surfaces
// share a single notion of "what repository am I scoped to" but the issue
// view keeps its own mode (issues don't have all the PR queue modes), so the
// projection is: when the PR view scopes to a repo, the issue view scopes to
// the same repo as a Repository view; when the PR view is the global Queue,
// the issue view falls back to the global "authored" queue.
//
// The function is total — every PR view has a defined issue counterpart —
// which lets the call site set it unconditionally on every PR-view change
// rather than checking "did the repository differ from the previous view".
// That conditional logic was the source of a same-repo-Queue-toggle bug
// where switching from Repository(opencode) to Queue(authored, opencode)
// would skip the sync and leave the issue view stuck on a stale value.
export const issueViewForPullRequestView = (view: PullRequestView): IssueView => {
	if (view._tag === "Repository") return { _tag: "Repository", repository: view.repository }
	if (view._tag === "CustomQueue") return { _tag: "CustomQueue", name: view.name, query: view.query, repository: view.repository }
	if (view.repository === null) return { _tag: "Queue", mode: "authored", repository: null }
	return { _tag: "Repository", repository: view.repository }
}
