import { type IssueListMode, type IssueQuery, issueQueryToListInput, type ItemListInput, itemQueryCacheKey } from "./item.js"

// Mirrors `PullRequestView`. `Repository` means "all issues in this repo";
// `Queue` carries the people qualifier (authored/assigned/mentioned). The
// "all" mode is reserved for the Repository view, so Queue's mode excludes it.
// `CustomQueue` mirrors the PR surface's custom filter — same name/query,
// prefixed with `is:issue` instead of `is:pr`. Always repo-scoped.
export type IssueView =
	| { readonly _tag: "Repository"; readonly repository: string }
	| { readonly _tag: "Queue"; readonly mode: Exclude<IssueListMode, "all">; readonly repository: string | null }
	| { readonly _tag: "CustomQueue"; readonly name: string; readonly query: string; readonly repository: string }

export const initialIssueView = (repository: string | null = null): IssueView =>
	repository ? { _tag: "Repository", repository } : { _tag: "Queue", mode: "authored", repository: null }

export const issueViewMode = (view: IssueView): IssueListMode => (view._tag === "Repository" || view._tag === "CustomQueue" ? "all" : view.mode)
export const issueViewRepository = (view: IssueView) => view.repository

export const issueViewToQuery = (view: IssueView): IssueQuery =>
	view._tag === "CustomQueue"
		? { mode: "all", repository: view.repository, textFilter: "", rawQualifier: view.query }
		: { mode: issueViewMode(view), repository: issueViewRepository(view), textFilter: "" }

export const issueViewToListInput = (view: IssueView, cursor: string | null, pageSize: number): ItemListInput<"issue"> =>
	issueQueryToListInput(issueViewToQuery(view), cursor, pageSize)

// Stable cache key shared with the service-seam input. PR keys start with
// `pullRequest:`; issue keys start with `issue:`. Migration `003` relies on
// that prefix split when pruning legacy snapshots.
export const issueViewCacheKey = (view: IssueView): string =>
	view._tag === "CustomQueue"
		? `issue:custom:${view.query}:${view.repository}`
		: itemQueryCacheKey("issue", issueViewToQuery(view))

export const issueViewEquals = (left: IssueView, right: IssueView): boolean => {
	if (left._tag !== right._tag) return false
	if (left._tag === "CustomQueue" && right._tag === "CustomQueue")
		return left.query === right.query && left.repository === right.repository
	return issueViewMode(left) === issueViewMode(right) && left.repository === right.repository
}
