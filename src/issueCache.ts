import type { IssueItem } from "./domain.js"
import type { ItemPage } from "./item.js"
import type { IssueLoad } from "./issueLoad.js"
import type { IssueView } from "./issueViews.js"

// Append a fresh page to an existing issue queue, deduping by URL. The merged
// result preserves the relative order of `existing` followed by *new* items
// only — mirrors the PR pagination helper in src/pullRequestCache.ts.
export const appendIssuePage = (existing: readonly IssueItem[], incoming: readonly IssueItem[]): readonly IssueItem[] => {
	const seen = new Set(existing.map((issue) => issue.url))
	return [...existing, ...incoming.filter((issue) => !seen.has(issue.url))]
}

export const freshIssueLoad = (view: IssueView, page: ItemPage<IssueItem>, fetchedAt: Date = new Date()): IssueLoad => ({
	view,
	data: page.items,
	fetchedAt,
	endCursor: page.endCursor,
	hasNextPage: page.hasNextPage,
})

// Compute the next IssueLoad after a load-more page lands. Same shape and
// invariants as `nextLoadAfterPage` for PRs:
//
//   - Keep hasNextPage true only when the cursor advanced (real forward
//     progress), the server claims more pages, and we haven't blown past
//     `prFetchLimit`. Duplicate-only pages don't kill pagination — the cursor
//     moves on and the next request grabs fresh items.
export const nextIssueLoadAfterPage = (current: IssueLoad, page: ItemPage<IssueItem>, prFetchLimit: number, fetchedAt: Date = new Date()): IssueLoad => {
	const data = appendIssuePage(current.data, page.items)
	const cursorAdvanced = page.endCursor !== null && page.endCursor !== current.endCursor
	return {
		...current,
		data,
		fetchedAt,
		endCursor: page.endCursor,
		hasNextPage: page.hasNextPage && cursorAdvanced && data.length < prFetchLimit,
	}
}
