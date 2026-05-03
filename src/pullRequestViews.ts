import { pullRequestQueueLabels, pullRequestQueueModes, type PullRequestQueueMode, type PullRequestUserQueueMode } from "./domain.js"

export type PullRequestView =
	| { readonly _tag: "Repository"; readonly repository: string }
	| { readonly _tag: "Queue"; readonly mode: PullRequestUserQueueMode; readonly repository: string | null }

export const initialPullRequestView = (): PullRequestView => ({ _tag: "Queue", mode: "authored", repository: null })

export const viewMode = (view: PullRequestView): PullRequestQueueMode => view._tag === "Repository" ? "repository" : view.mode

export const viewRepository = (view: PullRequestView) => view.repository

export const viewCacheKey = (view: PullRequestView) => view._tag === "Repository" ? `repository:${view.repository}` : view.mode

export const viewEquals = (left: PullRequestView, right: PullRequestView) =>
	left._tag === right._tag && viewMode(left) === viewMode(right) && left.repository === right.repository

export const activePullRequestViews = (view: PullRequestView): readonly PullRequestView[] => {
	const repository = viewRepository(view)
	return [
		...(repository ? [{ _tag: "Repository" as const, repository }] : []),
		...pullRequestQueueModes.map((mode) => ({ _tag: "Queue" as const, mode, repository })),
	]
}

export const nextView = (view: PullRequestView, views: readonly PullRequestView[], delta: 1 | -1) => {
	const index = Math.max(0, views.findIndex((candidate) => viewEquals(candidate, view)))
	return views[(index + delta + views.length) % views.length]!
}

export const viewLabel = (view: PullRequestView) => view._tag === "Repository" ? view.repository : pullRequestQueueLabels[view.mode]

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
