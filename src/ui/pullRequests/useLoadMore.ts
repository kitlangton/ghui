import { useAtom, useAtomSet } from "@effect/atom-react"
import { type MutableRefObject, useRef } from "react"
import { config } from "../../config.js"
import { errorMessage } from "../../errors.js"
import { itemQueueCacheViewer } from "../../item/queue.js"
import type { PullRequestLoad } from "../../pullRequestLoad.js"
import { type PullRequestView, viewToListInput } from "../../pullRequestViews.js"
import { pullRequestPageSize } from "../../services/runtime.js"
import { listOpenPullRequestPageAtom, loadingMoreKeyAtom, nextLoadAfterPage, writeQueueCacheAtom } from "./atoms.js"

export interface UseLoadMoreInput {
	readonly activeView: PullRequestView
	readonly currentQueueCacheKey: string
	readonly pullRequestLoad: PullRequestLoad | null
	readonly hasMorePullRequests: boolean
	readonly pullRequestFetchInFlight: boolean
	readonly username: string | null
	readonly refreshGenerationRef: MutableRefObject<number>
	readonly flashNotice: (message: string) => void
	readonly setQueueLoadCache: (next: (prev: Partial<Record<string, PullRequestLoad>>) => Partial<Record<string, PullRequestLoad>>) => void
}

export interface UseLoadMoreResult {
	/** Fire a "load more" page fetch. Returns false if a fetch couldn't start
	 * (already loading, no more pages, no cursor, or limit reached). */
	readonly loadMorePullRequests: () => boolean
	/** Whether a load-more for the active queue cache key is in flight. */
	readonly isLoadingMorePullRequests: boolean
	/** Reset on view switch / hard refresh so a stale "loading more" never
	 * sticks on a queue the user has navigated away from. */
	readonly resetLoadingMore: () => void
}

// Surfaces a stuck fetch as a flash notice instead of a permanently spinning
// load-more row. Slightly longer than GitHub's typical p99 to avoid
// false-positives, short enough that a wedged response doesn't ruin the UX.
const LOAD_MORE_TIMEOUT_MS = 15_000

/**
 * Owns the load-more pagination state machine: gates, generation guard,
 * cache append, optimistic-write to in-memory cache, and SQLite persistence.
 *
 * Concurrency model:
 *   - `inFlightKeyRef` is the *synchronous* "is a fetch in flight" lock.
 *     React state (`setLoadingMoreKey`) is async, so two triggers within
 *     the same tick can both pass a state-only guard and fire parallel
 *     fetches with the same cursor. That race wedges pagination: the
 *     second response sees cursorAdvanced=false (cursor already moved by
 *     the first) and flips hasNextPage to false at 50 loaded.
 *   - The ref is checked + set *before* any awaited work; the matching
 *     `.finally` clears both ref and state.
 *
 * Generation guard via the shared `refreshGenerationRef`: if a refresh or
 * view switch happens mid-flight, the response is silently dropped. The
 * `.finally` clears the loading flag only while this exact invocation still
 * owns it, so an old A request cannot clear a newer A request after A → B → A.
 *
 * Timeout: a 15s `Promise.race` surfaces a hanging fetch as a flash notice
 * + cleared spinner. The underlying Effect isn't cancelled (no AbortSignal
 * threaded through), so it keeps running in the background — but the local
 * `.then` ignores its late resolution because the race already settled.
 */
export const useLoadMore = ({
	activeView,
	currentQueueCacheKey,
	pullRequestLoad,
	hasMorePullRequests,
	pullRequestFetchInFlight,
	username,
	refreshGenerationRef,
	flashNotice,
	setQueueLoadCache,
}: UseLoadMoreInput): UseLoadMoreResult => {
	const loadPullRequestPage = useAtomSet(listOpenPullRequestPageAtom, { mode: "promise" })
	const writeQueueCache = useAtomSet(writeQueueCacheAtom, { mode: "promise" })
	const inFlightRef = useRef<{ readonly key: string; readonly id: number } | null>(null)
	const requestIdRef = useRef(0)
	// Component-local loading flag mirrors the ref so the UI re-renders when
	// loading state changes. The ref is the source of truth for the guard.
	const [loadingMoreKey, setLoadingMoreKey] = useAtom(loadingMoreKeyAtom)
	const isLoadingMorePullRequests = loadingMoreKey === currentQueueCacheKey

	const loadMorePullRequests = (): boolean => {
		if (inFlightRef.current !== null) return false
		if (pullRequestFetchInFlight) return false
		if (!pullRequestLoad || !hasMorePullRequests || !pullRequestLoad.endCursor) return false
		const remaining = config.prFetchLimit - pullRequestLoad.data.length
		if (remaining <= 0) return false
		const cacheKey = currentQueueCacheKey
		const generation = refreshGenerationRef.current
		const request = { key: cacheKey, id: ++requestIdRef.current }
		inFlightRef.current = request
		setLoadingMoreKey(cacheKey)
		const fetchPromise = loadPullRequestPage(viewToListInput(activeView, pullRequestLoad.endCursor, Math.min(pullRequestPageSize, remaining)))
		let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null
		const timeoutPromise = new Promise<never>((_, reject) => {
			timeoutId = globalThis.setTimeout(() => reject(new Error(`Load more timed out after ${LOAD_MORE_TIMEOUT_MS / 1000}s`)), LOAD_MORE_TIMEOUT_MS)
		})
		void Promise.race([fetchPromise, timeoutPromise])
			.then((page) => {
				if (generation !== refreshGenerationRef.current) return
				// TOCTOU fix: merge inside the functional updater so the merge
				// always sees the freshest cached load. The previous version
				// snapshotted `currentLoad` via `registry.get` *before* the
				// `setQueueLoadCache` call, which let a `useDetailHydration`
				// write landing in between get silently clobbered (revert
				// detail fields, lose status checks, etc.) when the merged
				// page was written back.
				let persistedLoad: PullRequestLoad | null = null
				setQueueLoadCache((current) => {
					const currentLoad = current[cacheKey]
					if (!currentLoad) return current
					persistedLoad = nextLoadAfterPage(currentLoad, page, config.prFetchLimit)
					return { ...current, [cacheKey]: persistedLoad }
				})
				if (!persistedLoad) return
				const viewer = itemQueueCacheViewer(activeView, username)
				if (viewer) void writeQueueCache({ viewer, load: persistedLoad }).catch(() => {})
			})
			.catch((error) => {
				flashNotice(errorMessage(error))
			})
			.finally(() => {
				if (timeoutId !== null) globalThis.clearTimeout(timeoutId)
				if (inFlightRef.current !== request) return
				inFlightRef.current = null
				setLoadingMoreKey((current) => (current === request.key ? null : current))
			})
		return true
	}

	const resetLoadingMore = () => {
		inFlightRef.current = null
		setLoadingMoreKey(null)
	}

	return { loadMorePullRequests, isLoadingMorePullRequests, resetLoadingMore }
}
