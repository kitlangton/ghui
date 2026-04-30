export type PullRequestState = "open" | "closed"

export type CheckConclusion = "success" | "failure" | "neutral" | "skipped" | "cancelled" | "timed_out"

export interface CheckItem {
	readonly name: string
	readonly status: "completed" | "in_progress" | "queued" | "pending"
	readonly conclusion: CheckConclusion | null
}

export interface PullRequestLabel {
	readonly name: string
	readonly color: string | null
}

export interface PullRequestItem {
	readonly repository: string
	readonly number: number
	readonly title: string
	readonly body: string
	readonly labels: readonly PullRequestLabel[]
	readonly additions: number
	readonly deletions: number
	readonly changedFiles: number
	readonly state: PullRequestState
	readonly reviewStatus: "draft" | "approved" | "changes" | "review" | "none"
	readonly checkStatus: "passing" | "pending" | "failing" | "none"
	readonly checkSummary: string | null
	readonly checks: readonly CheckItem[]
	readonly autoMergeEnabled: boolean
	readonly detailLoaded: boolean
	readonly createdAt: Date
	readonly closedAt: Date | null
	readonly url: string
}

export interface PullRequestMergeInfo {
	readonly repository: string
	readonly number: number
	readonly title: string
	readonly state: PullRequestState
	readonly isDraft: boolean
	readonly mergeable: "mergeable" | "conflicting" | "unknown"
	readonly reviewStatus: PullRequestItem["reviewStatus"]
	readonly checkStatus: PullRequestItem["checkStatus"]
	readonly checkSummary: string | null
	readonly autoMergeEnabled: boolean
}

export type PullRequestMergeAction = "squash" | "auto" | "admin" | "disable-auto"
