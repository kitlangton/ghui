import { useEffect } from "react"
import type { PullRequestItem } from "../domain.js"
import type { CloseModalState, LabelModalState, MergeModalState, PullRequestStateModalState, SubmitReviewModalState } from "../ui/modals/types.js"
import type { PullRequestDiffState } from "../ui/diff.js"
import type { DetailHydrationState } from "../ui/pullRequests/useDetailHydration.js"
import { SPINNER_FRAMES } from "../ui/spinner.js"
import { useSpinnerFrame } from "../ui/useSpinnerFrame.js"

interface PullRequestLoadShape {
	readonly fetchedAt?: Date | null
}

interface PullRequestResult {
	readonly waiting: boolean
}

export interface UseLoadingStatusInput {
	readonly selectedPullRequestDetailKey: string | null
	readonly detailHydrationState: Readonly<Record<string, DetailHydrationState>>
	readonly pullRequestResult: PullRequestResult
	readonly pullRequestLoad: PullRequestLoadShape | null
	readonly pullRequestStatus: "loading" | "ready" | "error"
	readonly issuesStatus: "loading" | "ready" | "error"
	readonly isLoadingMorePullRequests: boolean
	readonly issueFetchInFlight: boolean
	readonly isLoadingMoreIssues: boolean
	readonly activeWorkspaceSurface: "pullRequests" | "issues" | "repos"
	readonly selectedCommentsStatus: "idle" | "loading" | "ready"
	readonly selectedDiffState: PullRequestDiffState | undefined
	readonly labelModal: LabelModalState
	readonly closeModal: CloseModalState
	readonly pullRequestStateModal: PullRequestStateModalState
	readonly mergeModal: MergeModalState
	readonly submitReviewModal: SubmitReviewModalState
	readonly isInitialLoading: boolean
	readonly startupLoadComplete: boolean
	readonly setStartupLoadComplete: (next: boolean) => void
	readonly selectedPullRequest: PullRequestItem | null
	readonly loadPullRequestComments: (pr: PullRequestItem) => void
}

export interface LoadingStatus {
	readonly selectedPullRequestDetailError: string | null
	readonly isHydratingPullRequestDetails: boolean
	readonly isRefreshingPullRequests: boolean
	readonly isActiveSurfaceLoading: boolean
	readonly hasActiveLoadingIndicator: boolean
	readonly loadingFrame: number
	readonly loadingIndicator: string
}

/**
 * Derives the four cross-cutting "is something loading?" booleans plus
 * the spinner frame the footer and headers consult. Also pumps the
 * one-shot startup completion flag and the per-PR comments load. The
 * inputs are wide because loading state is collated from a dozen
 * independent sources; the seam is worth it because callers read a
 * tight bundle instead of recomputing the union inline.
 */
export const useLoadingStatus = ({
	selectedPullRequestDetailKey,
	detailHydrationState,
	pullRequestResult,
	pullRequestLoad,
	pullRequestStatus,
	issuesStatus,
	isLoadingMorePullRequests,
	issueFetchInFlight,
	isLoadingMoreIssues,
	activeWorkspaceSurface,
	selectedCommentsStatus,
	selectedDiffState,
	labelModal,
	closeModal,
	pullRequestStateModal,
	mergeModal,
	submitReviewModal,
	isInitialLoading,
	startupLoadComplete,
	setStartupLoadComplete,
	selectedPullRequest,
	loadPullRequestComments,
}: UseLoadingStatusInput): LoadingStatus => {
	const selectedPullRequestDetailHydrationState = selectedPullRequestDetailKey ? (detailHydrationState[selectedPullRequestDetailKey] ?? null) : null
	const selectedPullRequestDetailError = selectedPullRequestDetailHydrationState?._tag === "Error" ? (selectedPullRequestDetailHydrationState.message ?? null) : null
	const isHydratingPullRequestDetails = selectedPullRequestDetailHydrationState?._tag === "Loading"
	const isRefreshingPullRequests = pullRequestResult.waiting && pullRequestLoad !== null
	const isActiveSurfaceLoading =
		(activeWorkspaceSurface === "pullRequests" && (pullRequestStatus === "loading" || isRefreshingPullRequests || isHydratingPullRequestDetails || isLoadingMorePullRequests)) ||
		(activeWorkspaceSurface === "issues" && (issuesStatus === "loading" || issueFetchInFlight || isLoadingMoreIssues))
	const hasActiveLoadingIndicator =
		pullRequestResult.waiting ||
		isHydratingPullRequestDetails ||
		isLoadingMorePullRequests ||
		(activeWorkspaceSurface === "issues" && (issueFetchInFlight || isLoadingMoreIssues)) ||
		selectedCommentsStatus === "loading" ||
		labelModal.loading ||
		closeModal.running ||
		pullRequestStateModal.running ||
		mergeModal.loading ||
		mergeModal.running ||
		submitReviewModal.running ||
		selectedDiffState?._tag === "Loading"
	const loadingFrame = useSpinnerFrame({ active: hasActiveLoadingIndicator, reset: isInitialLoading })
	const loadingIndicator = SPINNER_FRAMES[loadingFrame % SPINNER_FRAMES.length]!

	useEffect(() => {
		if (startupLoadComplete || pullRequestStatus === "loading") return
		setStartupLoadComplete(true)
	}, [startupLoadComplete, pullRequestStatus, setStartupLoadComplete])

	useEffect(() => {
		if (pullRequestStatus !== "ready" || !selectedPullRequest) return
		loadPullRequestComments(selectedPullRequest)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pullRequestStatus, selectedPullRequest?.url, selectedPullRequest?.headRefOid, selectedPullRequest?.repository, selectedPullRequest?.number])

	return {
		selectedPullRequestDetailError,
		isHydratingPullRequestDetails,
		isRefreshingPullRequests,
		isActiveSurfaceLoading,
		hasActiveLoadingIndicator,
		loadingFrame,
		loadingIndicator,
	}
}
