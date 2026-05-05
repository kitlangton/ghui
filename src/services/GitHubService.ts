import { Context, Effect, Layer, Schema } from "effect"
import { config } from "../config.js"
import {
	DiffCommentSide,
	pullRequestQueueSearchQualifier,
	type Branch,
	type CheckItem,
	type CreatePullRequestCommentInput,
	type CreateReleaseInput,
	type DiscussionCategory,
	type GeneratedReleaseNotes,
	type GenerateReleaseNotesInput,
	type ListPullRequestPageInput,
	type Mergeable,
	type PullRequestComment,
	type PullRequestItem,
	type PullRequestMergeAction,
	type PullRequestMergeInfo,
	type PullRequestPage,
	type PullRequestQueueMode,
	type PullRequestReviewComment,
	type Release,
	type ReleasePage,
	type ReleaseSummary,
	type RepositoryMergeMethods,
	type ReviewStatus,
	type SubmitPullRequestReviewInput,
	type Tag,
	type UpdateReleaseInput,
} from "../domain.js"
import { mergeActionCliArgs } from "../mergeActions.js"
import { CommandError, CommandRunner, type JsonParseError } from "./CommandRunner.js"

const NullableString = Schema.NullOr(Schema.String)
const OptionalNullableString = Schema.optionalKey(NullableString)
const OptionalNullableNumber = Schema.optionalKey(Schema.NullOr(Schema.Number))

const RawCheckContextSchema = Schema.Union([
	Schema.Struct({
		__typename: Schema.tag("CheckRun"),
		name: OptionalNullableString,
		status: OptionalNullableString,
		conclusion: OptionalNullableString,
	}),
	Schema.Struct({
		__typename: Schema.tag("StatusContext"),
		context: OptionalNullableString,
		state: OptionalNullableString,
	}),
]).pipe(Schema.toTaggedUnion("__typename"))

const RawAuthorSchema = Schema.Struct({ login: Schema.String })
const RawRepositorySchema = Schema.Struct({ nameWithOwner: Schema.String })
const RawLabelSchema = Schema.Struct({
	name: Schema.String,
	color: OptionalNullableString,
})

const RawStatusCheckRollupSchema = Schema.Struct({
	contexts: Schema.Struct({ nodes: Schema.Array(RawCheckContextSchema) }),
})

const RawPullRequestSummaryFields = {
	number: Schema.Number,
	title: Schema.String,
	isDraft: Schema.Boolean,
	reviewDecision: NullableString,
	autoMergeRequest: Schema.NullOr(Schema.Unknown),
	state: Schema.String,
	merged: Schema.Boolean,
	createdAt: Schema.String,
	closedAt: OptionalNullableString,
	url: Schema.String,
	author: RawAuthorSchema,
	headRefOid: Schema.String,
	repository: RawRepositorySchema,
} as const

const RawPullRequestSummaryNodeSchema = Schema.Struct({
	...RawPullRequestSummaryFields,
	statusCheckRollup: Schema.optionalKey(Schema.NullOr(RawStatusCheckRollupSchema)),
})

const RawPullRequestNodeSchema = Schema.Struct({
	...RawPullRequestSummaryFields,
	body: Schema.String,
	labels: Schema.Struct({ nodes: Schema.Array(RawLabelSchema) }),
	additions: Schema.Number,
	deletions: Schema.Number,
	changedFiles: Schema.Number,
	statusCheckRollup: Schema.optionalKey(Schema.NullOr(RawStatusCheckRollupSchema)),
})

const PullRequestDetailResponseSchema = Schema.Struct({
	data: Schema.Struct({
		repository: Schema.NullOr(
			Schema.Struct({
				pullRequest: Schema.NullOr(RawPullRequestNodeSchema),
			}),
		),
	}),
})

const PageInfoSchema = Schema.Struct({
	hasNextPage: Schema.Boolean,
	endCursor: NullableString,
})

const SearchResponseSchema = <Item extends Schema.Top>(item: Item) =>
	Schema.Struct({
		data: Schema.Struct({
			search: Schema.Struct({
				nodes: Schema.Array(Schema.NullOr(item)),
				pageInfo: PageInfoSchema,
			}),
		}),
	})

const RepositoryPullRequestsResponseSchema = Schema.Struct({
	data: Schema.Struct({
		repository: Schema.NullOr(
			Schema.Struct({
				pullRequests: Schema.Struct({
					nodes: Schema.Array(Schema.NullOr(RawPullRequestSummaryNodeSchema)),
					pageInfo: PageInfoSchema,
				}),
			}),
		),
	}),
})

const ViewerSchema = Schema.Struct({ login: Schema.String })

const RepositoryMergeMethodsResponseSchema = Schema.Struct({
	squashMergeAllowed: Schema.Boolean,
	mergeCommitAllowed: Schema.Boolean,
	rebaseMergeAllowed: Schema.Boolean,
})

const MergeInfoResponseSchema = Schema.Struct({
	number: Schema.Number,
	title: Schema.String,
	state: Schema.String,
	isDraft: Schema.Boolean,
	mergeable: Schema.String,
	reviewDecision: NullableString,
	autoMergeRequest: Schema.NullOr(Schema.Unknown),
	statusCheckRollup: Schema.Array(RawCheckContextSchema),
})

const PullRequestAdminMergeResponseSchema = Schema.Struct({
	data: Schema.Struct({
		repository: Schema.Struct({
			pullRequest: Schema.NullOr(Schema.Struct({ viewerCanMergeAsAdmin: Schema.Boolean })),
		}),
	}),
})

const PullRequestCommentSchema = Schema.Struct({
	id: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.Number, Schema.String]))),
	node_id: OptionalNullableString,
	body: OptionalNullableString,
	html_url: OptionalNullableString,
	url: OptionalNullableString,
	created_at: OptionalNullableString,
	user: Schema.optionalKey(
		Schema.NullOr(
			Schema.Struct({
				login: OptionalNullableString,
			}),
		),
	),
	path: OptionalNullableString,
	line: OptionalNullableNumber,
	original_line: OptionalNullableNumber,
	side: Schema.optionalKey(Schema.NullOr(DiffCommentSide)),
	in_reply_to_id: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.Number, Schema.String]))),
})

const PullRequestFileSchema = Schema.Struct({
	filename: Schema.String,
	previous_filename: OptionalNullableString,
	status: OptionalNullableString,
	patch: OptionalNullableString,
})

