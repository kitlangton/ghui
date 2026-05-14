import { useAtomSet } from "@effect/atom-react"
import { type MutableRefObject, useEffect, useRef, useState } from "react"
import type { LoadStatus, PullRequestItem } from "../../domain.js"
import { errorMessage } from "../../errors.js"
import type { PullRequestLoad } from "../../pullRequestLoad.js"
import { pullRequestDetailKey, pullRequestDetailsAtom, readCachedPullRequestAtom, writeCachedPullRequestAtom } from "./atoms.js"

const DETAIL_PREFETCH_BEHIND = 1
const DETAIL_PREFETCH_AHEAD = 3
const DETAIL_PREFETCH_CONCURRENCY = 3
const DETAIL_PREFETCH_DELAY_MS = 120

export type DetailHydrationState = { readonly _tag: "Loading" } | { readonly _tag: "Error"; readonly message: string }

interface DetailHydration {
	readonly token: symbol
	notifyError: boolean
}

export interface UseDetailHydrationInput {
	readonly selectedPullRequest: PullRequestItem | null
	readonly pullRequestStatus: LoadStatus
	readonly visiblePullRequests: readonly PullRequestItem[]
	readonly selectedIndex: number
	readonly currentQueueCacheKey: string
	readonly refreshGenerationRef: MutableRefObject<number>
	/** Timestamp of the latest queue fetch. When this advances we force-rehydrate
	 * the selected PR so its checks/labels reflect the latest server state. */
	readonly queueFetchedAtMs: number | null
	readonly flashNotice: (message: string) => void
	readonly setQueueLoadCache: (next: (prev: Partial<Record<string, PullRequestLoad>>) => Partial<Record<string, PullRequestLoad>>) => void
}

export interface UseDetailHydrationResult {
	/** Force-hydrate this PR (notifyError=true: surface failures to the user). */
	readonly hydratePullRequestDetails: (pullRequest: PullRequestItem, notifyError: boolean) => boolean
	/** Per-PR loading/error tracking for the selected pane. */
	readonly detailHydrationState: Record<string, DetailHydrationState>
	/** Cancel pending hydrations and clear the prefetch timeout — call on
	 * manual refresh or view switch so we don't apply stale fetches. */
	readonly resetHydration: () => void
}

/**
 * Owns the background "hydrate detail" pipeline. The selected PR is
 * always hydrated (notifyError=true → loading state + flash on error);
 * neighbours within ±DETAIL_PREFETCH_AHEAD/BEHIND are prefetched after
 * a short debounce (notifyError=false → silent).
 *
 * Concurrency cap, generation tracking (so stale fetches drop on
 * refresh), and the cache-then-network double-write are all owned here
 * so callers don't need to know the protocol.
 */
