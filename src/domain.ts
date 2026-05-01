import { Schema } from "effect"

export const LoadStatus = Schema.Literals(["loading", "ready", "error"])
export type LoadStatus = Schema.Schema.Type<typeof LoadStatus>

export const PullRequestState = Schema.Literals(["open", "closed", "merged"])
export type PullRequestState = Schema.Schema.Type<typeof PullRequestState>

export const PullRequestQueueMode = Schema.Literals(["authored", "review", "assigned", "mentioned"])
export type PullRequestQueueMode = Schema.Schema.Type<typeof PullRequestQueueMode>
export const pullRequestQueueModes = PullRequestQueueMode.literals

export const pullRequestQueueLabels = {
	authored: "authored",
	review: "review requested",
	assigned: "assigned",
	mentioned: "mentioned",
} as const satisfies Record<PullRequestQueueMode, string>

export const pullRequestQueueSearchQualifier = (mode: PullRequestQueueMode, author: string) => {
	const qualifiers = {
		authored: `author:${author}`,
		review: "review-requested:@me",
		assigned: "assignee:@me",
		mentioned: "mentions:@me",
	} as const satisfies Record<PullRequestQueueMode, string>
	return qualifiers[mode]
}

export const CheckConclusion = Schema.Literals(["success", "failure", "neutral", "skipped", "cancelled", "timed_out"])
export type CheckConclusion = Schema.Schema.Type<typeof CheckConclusion>

export const CheckRunStatus = Schema.Literals(["completed", "in_progress", "queued", "pending"])
export type CheckRunStatus = Schema.Schema.Type<typeof CheckRunStatus>

export const CheckRollupStatus = Schema.Literals(["passing", "pending", "failing", "none"])
export type CheckRollupStatus = Schema.Schema.Type<typeof CheckRollupStatus>

export const ReviewStatus = Schema.Literals(["draft", "approved", "changes", "review", "none"])
export type ReviewStatus = Schema.Schema.Type<typeof ReviewStatus>

export const Mergeable = Schema.Literals(["mergeable", "conflicting", "unknown"])
export type Mergeable = Schema.Schema.Type<typeof Mergeable>

export const DiffCommentSide = Schema.Literals(["LEFT", "RIGHT"])
export type DiffCommentSide = Schema.Schema.Type<typeof DiffCommentSide>

export const PullRequestMergeAction = Schema.Literals(["squash", "auto", "admin", "disable-auto"])
export type PullRequestMergeAction = Schema.Schema.Type<typeof PullRequestMergeAction>

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

export type PullRequestCommentKey = `${string}#${number}`

export const pullRequestCommentKey = (pullRequest: Pick<PullRequestItem, "repository" | "number">): PullRequestCommentKey =>
	`${pullRequest.repository}#${pullRequest.number}`

export type PullRequestCommentKind = "issue" | "thread"

export interface PullRequestCommentContext {
	readonly path: string
	readonly line: number | null
	readonly originalLine: number | null
	readonly resolved?: boolean | null
}

export interface PullRequestComment {
	readonly id: string
	readonly databaseId: number | null
	readonly kind: PullRequestCommentKind
	readonly author: string
	readonly body: string
	readonly createdAt: Date
	readonly updatedAt: Date
	readonly htmlUrl: string
	readonly context: PullRequestCommentContext | null
	readonly threadId: string | null
	readonly parentId: string | null
	readonly depth: number
}