const CommentsResponseSchema = Schema.Union([Schema.Array(PullRequestCommentSchema), Schema.Array(Schema.Array(PullRequestCommentSchema))])

const PullRequestFilesResponseSchema = Schema.Union([Schema.Array(PullRequestFileSchema), Schema.Array(Schema.Array(PullRequestFileSchema))])

const RepoLabelsResponseSchema = Schema.Array(
	Schema.Struct({
		name: Schema.String,
		color: Schema.String,
	}),
)

const ReleaseAuthorSchema = Schema.NullOr(Schema.Struct({ login: Schema.String }))

const ReleaseAssetSchema = Schema.Struct({
	id: Schema.Number,
	name: Schema.String,
	label: OptionalNullableString,
	size: Schema.Number,
	download_count: Schema.Number,
	content_type: Schema.String,
	browser_download_url: Schema.String,
	url: Schema.String,
	created_at: OptionalNullableString,
	updated_at: OptionalNullableString,
})

const ReleaseSchema = Schema.Struct({
	id: Schema.Number,
	tag_name: Schema.String,
	target_commitish: Schema.String,
	name: NullableString,
	body: Schema.NullOr(Schema.String).pipe(Schema.optionalKey),
	draft: Schema.Boolean,
	prerelease: Schema.Boolean,
	created_at: OptionalNullableString,
	published_at: OptionalNullableString,
	html_url: Schema.String,
	discussion_url: OptionalNullableString,
	author: ReleaseAuthorSchema,
	assets: Schema.optionalKey(Schema.Array(ReleaseAssetSchema)),
})

const ReleaseListResponseSchema = Schema.Array(ReleaseSchema)

const TagSchema = Schema.Struct({
	name: Schema.String,
	commit: Schema.Struct({ sha: Schema.String }),
})
const TagListResponseSchema = Schema.Union([Schema.Array(TagSchema), Schema.Array(Schema.Array(TagSchema))])

const BranchSchema = Schema.Struct({
	name: Schema.String,
	commit: Schema.Struct({ sha: Schema.String }),
})
const BranchListResponseSchema = Schema.Union([Schema.Array(BranchSchema), Schema.Array(Schema.Array(BranchSchema))])

const RepositoryMetaSchema = Schema.Struct({ default_branch: Schema.String })

const GenerateReleaseNotesResponseSchema = Schema.Struct({
	name: Schema.String,
	body: Schema.String,
})

const DiscussionCategoriesResponseSchema = Schema.Struct({
	data: Schema.Struct({
		repository: Schema.NullOr(
			Schema.Struct({
				hasDiscussionsEnabled: Schema.Boolean,
				discussionCategories: Schema.Struct({
					nodes: Schema.Array(
						Schema.Struct({
							id: Schema.String,
							name: Schema.String,
							slug: Schema.String,
							emoji: OptionalNullableString,
						}),
					),
				}),
			}),
		),
	}),
})

type RawPullRequestSummaryNode = Schema.Schema.Type<typeof RawPullRequestSummaryNodeSchema>
type RawPullRequestNode = Schema.Schema.Type<typeof RawPullRequestNodeSchema>
type RawCheckContext = Schema.Schema.Type<typeof RawCheckContextSchema>
type RawPullRequestComment = Schema.Schema.Type<typeof PullRequestCommentSchema>
type RawPullRequestFile = Schema.Schema.Type<typeof PullRequestFileSchema>

type SearchResponse<Item> = {
	readonly data: {
		readonly search: {
			readonly nodes: readonly (Item | null)[]
			readonly pageInfo: {
				readonly hasNextPage: boolean
				readonly endCursor: string | null
			}
		}
	}
}

type PullRequestConnection<Item> = {
	readonly nodes: readonly (Item | null)[]
	readonly pageInfo: {
		readonly hasNextPage: boolean
		readonly endCursor: string | null
	}
}

const STATUS_CHECK_FRAGMENT = `
        statusCheckRollup {
          contexts(first: 100) {
            nodes {
              __typename
              ... on CheckRun { name status conclusion }
              ... on StatusContext { context state }
            }
          }
        }`

const SUMMARY_FIELDS_FRAGMENT = `
        number
        title
        isDraft
        reviewDecision
        autoMergeRequest { enabledAt }
        state
        merged
        createdAt
        closedAt
        url
        author { login }
        headRefOid
        repository { nameWithOwner }${STATUS_CHECK_FRAGMENT}`

const DETAIL_FIELDS_FRAGMENT = `
        number
        title
        body
        isDraft
        reviewDecision
        autoMergeRequest { enabledAt }
        additions
        deletions
        changedFiles
        state
        merged
        createdAt
        closedAt
        url
        author { login }
        headRefOid
        repository { nameWithOwner }
        labels(first: 20) { nodes { name color } }${STATUS_CHECK_FRAGMENT}`

const pullRequestSearchQuery = `
query PullRequests($searchQuery: String!, $first: Int!, $after: String) {
  search(query: $searchQuery, type: ISSUE, first: $first, after: $after) {
    nodes {
      ... on PullRequest {${DETAIL_FIELDS_FRAGMENT}
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
`

const pullRequestDetailQuery = `
query PullRequest($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {${DETAIL_FIELDS_FRAGMENT}
    }
  }
}
`

const pullRequestSummarySearchQuery = `
query PullRequests($searchQuery: String!, $first: Int!, $after: String) {
  search(query: $searchQuery, type: ISSUE, first: $first, after: $after) {
    nodes {
      ... on PullRequest {${SUMMARY_FIELDS_FRAGMENT}
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
`

const repositoryPullRequestsQuery = `
query RepositoryPullRequests($owner: String!, $name: String!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: $first, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {${SUMMARY_FIELDS_FRAGMENT}
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
`

const normalizeDate = (value: string | null | undefined) => {
	if (!value || value.startsWith("0001-01-01")) return null
	return new Date(value)
}

const getPullRequestState = (item: { readonly state: string; readonly merged: boolean }): PullRequestItem["state"] =>
	item.merged ? "merged" : item.state.toLowerCase() === "open" ? "open" : "closed"

const REVIEW_STATUS_BY_DECISION: Record<string, ReviewStatus> = {
	APPROVED: "approved",
	CHANGES_REQUESTED: "changes",
	REVIEW_REQUIRED: "review",
}

