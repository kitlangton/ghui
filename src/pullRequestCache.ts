import type { PullRequestItem } from "./domain.js"
import type { ItemPage } from "./item.js"
import { freshItemLoad, nextItemLoadAfterPage } from "./item/load.js"
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
		return mergePullRequestDetail(pullRequest, cachedPullRequest)
	})
}

export const mergePullRequestDetail = (summary: PullRequestItem, detail: PullRequestItem): PullRequestItem => ({
	...summary,
	body: detail.body,
	labels: detail.labels,
	additions: detail.additions,
	deletions: detail.deletions,
	changedFiles: detail.changedFiles,
	checkStatus: detail.checkStatus,
	checkSummary: detail.checkSummary,
	checks: detail.checks,
	detailLoaded: true,
})

export const freshPullRequestLoad = (
	view: PullRequestView,
	page: ItemPage<PullRequestItem>,
	existing: PullRequestLoad | undefined,
	prFetchLimit: number,
	fetchedAt: Date = new Date(),
): PullRequestLoad => {
	return freshItemLoad(view, page, (items) => mergeCachedDetails(items, existing?.data), prFetchLimit, fetchedAt)
}

export const nextLoadAfterPage = (current: PullRequestLoad, page: ItemPage<PullRequestItem>, prFetchLimit: number, fetchedAt: Date = new Date()): PullRequestLoad => {
	return nextItemLoadAfterPage(current, page, prFetchLimit, (pullRequest) => pullRequest.url, mergeCachedDetails, fetchedAt)
}
