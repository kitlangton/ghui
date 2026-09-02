import { Schema } from "effect"

export type LoadStatus = "loading" | "ready" | "error"

export const pullRequestStates = ["open", "closed", "merged"] as const
export type PullRequestState = (typeof pullRequestStates)[number]

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

export const pullRequestQueueSearchQualifier = (mode: PullRequestQueueMode, repository: string | null) => {
	const qualifiers = {
		repository: repository ? `repo:${repository}` : "author:@me",
		authored: "author:@me",
		review: "review-requested:@me",
		assigned: "assignee:@me",
		mentioned: "mentions:@me",
	} as const satisfies Record<PullRequestQueueMode, string>
	const qualifier = qualifiers[mode]
	const repositoryQualifier = mode === "repository" || !repository ? "" : ` repo:${repository}`
	return mode === "repository" && repository ? qualifier : `${qualifier}${repositoryQualifier} archived:false`
}

export const checkConclusions = ["success", "failure", "neutral", "skipped", "cancelled", "timed_out"] as const
export type CheckConclusion = (typeof checkConclusions)[number]

export const checkRunStatuses = ["completed", "in_progress", "queued", "pending"] as const
export type CheckRunStatus = (typeof checkRunStatuses)[number]

export const checkRollupStatuses = ["passing", "pending", "failing", "none"] as const
export type CheckRollupStatus = (typeof checkRollupStatuses)[number]

export const reviewStatuses = ["draft", "approved", "changes", "review", "none"] as const
export type ReviewStatus = (typeof reviewStatuses)[number]

export type Mergeable = "mergeable" | "conflicting" | "unknown"

// DiffCommentSide is the only literal type still consumed at runtime — GitHubService
// uses it as a Schema inside PullRequestCommentSchema.
export const DiffCommentSide = Schema.Literals(["LEFT", "RIGHT"])
export type DiffCommentSide = Schema.Schema.Type<typeof DiffCommentSide>

export const pullRequestMergeMethods = ["squash", "merge", "rebase"] as const
export type PullRequestMergeMethod = (typeof pullRequestMergeMethods)[number]

export const pullRequestMergeKinds = ["now", "auto", "admin", "disable-auto"] as const
export type PullRequestMergeKind = (typeof pullRequestMergeKinds)[number]
export type PullRequestMergeMethodKind = Exclude<PullRequestMergeKind, "disable-auto">

export type PullRequestMergeAction =
	| {
			readonly kind: PullRequestMergeMethodKind
			readonly method: PullRequestMergeMethod
			readonly mergeQueueEnabled: boolean
	  }
	| {
			readonly kind: "disable-auto"
	  }

export interface RepositoryMergeMethods {
	readonly squash: boolean
	readonly merge: boolean
	readonly rebase: boolean
}

export const allowedMergeMethodList = (allowed: RepositoryMergeMethods): readonly PullRequestMergeMethod[] => pullRequestMergeMethods.filter((method) => allowed[method])

export const pullRequestReviewEvents = ["COMMENT", "APPROVE", "REQUEST_CHANGES"] as const
export type PullRequestReviewEvent = (typeof pullRequestReviewEvents)[number]

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
	readonly startLine?: number
	readonly startSide?: DiffCommentSide
	readonly body: string
}

export interface SubmitPullRequestReviewInput {
	readonly repository: string
	readonly number: number
	readonly event: PullRequestReviewEvent
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
	readonly inReplyTo: string | null
}

export type PullRequestComment =
	| {
			readonly _tag: "comment"
			readonly id: string
			readonly author: string
			readonly body: string
			readonly createdAt: Date | null
			readonly url: string | null
	  }
	| ({ readonly _tag: "review-comment" } & PullRequestReviewComment)

export const isReviewComment = (comment: PullRequestComment): comment is PullRequestComment & { readonly _tag: "review-comment" } => comment._tag === "review-comment"
export const isIssueComment = (comment: PullRequestComment): comment is PullRequestComment & { readonly _tag: "comment" } => comment._tag === "comment"

export interface PullRequestItem {
	readonly repository: string
	readonly author: string
	readonly headRefOid: string
	readonly headRefName: string
	readonly baseRefName: string
	readonly defaultBranchName: string
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
	readonly updatedAt: Date
	readonly closedAt: Date | null
	readonly url: string
}

// === Workflow runs (GitHub Actions) ===
//
// Modeled after `gh run list` / `gh run view --json jobs`. A WorkflowRun is one
// run of a workflow on a commit; jobs carry steps. Scoped per-PR by head SHA in
// the runs view.

export const runStatuses = ["queued", "in_progress", "completed"] as const
export type RunStatus = (typeof runStatuses)[number]

export const runConclusions = ["success", "failure", "cancelled", "skipped", "neutral", "timed_out", "action_required", "stale"] as const
export type RunConclusion = (typeof runConclusions)[number] | null

export interface RunStep {
	readonly number: number
	readonly name: string
	readonly status: RunStatus
	readonly conclusion: RunConclusion
	readonly startedAt: Date | null
	readonly completedAt: Date | null
}

export interface RunJob {
	readonly id: number
	readonly name: string
	readonly status: RunStatus
	readonly conclusion: RunConclusion
	readonly startedAt: Date | null
	readonly completedAt: Date | null
	readonly url: string
	readonly steps: readonly RunStep[]
}

export interface WorkflowRun {
	readonly id: number
	readonly number: number
	readonly attempt: number
	readonly workflowName: string
	readonly displayTitle: string
	readonly event: string
	readonly headBranch: string
	readonly headSha: string
	readonly status: RunStatus
	readonly conclusion: RunConclusion
	readonly url: string
	readonly createdAt: Date
	readonly startedAt: Date | null
	readonly updatedAt: Date | null
}

export interface WorkflowRunDetails extends WorkflowRun {
	readonly jobs: readonly RunJob[]
}

export interface RepositoryDetails {
	readonly repository: string
	readonly description: string | null
	readonly url: string
	readonly stargazerCount: number
	readonly forkCount: number
	readonly openIssueCount: number
	readonly openPullRequestCount: number
	readonly defaultBranch: string | null
	readonly pushedAt: Date | null
	readonly isArchived: boolean
	readonly isPrivate: boolean
}

export type IssueState = "open" | "closed"

export interface IssueItem {
	readonly repository: string
	readonly number: number
	readonly state: IssueState
	readonly title: string
	readonly body: string
	readonly author: string
	readonly labels: readonly PullRequestLabel[]
	readonly commentCount: number
	readonly createdAt: Date
	readonly updatedAt: Date
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
	readonly viewerCanMergeAsAdmin: boolean
	readonly mergeQueueEnabled: boolean
}