const getReviewStatus = (item: { readonly isDraft: boolean; readonly reviewDecision: string | null }): ReviewStatus => {
	if (item.isDraft) return "draft"
	if (item.reviewDecision) return REVIEW_STATUS_BY_DECISION[item.reviewDecision] ?? "none"
	return "none"
}

const CHECK_STATUS_BY_RAW: Record<string, CheckItem["status"]> = {
	COMPLETED: "completed",
	IN_PROGRESS: "in_progress",
	QUEUED: "queued",
}

const CHECK_CONCLUSION_BY_RAW: Record<string, NonNullable<CheckItem["conclusion"]>> = {
	SUCCESS: "success",
	FAILURE: "failure",
	ERROR: "failure",
	NEUTRAL: "neutral",
	SKIPPED: "skipped",
	CANCELLED: "cancelled",
	TIMED_OUT: "timed_out",
}

const normalizeCheckStatus = (raw: string | null | undefined): CheckItem["status"] => (raw ? (CHECK_STATUS_BY_RAW[raw] ?? "pending") : "pending")

const normalizeCheckConclusion = (raw: string | null | undefined): CheckItem["conclusion"] => (raw ? (CHECK_CONCLUSION_BY_RAW[raw] ?? null) : null)

const getContextStatus = (context: RawCheckContext): CheckItem["status"] =>
	RawCheckContextSchema.match(context, {
		CheckRun: (run) => normalizeCheckStatus(run.status),
		StatusContext: (status) => (status.state === "PENDING" ? "in_progress" : "completed"),
	})

const STATUS_CONTEXT_CONCLUSION: Record<string, NonNullable<CheckItem["conclusion"]>> = {
	SUCCESS: "success",
	FAILURE: "failure",
	ERROR: "failure",
}

const getContextConclusion = (context: RawCheckContext): CheckItem["conclusion"] =>
	RawCheckContextSchema.match(context, {
		CheckRun: (run) => normalizeCheckConclusion(run.conclusion),
		StatusContext: (status) => (status.state ? STATUS_CONTEXT_CONCLUSION[status.state] : null) ?? null,
	})

const getCheckInfoFromContexts = (contexts: readonly RawCheckContext[]): Pick<PullRequestItem, "checkStatus" | "checkSummary" | "checks"> => {
	if (contexts.length === 0) {
		return { checkStatus: "none", checkSummary: null, checks: [] }
	}

	let completed = 0
	let successful = 0
	let pending = false
	let failing = false
	const checks: CheckItem[] = []

	for (const check of contexts) {
		const name = check.__typename === "CheckRun" ? (check.name ?? "check") : (check.context ?? "check")
		const status = getContextStatus(check)
		const conclusion = getContextConclusion(check)

		checks.push({ name, status, conclusion })

		if (status === "completed") {
			completed += 1
		} else {
			pending = true
		}

		if (conclusion === "success" || conclusion === "neutral" || conclusion === "skipped") {
			successful += 1
		} else if (conclusion) {
			failing = true
		}
	}

	if (pending) {
		return { checkStatus: "pending", checkSummary: `checks ${completed}/${contexts.length}`, checks }
	}

	if (failing) {
		return { checkStatus: "failing", checkSummary: `checks ${successful}/${contexts.length}`, checks }
	}

	return { checkStatus: "passing", checkSummary: `checks ${successful}/${contexts.length}`, checks }
}

const parsePullRequestSummary = (item: RawPullRequestSummaryNode): PullRequestItem => {
	const checkInfo = getCheckInfoFromContexts(item.statusCheckRollup?.contexts.nodes ?? [])
	return {
		repository: item.repository.nameWithOwner,
		author: item.author.login,
		headRefOid: item.headRefOid,
		number: item.number,
		title: item.title,
		body: "",
		labels: [],
		additions: 0,
		deletions: 0,
		changedFiles: 0,
		state: getPullRequestState(item),
		reviewStatus: getReviewStatus(item),
		checkStatus: checkInfo.checkStatus,
		checkSummary: checkInfo.checkSummary,
		checks: checkInfo.checks,
		autoMergeEnabled: item.autoMergeRequest !== null,
		detailLoaded: false,
		createdAt: new Date(item.createdAt),
		closedAt: normalizeDate(item.closedAt),
		url: item.url,
	}
}

const parsePullRequest = (item: RawPullRequestNode): PullRequestItem => {
	const checkInfo = getCheckInfoFromContexts(item.statusCheckRollup?.contexts.nodes ?? [])
	return {
		...parsePullRequestSummary(item),
		body: item.body,
		labels: item.labels.nodes.map((label) => ({
			name: label.name,
			color: label.color ? `#${label.color}` : null,
		})),
		additions: item.additions,
		deletions: item.deletions,
		changedFiles: item.changedFiles,
		checkStatus: checkInfo.checkStatus,
		checkSummary: checkInfo.checkSummary,
		checks: checkInfo.checks,
		detailLoaded: true,
	}
}

const searchQuery = (mode: PullRequestQueueMode, repository: string | null) => {
	const sort = mode === "repository" ? "sort:updated-desc" : "sort:created-desc"
	return `${pullRequestQueueSearchQualifier(mode, repository)} is:pr is:open ${sort}`
}

const pullRequestPage = <Item>(connection: PullRequestConnection<Item>, parse: (node: Item) => PullRequestItem): PullRequestPage => ({
	items: connection.nodes.flatMap((node) => (node ? [parse(node)] : [])),
	endCursor: connection.pageInfo.endCursor,
	hasNextPage: connection.pageInfo.hasNextPage && connection.pageInfo.endCursor !== null,
})

const repositoryParts = (repository: string) => {
	const [owner, name] = repository.split("/")
	return owner && name ? { owner, name } : null
}

