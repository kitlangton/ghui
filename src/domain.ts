import { Schema } from "effect"

export type LoadStatus = "loading" | "ready" | "error"

export type PullRequestState = "open" | "closed" | "merged"

export const pullRequestQueueModes = ["authored", "review", "assigned", "mentioned"] as const
export type PullRequestUserQueueMode = (typeof pullRequestQueueModes)[number]
export type PullRequestQueueMode = "repository" | PullRequestUserQueueMode

export const pullRequestQueueLabels = {
	repository: "repository",
	authored: "authored",
	review: "review requested",
	assigned: "assigned",
	mentioned: "mentioned",
} as const satisfies Record<PullRequestQueueMode, string>

export const pullRequestQueueSearchQualifier = (mode: PullRequestQueueMode, author: string, repository: string | null) => {
	const qualifiers = {
		repository: repository ? `repo:${repository}` : `author:${author}`,
		authored: `author:${author}`,
		review: "review-requested:@me",
		assigned: "assignee:@me",
		mentioned: "mentions:@me",
	} as const satisfies Record<PullRequestQueueMode, string>
	return qualifiers[mode]
}

export type CheckConclusion = "success" | "failure" | "neutral" | "skipped" | "cancelled" | "timed_out"

export type CheckRunStatus = "completed" | "in_progress" | "queued" | "pending"

export type CheckRollupStatus = "passing" | "pending" | "failing" | "none"

export type ReviewStatus = "draft" | "approved" | "changes" | "review" | "none"

export type Mergeable = "mergeable" | "conflicting" | "unknown"

// DiffCommentSide is the only literal type still consumed at runtime — GitHubService
// uses it as a Schema inside PullRequestCommentSchema.
export const DiffCommentSide = Schema.Literals(["LEFT", "RIGHT"])
export type DiffCommentSide = Schema.Schema.Type<typeof DiffCommentSide>

export type PullRequestMergeAction = "squash" | "auto" | "admin" | "disable-auto"

export interface CheckItem {
	readonly name: string
	readonly status: CheckRunStatus
	readonly conclusion: CheckConclusion | null
}

export interface PullRequestLabel {
	readonly name: string
	readonly color: string | null
}

export interface CreatePullRequestCommentInput {
	readonly repository: string
	readonly number: number
	readonly commitId: string
	readonly path: string
	readonly line: number
	readonly side: DiffCommentSide
	readonly body: string
}

export interface PullRequestReviewComment {
	readonly id: string
	readonly path: string
	readonly line: number
	readonly side: DiffCommentSide
	readonly author: string
	readonly body: string
	readonly createdAt: Date | null
	readonly url: string | null
}

export interface PullRequestItem {
	readonly repository: string
	readonly author: string
	readonly headRefOid: string
	readonly number: number
	readonly title: string
	readonly body: string
	readonly labels: readonly PullRequestLabel[]
	readonly additions: number
	readonly deletions: number
	readonly changedFiles: number
	readonly state: PullRequestState
	readonly reviewStatus: ReviewStatus
	readonly checkStatus: CheckRollupStatus
	readonly checkSummary: string | null
	readonly checks: readonly CheckItem[]
	readonly autoMergeEnabled: boolean
	readonly detailLoaded: boolean
	readonly createdAt: Date
	readonly closedAt: Date | null
	readonly url: string
}

export interface PullRequestPage {
	readonly items: readonly PullRequestItem[]
	readonly endCursor: string | null
	readonly hasNextPage: boolean
}

export interface ListPullRequestPageInput {
	readonly mode: PullRequestQueueMode
	readonly repository: string | null
	readonly cursor: string | null
	readonly pageSize: number
}

export interface PullRequestMergeInfo {
	readonly repository: string
	readonly number: number
	readonly title: string
	readonly state: PullRequestState
	readonly isDraft: boolean
	readonly mergeable: Mergeable
	readonly reviewStatus: ReviewStatus
	readonly checkStatus: CheckRollupStatus
	readonly checkSummary: string | null
	readonly autoMergeEnabled: boolean
}
