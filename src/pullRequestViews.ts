import { pullRequestQueueLabels, pullRequestQueueModes, type PullRequestQueueMode, type PullRequestUserQueueMode } from "./domain.js"
import { type ItemListInput, itemQueryCacheKey, pullRequestQueryToListInput, type PullRequestQuery } from "./item.js"
import type { CustomQueueConfig } from "./themeStore.js"

export type PullRequestView =
	| { readonly _tag: "Repository"; readonly repository: string }
	| { readonly _tag: "Queue"; readonly mode: PullRequestUserQueueMode; readonly repository: string | null }
	// CustomQueue is always repo-scoped — `repository` is a non-null string.
	| { readonly _tag: "CustomQueue"; readonly name: string; readonly query: string; readonly repository: string }

export const initialPullRequestView = (repository: string | null = null): PullRequestView =>
	repository ? { _tag: "Repository", repository } : { _tag: "Queue", mode: "authored", repository: null }

export const viewMode = (view: PullRequestView): PullRequestQueueMode => (view._tag === "Repository" || view._tag === "CustomQueue" ? "repository" : view.mode)

export const viewRepository = (view: PullRequestView) => view.repository

// Convert a view into the unified service input.
// CustomQueue uses mode "all" + rawQualifier so the repo is always scoped
// and the user's query string is passed through verbatim.
export const viewToPullRequestQuery = (view: PullRequestView): PullRequestQuery =>
	view._tag === "Repository"
		? { mode: "all", repository: view.repository, textFilter: "" }
		: view._tag === "CustomQueue"
			? { mode: "all", repository: view.repository, textFilter: "", rawQualifier: view.query }
			: { mode: view.mode, repository: view.repository, textFilter: "" }

export const viewToListInput = (view: PullRequestView, cursor: string | null, pageSize: number): ItemListInput<"pullRequest"> =>
	pullRequestQueryToListInput(viewToPullRequestQuery(view), cursor, pageSize)

// Custom queues include the raw query in the cache key so two queues with
// different queries never share a bucket within the same repository.
export const viewCacheKey = (view: PullRequestView): string =>
	view._tag === "CustomQueue"
		? `pullRequest:custom:${view.query}:${view.repository}`
		: itemQueryCacheKey("pullRequest", viewToPullRequestQuery(view))

export const viewEquals = (left: PullRequestView, right: PullRequestView): boolean => {
	if (left._tag !== right._tag) return false
	if (left._tag === "CustomQueue" && right._tag === "CustomQueue")
		return left.query === right.query && left.repository === right.repository
	return viewMode(left) === viewMode(right) && left.repository === right.repository
}

// Custom queues only appear when a repository is in scope.
export const activePullRequestViews = (view: PullRequestView, customQueues: readonly CustomQueueConfig[] = []): readonly PullRequestView[] => {
	const repository = viewRepository(view)
	return [
		...(repository ? [{ _tag: "Repository" as const, repository }] : []),
		...pullRequestQueueModes.map((mode) => ({ _tag: "Queue" as const, mode, repository })),
		...(repository ? customQueues.map(({ name, query }) => ({ _tag: "CustomQueue" as const, name, query, repository })) : []),
	]
}

export const nextView = (view: PullRequestView, views: readonly PullRequestView[], delta: 1 | -1) => {
	const index = Math.max(
		0,
		views.findIndex((candidate) => viewEquals(candidate, view)),
	)
	return views[(index + delta + views.length) % views.length]!
}

export const viewLabel = (view: PullRequestView) =>
	view._tag === "Repository" ? view.repository : view._tag === "CustomQueue" ? view.name : pullRequestQueueLabels[view.mode]

export const parseRepositoryInput = (input: string) => {
	const trimmed = input.trim()
	const urlMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+)(?:[/?#].*)?$/i)
	const shorthandMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/)
	const match = urlMatch ?? shorthandMatch
	if (!match) return null
	const owner = match[1]!
	const repo = match[2]!.replace(/\.git$/i, "")
	if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null
	return `${owner}/${repo}`
}
