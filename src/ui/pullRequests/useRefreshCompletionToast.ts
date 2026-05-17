import { type MutableRefObject, useEffect, useState } from "react"
import type { LoadStatus, PullRequestItem } from "../../domain.js"
import type { PullRequestLoad } from "../../pullRequestLoad.js"

export interface UseRefreshCompletionToastInput {
	readonly pullRequestStatus: LoadStatus
	readonly pullRequestError: string | null
	readonly fetchedAt: number | undefined
	readonly pullRequestLoad: PullRequestLoad | null
	readonly selectedPullRequest: PullRequestItem | null
	readonly lastPullRequestRefreshAtRef: MutableRefObject<number>
	readonly flashNotice: (message: string) => void
}

export interface UseRefreshCompletionToastResult {
	/** Arm a toast that fires once the next refresh lands successfully (or
	 * "Refresh failed" if it errors). Idempotent — overrides any previous
	 * pending toast message. */
	readonly armRefreshToast: (message: string) => void
	/** Cancel any pending toast — e.g. on view switch where the previous
	 * refresh is no longer the user's focus. */
	readonly cancelRefreshToast: () => void
}

/**
 * Owns the "refresh completed" toast lifecycle: holds the pending message,
 * watches the queue's fetch timestamp for advancement, and flashes once the
 * detail-hydration settles (so we don't flash "Refreshed" while checks are
 * still loading in for the selected row).
 */
export const useRefreshCompletionToast = ({
	pullRequestStatus,
	pullRequestError,
	fetchedAt,
	pullRequestLoad,
	selectedPullRequest,
	lastPullRequestRefreshAtRef,
	flashNotice,
}: UseRefreshCompletionToastInput): UseRefreshCompletionToastResult => {
	const [refreshCompletionMessage, setRefreshCompletionMessage] = useState<string | null>(null)
	const [refreshStartedAt, setRefreshStartedAt] = useState<number | null>(null)

	const armRefreshToast = (message: string) => {
		setRefreshCompletionMessage(message)
		setRefreshStartedAt(lastPullRequestRefreshAtRef.current)
	}

	const cancelRefreshToast = () => {
		setRefreshCompletionMessage(null)
		setRefreshStartedAt(null)
	}

	useEffect(() => {
		if (!refreshCompletionMessage || refreshStartedAt === null) return
		const isHydratingDetails = pullRequestStatus === "ready" && selectedPullRequest?.state === "open" && !selectedPullRequest.detailLoaded
		if (pullRequestStatus === "ready" && fetchedAt !== undefined && fetchedAt !== refreshStartedAt && !isHydratingDetails) {
			flashNotice(`✓ ${refreshCompletionMessage}`)
			setRefreshCompletionMessage(null)
			setRefreshStartedAt(null)
		} else if (pullRequestStatus === "error" || pullRequestError) {
			flashNotice(pullRequestLoad ? "Refresh failed; showing cached data" : "Refresh failed")
			setRefreshCompletionMessage(null)
			setRefreshStartedAt(null)
		}
		// Re-runs when hydration finishes (`selectedPullRequest.detailLoaded`
		// flips true) so the queued `✓ Refreshed` toast can finally fire. The
		// previous version listed `pullRequests` here, which is the queue array
		// reference and doesn't necessarily change identity when an individual
		// PR's detail lands — that left the toast silently stuck.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [refreshCompletionMessage, refreshStartedAt, pullRequestStatus, pullRequestError, fetchedAt, selectedPullRequest?.detailLoaded])

	return { armRefreshToast, cancelRefreshToast }
}
