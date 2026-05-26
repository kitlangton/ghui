import type { PullRequestItem } from "./domain.js"
import type { ItemPage } from "./item.js"
import type { PullRequestLoad } from "./pullRequestLoad.js"
import type { PullRequestView } from "./pullRequestViews.js"

// When a fresh summary page arrives, fold in fields that only the detail
// query carries (body, labels, line counts, status checks) from a cached
// detail-loaded copy at the *same* SHA. Otherwise the row would lose its
// detail every refresh: the summary fragment omits `statusCheckRollup`, so
// without this merge the cached `✓`/`✗` icons would revert to blank on every
// page fetch, and hydration would refuse to rerun because `detailLoaded` is
// still true.
export const mergeCachedDetails = (fresh: readonly PullRequestItem[], cached: readonly PullRequestItem[] | undefined) => {
	if (!cached) return fresh
	const cachedByUrl = new Map(cached.map((pullRequest) => [pullRequest.url, pullRequest]))
	return fresh.map((pullRequest) => {
		const cachedPullRequest = cachedByUrl.get(pullRequest.url)
		if (!cachedPullRequest?.detailLoaded || cachedPullRequest.headRefOid !== pullRequest.headRefOid) return pullRequest
		return {
			...pullRequest,
			body: cachedPullRequest.body,
			labels: cachedPullRequest.labels,
			additions: cachedPullRequest.additions,
			deletions: cachedPullRequest.deletions,
			changedFiles: cachedPullRequest.changedFiles,
			checkStatus: cachedPullRequest.checkStatus,
			checkSummary: cachedPullRequest.checkSummary,
			checks: cachedPullRequest.checks,
			detailLoaded: true,
		} satisfies PullRequestItem
	})
}

// Append a fresh page to an existing PR queue, deduping by URL and folding
// in any cached detail fields the fresh summaries omit. The merged result
// preserves the relative order of `existing` followed by *new* items only.
export const appendPullRequestPage = (existing: readonly PullRequestItem[], incoming: readonly PullRequestItem[]): readonly PullRequestItem[] => {
	const seen = new Set(existing.map((pullRequest) => pullRequest.url))
	const mergedIncoming = mergeCachedDetails(incoming, existing)
	return [...existing, ...mergedIncoming.filter((pullRequest) => !seen.has(pullRequest.url))]
}

export const freshPullRequestLoad = (
	view: PullRequestView,
	page: ItemPage<PullRequestItem>,
	existing: PullRequestLoad | undefined,
	prFetchLimit: number,
	fetchedAt: Date = new Date(),
): PullRequestLoad => {
	const data = mergeCachedDetails(page.items, existing?.data)
	return {
		view,
		data,
		fetchedAt,
		endCursor: page.endCursor,
		hasNextPage: page.hasNextPage && data.length < prFetchLimit,
	}
}

// Compute the next PullRequestLoad after a load-more page lands.
//
// Bug history: an earlier version gated hasNextPage on
// `addedItems > 0 && page.hasNextPage && data.length < limit`. The
// `addedItems > 0` term was intended as a defence against infinite
// pagination loops, but it permanently killed hasNextPage whenever
// GitHub returned a page of duplicates — even though the cursor had
// advanced and the next page would be fresh. After that flip, no
// trigger fires another load-more and the list dead-ends.
//
// New invariant: keep pagination alive whenever the cursor advances
// (real forward progress) AND the server claims more pages exist AND
// we haven't blown past prFetchLimit. Duplicate-only pages are fine —
// the cursor moves on and the next request grabs new items.
export const nextLoadAfterPage = (current: PullRequestLoad, page: ItemPage<PullRequestItem>, prFetchLimit: number, fetchedAt: Date = new Date()): PullRequestLoad => {
	const data = appendPullRequestPage(current.data, page.items)
	const cursorAdvanced = page.endCursor !== null && page.endCursor !== current.endCursor
	return {
		...current,
		data,
		fetchedAt,
		endCursor: page.endCursor,
		hasNextPage: page.hasNextPage && cursorAdvanced && data.length < prFetchLimit,
	}
}
