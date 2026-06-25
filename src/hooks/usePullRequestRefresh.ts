import { useEffect, type MutableRefObject } from "react"
import type { PullRequestComment, PullRequestItem } from "../domain.js"
import type { LoadStatus } from "../domain.js"

interface PullRequestLoadShape {
	readonly fetchedAt?: Date | null
}

export interface UsePullRequestRefreshInput {
	readonly pullRequestLoad: PullRequestLoadShape | null
	readonly pullRequestFetchInFlight: boolean
	readonly isLoadingMorePullRequests: boolean
	readonly refreshGenerationRef: MutableRefObject<number>
	readonly lastPullRequestRefreshAtRef: MutableRefObject<number>
	readonly pullRequestStatusRef: MutableRefObject<LoadStatus>
	readonly terminalFocusedRef: MutableRefObject<boolean>
	readonly maybeRefreshPullRequestsRef: MutableRefObject<(minimumAgeMs: number) => void>
	readonly refreshPullRequestsRef: MutableRefObject<(message?: string, options?: { readonly resetTransientState?: boolean }) => void>
	readonly resetHydration: () => void
	readonly resetLoadingMore: () => void
	readonly setPullRequestOverrides: (next: Readonly<Record<string, PullRequestItem>>) => void
	readonly setRecentlyCompletedPullRequests: (next: Readonly<Record<string, PullRequestItem>>) => void
	readonly setPullRequestComments: (next: Readonly<Record<string, readonly PullRequestComment[]>>) => void
	readonly setPullRequestCommentsLoaded: (next: Readonly<Record<string, "loading" | "ready">>) => void
	readonly setNotice: (next: string | null) => void
	readonly armRefreshToast: (message: string) => void
	readonly refreshPullRequestsAtom: () => void
}

export interface PullRequestRefresh {
	readonly refreshPullRequests: (message?: string, options?: { readonly resetTransientState?: boolean }) => void
}

/**
 * `refreshPullRequests` is the entry point every command/atomic
 * mutation uses to ask for a server refetch. It:
 *   - bumps the generation so in-flight comment/diff loads ignore stale responses,
 *   - resets hydration + load-more state,
 *   - optionally wipes transient stores (overrides, recently-completed, cached comments),
 *   - flashes a refresh-completion toast,
 *   - kicks the atom that drives the actual fetch.
 *
 * The hook also installs the maybe-refresh debouncer (used by focus
 * return + idle refresh) and a useEffect that tracks the most recent
 * `pullRequestLoad.fetchedAt` so age checks compare against the right
 * baseline.
 */
export const usePullRequestRefresh = ({
	pullRequestLoad,
	pullRequestFetchInFlight,
	isLoadingMorePullRequests,
	refreshGenerationRef,
	lastPullRequestRefreshAtRef,
	pullRequestStatusRef,
	terminalFocusedRef,
	maybeRefreshPullRequestsRef,
	refreshPullRequestsRef,
	resetHydration,
	resetLoadingMore,
	setPullRequestOverrides,
	setRecentlyCompletedPullRequests,
	setPullRequestComments,
	setPullRequestCommentsLoaded,
	setNotice,
	armRefreshToast,
	refreshPullRequestsAtom,
}: UsePullRequestRefreshInput): PullRequestRefresh => {
	const refreshPullRequests = (message?: string, options: { readonly resetTransientState?: boolean } = {}) => {
		if (pullRequestFetchInFlight || isLoadingMorePullRequests) return
		refreshGenerationRef.current += 1
		resetHydration()
		resetLoadingMore()
		setPullRequestOverrides({})
		if (options.resetTransientState) {
			setRecentlyCompletedPullRequests({})
			setPullRequestComments({})
			setPullRequestCommentsLoaded({})
		}
		if (message) {
			setNotice(null)
			armRefreshToast(message)
		}
		refreshPullRequestsAtom()
	}
	refreshPullRequestsRef.current = refreshPullRequests
	maybeRefreshPullRequestsRef.current = (minimumAgeMs) => {
		if (!terminalFocusedRef.current || pullRequestStatusRef.current === "loading" || pullRequestFetchInFlight) return
		const lastRefreshAt = lastPullRequestRefreshAtRef.current
		if (lastRefreshAt > 0 && Date.now() - lastRefreshAt < minimumAgeMs) return
		refreshPullRequestsRef.current()
	}

	useEffect(() => {
		const fetchedAt = pullRequestLoad?.fetchedAt?.getTime()
		if (fetchedAt !== undefined) {
			lastPullRequestRefreshAtRef.current = fetchedAt
		}
	}, [pullRequestLoad?.fetchedAt, lastPullRequestRefreshAtRef])

	return { refreshPullRequests }
}