// Pull the numeric REST comment id out of the raw payload, falling back to the
// URL (e.g. `/pulls/comments/123456789` or `#discussion_r123456789`) when the
// `id` field itself is missing. The /replies endpoint only accepts the REST
// integer id — node_id (`PRRC_…`) is a 404.
const restCommentId = (comment: RawPullRequestComment): string | null => {
	if (typeof comment.id === "number") return String(comment.id)
	if (typeof comment.id === "string" && /^\d+$/.test(comment.id)) return comment.id
	const fromApiUrl = comment.url?.match(/\/comments\/(\d+)/)?.[1]
	if (fromApiUrl) return fromApiUrl
	const fromHtmlUrl = comment.html_url?.match(/#(?:discussion_r|issuecomment-)(\d+)/)?.[1]
	if (fromHtmlUrl) return fromHtmlUrl
	return null
}

const rawCommentFields = (comment: RawPullRequestComment, fallbackId: string) => ({
	id: restCommentId(comment) ?? comment.node_id ?? fallbackId,
	author: comment.user?.login ?? "unknown",
	body: comment.body ?? "",
	createdAt: comment.created_at ? new Date(comment.created_at) : null,
	url: comment.html_url ?? comment.url ?? null,
})

const parsePullRequestComment = (comment: RawPullRequestComment): PullRequestReviewComment | null => {
	const line = comment.line ?? comment.original_line
	if (!comment.path || !line || (comment.side !== "LEFT" && comment.side !== "RIGHT")) return null
	const inReplyTo = comment.in_reply_to_id != null ? String(comment.in_reply_to_id) : null
	return {
		...rawCommentFields(comment, `${comment.path}:${comment.side}:${line}:${comment.created_at ?? ""}:${comment.body ?? ""}`),
		path: comment.path,
		line,
		side: comment.side,
		inReplyTo,
	}
}

const parsePullRequestComments = (response: Schema.Schema.Type<typeof CommentsResponseSchema>): readonly PullRequestReviewComment[] => {
	return flattenSlurpedPages(response).flatMap((comment) => {
		const parsed = parsePullRequestComment(comment)
		return parsed ? [parsed] : []
	})
}

const parseIssueComment = (comment: RawPullRequestComment): PullRequestComment => ({
	_tag: "comment",
	...rawCommentFields(comment, `${comment.created_at ?? ""}:${comment.body ?? ""}`),
})

const reviewCommentAsComment = (comment: PullRequestReviewComment): PullRequestComment => ({
	_tag: "review-comment",
	...comment,
})

const commentTime = (item: PullRequestComment) => item.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER

const sortComments = (items: readonly PullRequestComment[]) => [...items].sort((left, right) => commentTime(left) - commentTime(right) || left.id.localeCompare(right.id))

const parseIssueComments = (response: Schema.Schema.Type<typeof CommentsResponseSchema>): readonly PullRequestComment[] => flattenSlurpedPages(response).map(parseIssueComment)

const flattenSlurpedPages = <Item>(response: readonly Item[] | readonly (readonly Item[])[]): readonly Item[] =>
	Array.isArray(response[0]) ? (response as readonly (readonly Item[])[]).flat() : (response as readonly Item[])

const parsePullRequestFiles = (response: Schema.Schema.Type<typeof PullRequestFilesResponseSchema>): readonly RawPullRequestFile[] => flattenSlurpedPages(response)

const diffPath = (path: string) => (/\s|"/.test(path) ? JSON.stringify(path) : path)

const prefixedDiffPath = (prefix: "a" | "b", path: string) => diffPath(`${prefix}/${path}`)

const fileHeaderPatch = (file: RawPullRequestFile) => {
	const oldPath = file.previous_filename ?? file.filename
	const newPath = file.filename
	const oldRef = file.status === "added" ? "/dev/null" : prefixedDiffPath("a", oldPath)
	const newRef = file.status === "removed" ? "/dev/null" : prefixedDiffPath("b", newPath)
	const lines = [
		`diff --git ${prefixedDiffPath("a", oldPath)} ${prefixedDiffPath("b", newPath)}`,
		...(file.status === "renamed" && file.previous_filename ? [`rename from ${oldPath}`, `rename to ${newPath}`] : []),
		`--- ${oldRef}`,
		`+++ ${newRef}`,
	]
	if (file.patch) lines.push(file.patch.trimEnd())
	return lines.join("\n")
}

export const pullRequestFilesToPatch = (files: readonly RawPullRequestFile[]) => files.map(fileHeaderPatch).join("\n")

const fallbackCreatedComment = (input: CreatePullRequestCommentInput): PullRequestReviewComment => ({
	id: `created:${input.repository}:${input.number}:${input.path}:${input.side}:${input.line}:${Date.now()}`,
	path: input.path,
	line: input.line,
	side: input.side,
	author: "you",
	body: input.body,
	createdAt: new Date(),
	url: null,
	inReplyTo: null,
})

export type GitHubError = CommandError | JsonParseError | Schema.SchemaError

const MERGEABLE_BY_RAW: Record<string, Mergeable> = {
	MERGEABLE: "mergeable",
	CONFLICTING: "conflicting",
}

const normalizeMergeable = (value: string): Mergeable => MERGEABLE_BY_RAW[value] ?? "unknown"

const parseReleaseSummary = (raw: Schema.Schema.Type<typeof ReleaseSchema>): ReleaseSummary => ({
	id: raw.id,
	tagName: raw.tag_name,
	name: raw.name,
	isDraft: raw.draft,
	isPrerelease: raw.prerelease,
	targetCommitish: raw.target_commitish,
	author: raw.author ? { login: raw.author.login } : null,
	createdAt: normalizeDate(raw.created_at),
	publishedAt: normalizeDate(raw.published_at),
	htmlUrl: raw.html_url,
})

const parseRelease = (raw: Schema.Schema.Type<typeof ReleaseSchema>): Release => ({
	...parseReleaseSummary(raw),
	body: raw.body ?? "",
	discussionUrl: raw.discussion_url ?? null,
	assets: (raw.assets ?? []).map((asset) => ({
		id: asset.id,
		name: asset.name,
		label: asset.label ?? null,
		size: asset.size,
		downloadCount: asset.download_count,
		contentType: asset.content_type,
		downloadUrl: asset.browser_download_url,
		htmlUrl: asset.url,
		createdAt: normalizeDate(asset.created_at),
		updatedAt: normalizeDate(asset.updated_at),
	})),
})

const REVIEW_EVENT_CLI_FLAG = {
	COMMENT: "--comment",
	APPROVE: "--approve",
	REQUEST_CHANGES: "--request-changes",
} as const satisfies Record<SubmitPullRequestReviewInput["event"], string>

export class GitHubService extends Context.Service<
	GitHubService,
	{
		readonly listOpenPullRequests: (mode: PullRequestQueueMode, repository: string | null) => Effect.Effect<readonly PullRequestItem[], GitHubError>
		readonly listOpenPullRequestPage: (input: ListPullRequestPageInput) => Effect.Effect<PullRequestPage, GitHubError>
		readonly listOpenPullRequestDetails: (mode: PullRequestQueueMode, repository: string | null) => Effect.Effect<readonly PullRequestItem[], GitHubError>
		readonly getPullRequestDetails: (repository: string, number: number) => Effect.Effect<PullRequestItem, GitHubError>
		readonly getAuthenticatedUser: () => Effect.Effect<string, GitHubError>
		readonly getPullRequestDiff: (repository: string, number: number) => Effect.Effect<string, GitHubError>
		readonly listPullRequestReviewComments: (repository: string, number: number) => Effect.Effect<readonly PullRequestReviewComment[], GitHubError>
		readonly listPullRequestComments: (repository: string, number: number) => Effect.Effect<readonly PullRequestComment[], GitHubError>
		readonly getPullRequestMergeInfo: (repository: string, number: number) => Effect.Effect<PullRequestMergeInfo, GitHubError>
		readonly getRepositoryMergeMethods: (repository: string) => Effect.Effect<RepositoryMergeMethods, GitHubError>
		readonly mergePullRequest: (repository: string, number: number, action: PullRequestMergeAction) => Effect.Effect<void, CommandError>
		readonly closePullRequest: (repository: string, number: number) => Effect.Effect<void, CommandError>
		readonly createPullRequestComment: (input: CreatePullRequestCommentInput) => Effect.Effect<PullRequestReviewComment, GitHubError>
		readonly createPullRequestIssueComment: (repository: string, number: number, body: string) => Effect.Effect<PullRequestComment, GitHubError>
		readonly replyToReviewComment: (repository: string, number: number, inReplyTo: string, body: string) => Effect.Effect<PullRequestComment, GitHubError>
		readonly editPullRequestIssueComment: (repository: string, commentId: string, body: string) => Effect.Effect<PullRequestComment, GitHubError>
		readonly editReviewComment: (repository: string, commentId: string, body: string) => Effect.Effect<PullRequestComment, GitHubError>
		readonly deletePullRequestIssueComment: (repository: string, commentId: string) => Effect.Effect<void, CommandError>
		readonly deleteReviewComment: (repository: string, commentId: string) => Effect.Effect<void, CommandError>
		readonly submitPullRequestReview: (input: SubmitPullRequestReviewInput) => Effect.Effect<void, CommandError>
		readonly toggleDraftStatus: (repository: string, number: number, isDraft: boolean) => Effect.Effect<void, CommandError>
		readonly listRepoLabels: (repository: string) => Effect.Effect<readonly { readonly name: string; readonly color: string | null }[], GitHubError>
		readonly addPullRequestLabel: (repository: string, number: number, label: string) => Effect.Effect<void, CommandError>
		readonly removePullRequestLabel: (repository: string, number: number, label: string) => Effect.Effect<void, CommandError>
		readonly listReleases: (repository: string, page: number, perPage?: number) => Effect.Effect<ReleasePage, GitHubError>
		readonly getRelease: (repository: string, releaseId: number) => Effect.Effect<Release, GitHubError>
		readonly getLatestRelease: (repository: string) => Effect.Effect<Release | null, GitHubError>
		readonly listTags: (repository: string) => Effect.Effect<readonly Tag[], GitHubError>
		readonly listBranches: (repository: string) => Effect.Effect<readonly Branch[], GitHubError>
		readonly getDefaultBranch: (repository: string) => Effect.Effect<string, GitHubError>
		readonly generateReleaseNotes: (repository: string, input: GenerateReleaseNotesInput) => Effect.Effect<GeneratedReleaseNotes, GitHubError>
		readonly listDiscussionCategories: (repository: string) => Effect.Effect<readonly DiscussionCategory[], GitHubError>
		readonly createRelease: (repository: string, input: CreateReleaseInput) => Effect.Effect<Release, GitHubError>
		readonly updateRelease: (repository: string, releaseId: number, input: UpdateReleaseInput) => Effect.Effect<Release, GitHubError>
		readonly deleteRelease: (repository: string, releaseId: number) => Effect.Effect<void, CommandError>
	}
>()("ghui/GitHubService") {
	static readonly layerNoDeps = Layer.effect(
		GitHubService,
		Effect.gen(function* () {
			const command = yield* CommandRunner

			const ghJson = <S extends Schema.Top>(label: string, schema: S, args: readonly string[]) =>
				command.runSchema(schema, "gh", args).pipe(Effect.withSpan(`GitHubService.${label}`))

			const ghVoid = (label: string, args: readonly string[]) => command.run("gh", args).pipe(Effect.withSpan(`GitHubService.${label}`), Effect.asVoid)

			const searchPage = <Item extends Schema.Top>(label: string, query: string, schema: Item, parse: (node: Item["Type"]) => PullRequestItem) => {
				const responseSchema = SearchResponseSchema(schema)
				return Effect.fn(`GitHubService.${label}`)(function* (input: ListPullRequestPageInput) {
					const response: SearchResponse<Item["Type"]> = yield* command.runSchema(responseSchema, "gh", [
						"api",
						"graphql",
						"-f",
						`query=${query}`,
						"-F",
						`searchQuery=${searchQuery(input.mode, input.repository)}`,
						"-F",
						`first=${input.pageSize}`,
						...(input.cursor ? ["-F", `after=${input.cursor}`] : []),
					])
					return pullRequestPage(response.data.search, parse)
				})
			}

			const listOpenPullRequestSearchPage = searchPage("listOpenPullRequestSearchPage", pullRequestSummarySearchQuery, RawPullRequestSummaryNodeSchema, parsePullRequestSummary)
			const listOpenPullRequestDetailsPage = searchPage("listOpenPullRequestDetailsPage", pullRequestSearchQuery, RawPullRequestNodeSchema, parsePullRequest)

			const listRepositoryPullRequestPage = Effect.fn("GitHubService.listRepositoryPullRequestPage")(function* (input: ListPullRequestPageInput) {
				if (!input.repository) return { items: [], endCursor: null, hasNextPage: false } satisfies PullRequestPage
				const repo = repositoryParts(input.repository)
				if (!repo) {
					return yield* new CommandError({ command: "gh", args: [], detail: `Invalid repository: ${input.repository}`, cause: input.repository })
				}

				const response = yield* command.runSchema(RepositoryPullRequestsResponseSchema, "gh", [
					"api",
					"graphql",
					"-f",
					`query=${repositoryPullRequestsQuery}`,
					"-F",
					`owner=${repo.owner}`,
					"-F",
					`name=${repo.name}`,
					"-F",
					`first=${input.pageSize}`,
					...(input.cursor ? ["-F", `after=${input.cursor}`] : []),
				])
				const connection = response.data.repository?.pullRequests
				if (!connection) {
					return yield* new CommandError({ command: "gh", args: [], detail: `Repository not found: ${input.repository}`, cause: input.repository })
				}
				return pullRequestPage(connection, parsePullRequestSummary)
			})

			const listOpenPullRequestPage = Effect.fn("GitHubService.listOpenPullRequestPage")(function* (input: ListPullRequestPageInput) {
				const pageSize = Math.max(1, Math.min(100, input.pageSize))
				const pageInput = { ...input, pageSize }
				if (pageInput.mode === "repository" && pageInput.repository) return yield* listRepositoryPullRequestPage(pageInput)
				return yield* listOpenPullRequestSearchPage(pageInput)
			})

			const paginatePages = Effect.fn("GitHubService.paginatePages")(function* (
				mode: PullRequestQueueMode,
				repository: string | null,
				loadPage: (input: ListPullRequestPageInput) => Effect.Effect<PullRequestPage, GitHubError>,
			) {
				const pullRequests: PullRequestItem[] = []
				let cursor: string | null = null

				while (pullRequests.length < config.prFetchLimit) {
					const page: PullRequestPage = yield* loadPage({ mode, repository, cursor, pageSize: Math.min(100, config.prFetchLimit - pullRequests.length) })
					pullRequests.push(...page.items)
					if (!page.hasNextPage || !page.endCursor) break
					cursor = page.endCursor
				}

				return pullRequests
			})

			const listOpenPullRequests = Effect.fn("GitHubService.listOpenPullRequests")(function* (mode: PullRequestQueueMode, repository: string | null) {
				return yield* paginatePages(mode, repository, listOpenPullRequestPage)
			})
			const listOpenPullRequestDetails = Effect.fn("GitHubService.listOpenPullRequestDetails")(function* (mode: PullRequestQueueMode, repository: string | null) {
				return yield* paginatePages(mode, repository, listOpenPullRequestDetailsPage)
			})

			const getPullRequestDetails = Effect.fn("GitHubService.getPullRequestDetails")(function* (repository: string, number: number) {
				const repo = repositoryParts(repository)
				if (!repo) {
					return yield* new CommandError({ command: "gh", args: [], detail: `Invalid repository: ${repository}`, cause: repository })
				}

				const response = yield* command.runSchema(PullRequestDetailResponseSchema, "gh", [
					"api",
					"graphql",
					"-f",
					`query=${pullRequestDetailQuery}`,
					"-F",
					`owner=${repo.owner}`,
					"-F",
					`name=${repo.name}`,
					"-F",
					`number=${number}`,
				])
				const pullRequest = response.data.repository?.pullRequest
				if (!pullRequest) {
					return yield* new CommandError({ command: "gh", args: [], detail: `Pull request not found: ${repository}#${number}`, cause: `${repository}#${number}` })
				}
				return parsePullRequest(pullRequest)
			})

			const getAuthenticatedUser = () => ghJson("getAuthenticatedUser", ViewerSchema, ["api", "user"]).pipe(Effect.map((viewer) => viewer.login))

			const getPullRequestDiff = (repository: string, number: number) =>
				ghJson("getPullRequestDiff", PullRequestFilesResponseSchema, ["api", "--paginate", "--slurp", `repos/${repository}/pulls/${number}/files`]).pipe(
					Effect.map((response) => pullRequestFilesToPatch(parsePullRequestFiles(response))),
				)

			const listPullRequestReviewComments = (repository: string, number: number) =>
				ghJson("listPullRequestReviewComments", CommentsResponseSchema, ["api", "--paginate", "--slurp", `repos/${repository}/pulls/${number}/comments`]).pipe(
					Effect.map(parsePullRequestComments),
				)

			const listPullRequestComments = Effect.fn("GitHubService.listPullRequestComments")(function* (repository: string, number: number) {
				const [issueComments, reviewComments] = yield* Effect.all(
					[
						ghJson("listPullRequestIssueComments", CommentsResponseSchema, ["api", "--paginate", "--slurp", `repos/${repository}/issues/${number}/comments`]).pipe(
							Effect.map(parseIssueComments),
						),
						listPullRequestReviewComments(repository, number).pipe(Effect.map((comments) => comments.map(reviewCommentAsComment))),
					],
					{ concurrency: "unbounded" },
				)

				return sortComments([...issueComments, ...reviewComments])
			})

			const getPullRequestMergeInfo = Effect.fn("GitHubService.getPullRequestMergeInfo")(function* (repository: string, number: number) {
				const info = yield* ghJson("getPullRequestMergeInfo", MergeInfoResponseSchema, [
					"pr",
					"view",
					String(number),
					"--repo",
					repository,
					"--json",
					"number,title,state,isDraft,mergeable,reviewDecision,autoMergeRequest,statusCheckRollup",
				])
				const checkInfo = getCheckInfoFromContexts(info.statusCheckRollup)
				const repo = repositoryParts(repository)
				const adminInfo = repo
					? yield* ghJson("getPullRequestAdminMergeInfo", PullRequestAdminMergeResponseSchema, [
							"api",
							"graphql",
							"-F",
							`owner=${repo.owner}`,
							"-F",
							`name=${repo.name}`,
							"-F",
							`number=${number}`,
							"-f",
							"query=query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { viewerCanMergeAsAdmin } } }",
						])
					: null

				return {
					repository,
					number: info.number,
					title: info.title,
					state: info.state.toLowerCase() === "open" ? "open" : "closed",
					isDraft: info.isDraft,
					mergeable: normalizeMergeable(info.mergeable),
					reviewStatus: getReviewStatus(info),
					checkStatus: checkInfo.checkStatus,
					checkSummary: checkInfo.checkSummary,
					autoMergeEnabled: info.autoMergeRequest !== null,
					viewerCanMergeAsAdmin: adminInfo?.data.repository.pullRequest?.viewerCanMergeAsAdmin ?? false,
				} satisfies PullRequestMergeInfo
			})

			const getRepositoryMergeMethods = Effect.fn("GitHubService.getRepositoryMergeMethods")(function* (repository: string) {
				const response = yield* ghJson("getRepositoryMergeMethods", RepositoryMergeMethodsResponseSchema, [
					"repo",
					"view",
					repository,
					"--json",
					"squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed",
				])
				return {
					squash: response.squashMergeAllowed,
					merge: response.mergeCommitAllowed,
					rebase: response.rebaseMergeAllowed,
				} satisfies RepositoryMergeMethods
			})

			const mergePullRequest = (repository: string, number: number, action: PullRequestMergeAction) =>
				ghVoid("mergePullRequest", ["pr", "merge", String(number), "--repo", repository, ...mergeActionCliArgs(action)])

			const closePullRequest = (repository: string, number: number) => ghVoid("closePullRequest", ["pr", "close", String(number), "--repo", repository])

			const createPullRequestIssueComment = Effect.fn("GitHubService.createPullRequestIssueComment")(function* (repository: string, number: number, body: string) {
				const response = yield* command.runSchema(PullRequestCommentSchema, "gh", [
					"api",
					"--method",
					"POST",
					`repos/${repository}/issues/${number}/comments`,
					"-f",
					`body=${body}`,
				])
				return parseIssueComment(response)
			})

			const replyToReviewComment = Effect.fn("GitHubService.replyToReviewComment")(function* (repository: string, number: number, inReplyTo: string, body: string) {
				const response = yield* command.runSchema(PullRequestCommentSchema, "gh", [
					"api",
					"--method",
					"POST",
					`repos/${repository}/pulls/${number}/comments/${inReplyTo}/replies`,
					"-f",
					`body=${body}`,
				])
				const review = parsePullRequestComment(response)
				if (!review) {
					return {
						_tag: "review-comment" as const,
						id: `reply:${inReplyTo}:${Date.now()}`,
						path: "",
						line: 0,
						side: "RIGHT" as const,
						author: "you",
						body,
						createdAt: new Date(),
						url: null,
						inReplyTo,
					}
				}
				return reviewCommentAsComment({ ...review, inReplyTo: review.inReplyTo ?? inReplyTo })
			})

			const createPullRequestComment = Effect.fn("GitHubService.createPullRequestComment")(function* (input: CreatePullRequestCommentInput) {
				const response = yield* command.runSchema(PullRequestCommentSchema, "gh", [
					"api",
					"--method",
					"POST",
					`repos/${input.repository}/pulls/${input.number}/comments`,
					"-f",
					`body=${input.body}`,
					"-f",
					`commit_id=${input.commitId}`,
					"-f",
					`path=${input.path}`,
					"-F",
					`line=${input.line}`,
					"-f",
					`side=${input.side}`,
					...(input.startLine === undefined ? [] : ["-F", `start_line=${input.startLine}`, "-f", `start_side=${input.startSide ?? input.side}`]),
				])
				return parsePullRequestComment(response) ?? fallbackCreatedComment(input)
			})

			const editPullRequestIssueComment = Effect.fn("GitHubService.editPullRequestIssueComment")(function* (repository: string, commentId: string, body: string) {
				const response = yield* command.runSchema(PullRequestCommentSchema, "gh", [
					"api",
					"--method",
					"PATCH",
					`repos/${repository}/issues/comments/${commentId}`,
					"-f",
					`body=${body}`,
				])
				return parseIssueComment(response)
			})

			const editReviewComment = Effect.fn("GitHubService.editReviewComment")(function* (repository: string, commentId: string, body: string) {
				const response = yield* command.runSchema(PullRequestCommentSchema, "gh", [
					"api",
					"--method",
					"PATCH",
					`repos/${repository}/pulls/comments/${commentId}`,
					"-f",
					`body=${body}`,
				])
				const review = parsePullRequestComment(response)
				if (!review) {
					// PATCH on a non-line review comment (e.g. file-level) can return a
					// payload that lacks `path`/`line` — keep our cached id and side
					// stable so the caller can still swap the body in place.
					return {
						_tag: "review-comment" as const,
						id: commentId,
						path: "",
						line: 0,
						side: "RIGHT" as const,
						author: "you",
						body,
						createdAt: new Date(),
						url: null,
						inReplyTo: null,
					}
				}
				return reviewCommentAsComment(review)
			})

			const deletePullRequestIssueComment = (repository: string, commentId: string) =>
				ghVoid("deletePullRequestIssueComment", ["api", "--method", "DELETE", `repos/${repository}/issues/comments/${commentId}`])

			const deleteReviewComment = (repository: string, commentId: string) =>
				ghVoid("deleteReviewComment", ["api", "--method", "DELETE", `repos/${repository}/pulls/comments/${commentId}`])

			const submitPullRequestReview = (input: SubmitPullRequestReviewInput) =>
				ghVoid("submitPullRequestReview", ["pr", "review", String(input.number), "--repo", input.repository, REVIEW_EVENT_CLI_FLAG[input.event], "--body", input.body])

			const toggleDraftStatus = (repository: string, number: number, isDraft: boolean) =>
				ghVoid("toggleDraftStatus", ["pr", "ready", String(number), "--repo", repository, ...(isDraft ? [] : ["--undo"])])

			const listRepoLabels = (repository: string) =>
				ghJson("listRepoLabels", RepoLabelsResponseSchema, ["label", "list", "--repo", repository, "--json", "name,color", "--limit", "100"]).pipe(
					Effect.map((labels) => labels.map((label) => ({ name: label.name, color: `#${label.color}` }))),
				)

			const addPullRequestLabel = (repository: string, number: number, label: string) =>
				ghVoid("addPullRequestLabel", ["pr", "edit", String(number), "--repo", repository, "--add-label", label])

			const removePullRequestLabel = (repository: string, number: number, label: string) =>
				ghVoid("removePullRequestLabel", ["pr", "edit", String(number), "--repo", repository, "--remove-label", label])

			const listReleases = Effect.fn("GitHubService.listReleases")(function* (repository: string, page: number, perPage = 30) {
				const safePage = Math.max(1, Math.floor(page))
				const safePerPage = Math.max(1, Math.min(100, Math.floor(perPage)))
				const response = yield* ghJson("listReleases", ReleaseListResponseSchema, ["api", `repos/${repository}/releases?per_page=${safePerPage}&page=${safePage}`])
				return {
					items: response.map(parseReleaseSummary),
					hasNextPage: response.length === safePerPage,
					nextPage: response.length === safePerPage ? safePage + 1 : null,
				} satisfies ReleasePage
			})

			const getRelease = (repository: string, releaseId: number) =>
				ghJson("getRelease", ReleaseSchema, ["api", `repos/${repository}/releases/${releaseId}`]).pipe(Effect.map(parseRelease))

			const getLatestRelease = (repository: string) =>
				ghJson("getLatestRelease", ReleaseSchema, ["api", `repos/${repository}/releases/latest`]).pipe(
					Effect.map((value): Release | null => parseRelease(value)),
					Effect.catchTag("CommandError", (error) => (error.detail.includes("404") ? Effect.succeed(null) : Effect.fail(error))),
				)

			const listTags = (repository: string) =>
				ghJson("listTags", TagListResponseSchema, ["api", "--paginate", "--slurp", `repos/${repository}/tags?per_page=100`]).pipe(
					Effect.map((response) =>
						flattenSlurpedPages(response).map(
							(tag): Tag => ({
								name: tag.name,
								commitSha: tag.commit.sha,
							}),
						),
					),
				)

			const getDefaultBranch = (repository: string) =>
				ghJson("getDefaultBranch", RepositoryMetaSchema, ["api", `repos/${repository}`]).pipe(Effect.map((meta) => meta.default_branch))

			const listBranches = Effect.fn("GitHubService.listBranches")(function* (repository: string) {
				const [response, defaultBranch] = yield* Effect.all(
					[ghJson("listBranchesPaged", BranchListResponseSchema, ["api", "--paginate", "--slurp", `repos/${repository}/branches?per_page=100`]), getDefaultBranch(repository)],
					{ concurrency: "unbounded" },
				)
				return flattenSlurpedPages(response).map(
					(branch): Branch => ({
						name: branch.name,
						commitSha: branch.commit.sha,
						isDefault: branch.name === defaultBranch,
					}),
				)
			})

			const generateReleaseNotes = Effect.fn("GitHubService.generateReleaseNotes")(function* (repository: string, input: GenerateReleaseNotesInput) {
				const args = [
					"api",
					"--method",
					"POST",
					`repos/${repository}/releases/generate-notes`,
					"-f",
					`tag_name=${input.tagName}`,
					...(input.previousTagName ? ["-f", `previous_tag_name=${input.previousTagName}`] : []),
					...(input.targetCommitish ? ["-f", `target_commitish=${input.targetCommitish}`] : []),
					...(input.configurationFilePath ? ["-f", `configuration_file_path=${input.configurationFilePath}`] : []),
				]
				return yield* ghJson("generateReleaseNotes", GenerateReleaseNotesResponseSchema, args)
			})

			const listDiscussionCategories = Effect.fn("GitHubService.listDiscussionCategories")(function* (repository: string) {
				const repo = repositoryParts(repository)
				if (!repo) {
					return yield* new CommandError({ command: "gh", args: [], detail: `Invalid repository: ${repository}`, cause: repository })
				}
				const response = yield* ghJson("listDiscussionCategories", DiscussionCategoriesResponseSchema, [
					"api",
					"graphql",
					"-f",
					"query=query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { hasDiscussionsEnabled discussionCategories(first: 50) { nodes { id name slug emoji } } } }",
					"-F",
					`owner=${repo.owner}`,
					"-F",
					`name=${repo.name}`,
				])
				const repoNode = response.data.repository
				if (!repoNode || !repoNode.hasDiscussionsEnabled) return [] as readonly DiscussionCategory[]
				return repoNode.discussionCategories.nodes.map(
					(node): DiscussionCategory => ({
						id: node.id,
						name: node.name,
						slug: node.slug,
						emoji: node.emoji ?? null,
					}),
				)
			})

			const releaseBodyArgs = (input: CreateReleaseInput | UpdateReleaseInput): readonly string[] => {
				const out: string[] = []
				if (input.tagName !== undefined) out.push("-f", `tag_name=${input.tagName}`)
				if (input.targetCommitish !== undefined) out.push("-f", `target_commitish=${input.targetCommitish}`)
				if (input.name !== undefined) out.push("-f", `name=${input.name}`)
				if (input.body !== undefined) out.push("-f", `body=${input.body}`)
				if (input.draft !== undefined) out.push("-F", `draft=${input.draft}`)
				if (input.prerelease !== undefined) out.push("-F", `prerelease=${input.prerelease}`)
				if (input.makeLatest !== undefined) out.push("-f", `make_latest=${input.makeLatest}`)
				if (input.discussionCategoryName !== undefined) out.push("-f", `discussion_category_name=${input.discussionCategoryName}`)
				if ("generateReleaseNotes" in input && input.generateReleaseNotes !== undefined) out.push("-F", `generate_release_notes=${input.generateReleaseNotes}`)
				return out
			}

			const createRelease = (repository: string, input: CreateReleaseInput) =>
				ghJson("createRelease", ReleaseSchema, ["api", "--method", "POST", `repos/${repository}/releases`, ...releaseBodyArgs(input)]).pipe(Effect.map(parseRelease))

			const updateRelease = (repository: string, releaseId: number, input: UpdateReleaseInput) =>
				ghJson("updateRelease", ReleaseSchema, ["api", "--method", "PATCH", `repos/${repository}/releases/${releaseId}`, ...releaseBodyArgs(input)]).pipe(Effect.map(parseRelease))

			const deleteRelease = (repository: string, releaseId: number) => ghVoid("deleteRelease", ["api", "--method", "DELETE", `repos/${repository}/releases/${releaseId}`])

			return GitHubService.of({
				listOpenPullRequests,
				listOpenPullRequestPage,
				listOpenPullRequestDetails,
				getPullRequestDetails,
				getAuthenticatedUser,
				getPullRequestDiff,
				listPullRequestReviewComments,
				listPullRequestComments,
				getPullRequestMergeInfo,
				getRepositoryMergeMethods,
				mergePullRequest,
				closePullRequest,
				createPullRequestComment,
				createPullRequestIssueComment,
				replyToReviewComment,
				editPullRequestIssueComment,
				editReviewComment,
				deletePullRequestIssueComment,
				deleteReviewComment,
				submitPullRequestReview,
				toggleDraftStatus,
				listRepoLabels,
				addPullRequestLabel,
				removePullRequestLabel,
				listReleases,
				getRelease,
				getLatestRelease,
				listTags,
				listBranches,
				getDefaultBranch,
				generateReleaseNotes,
				listDiscussionCategories,
				createRelease,
				updateRelease,
				deleteRelease,
			})
		}),
	)

	static readonly layer = GitHubService.layerNoDeps.pipe(Layer.provide(CommandRunner.layer))
}
