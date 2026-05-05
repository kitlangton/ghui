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
	return mode === "repository" && repository ? qualifier : `${qualifier} archived:false`
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

export const makeLatestValues = ["true", "false", "legacy"] as const
export type MakeLatest = (typeof makeLatestValues)[number]

export interface Tag {
	readonly name: string
	readonly commitSha: string
}

export interface Branch {
	readonly name: string
	readonly commitSha: string
	readonly isDefault: boolean
}

export interface DiscussionCategory {
	readonly id: string
	readonly name: string
	readonly slug: string
	readonly emoji: string | null
}

export interface ReleaseAuthor {
	readonly login: string
}

export interface ReleaseAsset {
	readonly id: number
	readonly name: string
	readonly label: string | null
	readonly size: number
	readonly downloadCount: number
	readonly contentType: string
	readonly downloadUrl: string
	readonly htmlUrl: string | null
	readonly createdAt: Date | null
	readonly updatedAt: Date | null
}

export interface ReleaseSummary {
	readonly id: number
	readonly tagName: string
	readonly name: string | null
	readonly isDraft: boolean
	readonly isPrerelease: boolean
	readonly targetCommitish: string
	readonly author: ReleaseAuthor | null
	readonly createdAt: Date | null
	readonly publishedAt: Date | null
	readonly htmlUrl: string
}

export interface Release extends ReleaseSummary {
	readonly body: string
	readonly assets: readonly ReleaseAsset[]
	readonly discussionUrl: string | null
}

export interface ReleasePage {
	readonly items: readonly ReleaseSummary[]
	readonly hasNextPage: boolean
	readonly nextPage: number | null
}

export interface CreateReleaseInput {
	readonly tagName: string
	readonly targetCommitish?: string
	readonly name?: string
	readonly body?: string
	readonly draft?: boolean
	readonly prerelease?: boolean
	readonly makeLatest?: MakeLatest
	readonly discussionCategoryName?: string
	readonly generateReleaseNotes?: boolean
}

export interface UpdateReleaseInput {
	readonly tagName?: string
	readonly targetCommitish?: string
	readonly name?: string
	readonly body?: string
	readonly draft?: boolean
	readonly prerelease?: boolean
	readonly makeLatest?: MakeLatest
	readonly discussionCategoryName?: string
}

export interface GenerateReleaseNotesInput {
	readonly tagName: string
	readonly previousTagName?: string
	readonly targetCommitish?: string
	readonly configurationFilePath?: string
}

export interface GeneratedReleaseNotes {
	readonly name: string
	readonly body: string
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
}
