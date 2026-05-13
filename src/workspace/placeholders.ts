import type { LoadStatus, PullRequestItem, SubmitPullRequestReviewInput } from "../domain.js"
import type { DetailPlaceholderContent } from "../ui/DetailsPane.js"
import type { RetryProgress } from "../ui/FooterHints.js"

export const FOCUS_RETURN_REFRESH_MIN_MS = 60_000
export const FOCUSED_IDLE_REFRESH_MS = 5 * 60_000
export const AUTO_REFRESH_JITTER_MS = 10_000

export const reviewStatusAfterSubmit = {
	COMMENT: null,
	APPROVE: "approved",
	REQUEST_CHANGES: "changes",
} satisfies Record<SubmitPullRequestReviewInput["event"], PullRequestItem["reviewStatus"] | null>

export interface DetailPlaceholderInput {
	readonly status: LoadStatus
	readonly retryProgress: RetryProgress
	readonly loadingIndicator: string
	readonly visibleCount: number
	readonly filterText: string
}

export const getDetailPlaceholderContent = ({ status, retryProgress, loadingIndicator, visibleCount, filterText }: DetailPlaceholderInput): DetailPlaceholderContent => {
	if (status === "loading") {
		return {
			title: `${loadingIndicator} Loading pull requests`,
			hint: retryProgress._tag === "Retrying" ? `Retry ${retryProgress.attempt}/${retryProgress.max}` : "Fetching latest open PRs",
		}
	}
	if (status === "error") {
		return { title: "Could not load pull requests", hint: "Press r to retry" }
	}
	if (visibleCount === 0 && filterText.length > 0) {
		return { title: "No matching pull requests", hint: "Press esc to clear the filter" }
	}
	if (visibleCount === 0) {
		return { title: "No open pull requests", hint: "Press r to refresh" }
	}
	return { title: "Select a pull request", hint: "Use up/down to move" }
}
