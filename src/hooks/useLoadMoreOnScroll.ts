import { useEffect, type MutableRefObject } from "react"
import type { ScrollBoxRenderable } from "@opentui/core"

const LOAD_MORE_SELECTION_THRESHOLD = 8
const LOAD_MORE_SCROLL_THRESHOLD = 3

export interface UseLoadMoreOnScrollInput {
	readonly prListScrollRef: MutableRefObject<ScrollBoxRenderable | null>
	readonly visiblePullRequestsLength: number
	readonly pullRequestListFilterActive: boolean
	readonly selectedIndex: number
	readonly hasMorePullRequests: boolean
	readonly isLoadingMorePullRequests: boolean
	readonly detailFullView: boolean
	readonly diffFullView: boolean
	readonly currentQueueCacheKey: string
	readonly loadMorePullRequests: () => boolean | Promise<void> | void
}

/**
 * Watch the PR list for two "load more" signals:
 *   1. Selection moves within `LOAD_MORE_SELECTION_THRESHOLD` of the tail.
 *   2. Scrollbox bottom reaches within `LOAD_MORE_SCROLL_THRESHOLD` of the
 *      scrollable height (polled at 120ms).
 *
 * Both call into `loadMorePullRequests`, which deduplicates concurrent
 * requests. Skipped while a list filter is active or detail/diff modes
 * are open.
 */
export const useLoadMoreOnScroll = ({
	prListScrollRef,
	visiblePullRequestsLength,
	pullRequestListFilterActive,
	selectedIndex,
	hasMorePullRequests,
	isLoadingMorePullRequests,
	detailFullView,
	diffFullView,
	currentQueueCacheKey,
	loadMorePullRequests,
}: UseLoadMoreOnScrollInput): void => {
	useEffect(() => {
		if (pullRequestListFilterActive || visiblePullRequestsLength === 0) return
		const thresholdIndex = Math.max(0, visiblePullRequestsLength - LOAD_MORE_SELECTION_THRESHOLD)
		if (selectedIndex >= thresholdIndex) loadMorePullRequests()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedIndex, visiblePullRequestsLength, pullRequestListFilterActive, hasMorePullRequests, isLoadingMorePullRequests, currentQueueCacheKey])

	useEffect(() => {
		if (pullRequestListFilterActive || visiblePullRequestsLength === 0 || detailFullView || diffFullView) return
		if (!hasMorePullRequests || isLoadingMorePullRequests) return
		const checkScroll = () => {
			const scroll = prListScrollRef.current
			if (!scroll || scroll.viewport.height <= 0) return
			const bottom = scroll.scrollTop + scroll.viewport.height
			if (bottom >= scroll.scrollHeight - LOAD_MORE_SCROLL_THRESHOLD) loadMorePullRequests()
		}
		checkScroll()
		const interval = globalThis.setInterval(checkScroll, 120)
		return () => globalThis.clearInterval(interval)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [visiblePullRequestsLength, pullRequestListFilterActive, detailFullView, diffFullView, hasMorePullRequests, isLoadingMorePullRequests, currentQueueCacheKey])
}