export const useDetailHydration = ({
	selectedPullRequest,
	pullRequestStatus,
	visiblePullRequests,
	selectedIndex,
	currentQueueCacheKey,
	refreshGenerationRef,
	queueFetchedAtMs,
	flashNotice,
	setQueueLoadCache,
}: UseDetailHydrationInput): UseDetailHydrationResult => {
	const readCachedPullRequest = useAtomSet(readCachedPullRequestAtom, { mode: "promise" })
	const writeCachedPullRequest = useAtomSet(writeCachedPullRequestAtom, { mode: "promise" })
	const fetchPullRequestDetails = useAtomSet(pullRequestDetailsAtom, { mode: "promise" })

	const [detailHydrationState, setDetailHydrationState] = useState<Record<string, DetailHydrationState>>({})
	const detailHydrationRef = useRef(new Map<string, DetailHydration>())
	const cachedDetailKeysRef = useRef(new Set<string>())
	const detailPrefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(
		() => () => {
			if (detailPrefetchTimeoutRef.current !== null) clearTimeout(detailPrefetchTimeoutRef.current)
		},
		[],
	)

	const applyPullRequestDetail = (detail: PullRequestItem) => {
		setQueueLoadCache((current) => {
			const next = { ...current }
			let changed = false
			for (const [cacheKey, load] of Object.entries(current)) {
				if (!load) continue
				const index = load.data.findIndex((pullRequest) => pullRequest.url === detail.url)
				if (index < 0) continue
				const data = [...load.data]
				data[index] = detail
				changed = true
				next[cacheKey] = { ...load, data }
			}
			return changed ? next : current
		})
	}

	const hydratePullRequestDetails = (pullRequest: PullRequestItem, notifyError: boolean, options?: { readonly force?: boolean }): boolean => {
		if (pullRequest.state !== "open") return false
		const detailKey = pullRequestDetailKey(pullRequest)
		const force = options?.force === true
		const forceRefresh = force || (notifyError && pullRequest.detailLoaded && cachedDetailKeysRef.current.has(detailKey))
		if (pullRequest.detailLoaded && !forceRefresh) return false
		const existing = detailHydrationRef.current.get(detailKey)
		if (existing) {
			if (notifyError) existing.notifyError = true
			return false
		}
		if (!notifyError && detailHydrationRef.current.size >= DETAIL_PREFETCH_CONCURRENCY) return false
		const entry: DetailHydration = { token: Symbol(detailKey), notifyError }
		detailHydrationRef.current.set(detailKey, entry)
		if (notifyError) setDetailHydrationState((current) => ({ ...current, [detailKey]: { _tag: "Loading" } }))
		const generation = refreshGenerationRef.current
		if (!pullRequest.detailLoaded) {
			void readCachedPullRequest({ repository: pullRequest.repository, number: pullRequest.number })
				.then((cached) => {
					if (!cached || !cached.detailLoaded || cached.headRefOid !== pullRequest.headRefOid) return
					if (generation !== refreshGenerationRef.current || detailHydrationRef.current.get(detailKey) !== entry) return
					cachedDetailKeysRef.current.add(detailKey)
					applyPullRequestDetail(cached)
				})
				.catch(() => {})
		}
		// `pullRequestDetailsAtom` is now a `runtime.fn`, so we just call it
		// for a clean Promise. `forceRefresh` is implicit — fn invocations
		// always run the effect, there's no result-caching layer to bypass.
		void fetchPullRequestDetails({ repository: pullRequest.repository, number: pullRequest.number })
			.then((detail) => {
				if (generation === refreshGenerationRef.current && detailHydrationRef.current.get(detailKey) === entry) {
					cachedDetailKeysRef.current.delete(detailKey)
					if (entry.notifyError) {
						setDetailHydrationState((current) => {
							if (!(detailKey in current)) return current
							const next = { ...current }
							delete next[detailKey]
							return next
						})
					}
					applyPullRequestDetail(detail)
					void writeCachedPullRequest(detail).catch(() => {})
				}
			})
			.catch((error) => {
				if (entry.notifyError && generation === refreshGenerationRef.current && detailHydrationRef.current.get(detailKey) === entry) {
					const message = errorMessage(error)
					setDetailHydrationState((current) => ({ ...current, [detailKey]: { _tag: "Error", message } }))
					flashNotice(message)
				}
			})
			.finally(() => {
				if (detailHydrationRef.current.get(detailKey) === entry) detailHydrationRef.current.delete(detailKey)
			})
		return true
	}

	const resetHydration = () => {
		detailHydrationRef.current.clear()
		setDetailHydrationState({})
		if (detailPrefetchTimeoutRef.current !== null) clearTimeout(detailPrefetchTimeoutRef.current)
	}

	// Hydrate the selected PR with notifyError=true so user sees loading + flash on error.
	// When the queue's `fetchedAt` advances (i.e. the list itself just refreshed),
	// force a re-fetch even if `detailLoaded` is still true — checks may have moved
	// even though the SHA hasn't.
	//
	// Track only the currently-selected (detailKey, fetchedAt) in a single slot
	// rather than a growing Map: we only need to detect "did the queue refresh
	// since we last hydrated *this* PR?" — comparing against a Map keyed by every
	// PR ever selected would slowly leak.
	const lastSelectedRefreshRef = useRef<{ detailKey: string; fetchedAt: number } | null>(null)
	useEffect(() => {
		if (pullRequestStatus !== "ready" || !selectedPullRequest) return
		const detailKey = pullRequestDetailKey(selectedPullRequest)
		const previous = lastSelectedRefreshRef.current
		const queueAdvanced = queueFetchedAtMs !== null && previous !== null && previous.detailKey === detailKey && queueFetchedAtMs > previous.fetchedAt
		if (queueFetchedAtMs !== null) lastSelectedRefreshRef.current = { detailKey, fetchedAt: queueFetchedAtMs }
		hydratePullRequestDetails(selectedPullRequest, true, queueAdvanced ? { force: true } : undefined)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		pullRequestStatus,
		queueFetchedAtMs,
		selectedPullRequest?.url,
		selectedPullRequest?.headRefOid,
		selectedPullRequest?.state,
		selectedPullRequest?.detailLoaded,
		selectedPullRequest?.repository,
		selectedPullRequest?.number,
	])

	// Prefetch neighbours around the selected index after a short debounce.
	useEffect(() => {
		if (detailPrefetchTimeoutRef.current !== null) clearTimeout(detailPrefetchTimeoutRef.current)
		if (pullRequestStatus !== "ready" || visiblePullRequests.length === 0) return
		detailPrefetchTimeoutRef.current = globalThis.setTimeout(() => {
			detailPrefetchTimeoutRef.current = null
			let started = 0
			for (let distance = 1; distance <= Math.max(DETAIL_PREFETCH_AHEAD, DETAIL_PREFETCH_BEHIND); distance++) {
				const offsets = [distance <= DETAIL_PREFETCH_AHEAD ? distance : null, distance <= DETAIL_PREFETCH_BEHIND ? -distance : null]
				for (const offset of offsets) {
					if (offset === null) continue
					if (started >= DETAIL_PREFETCH_CONCURRENCY) return
					const pullRequest = visiblePullRequests[selectedIndex + offset]
					if (pullRequest && hydratePullRequestDetails(pullRequest, false)) started += 1
				}
			}
		}, DETAIL_PREFETCH_DELAY_MS)
		return () => {
			if (detailPrefetchTimeoutRef.current !== null) clearTimeout(detailPrefetchTimeoutRef.current)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pullRequestStatus, currentQueueCacheKey, selectedIndex, visiblePullRequests])

	return {
		hydratePullRequestDetails,
		detailHydrationState,
		resetHydration,
	}
}
