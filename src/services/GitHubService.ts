import { Context, Effect, Layer, Schema } from "effect"
import { config } from "../config.js"
import {
	DiffCommentSide,
	pullRequestQueueSearchQualifier,
	type CheckItem,
	type CheckRunStatus,
	type CheckConclusion,
	type CreatePullRequestCommentInput,
	type ListPullRequestPageInput,
	type Mergeable,
	type PullRequestComment,
	type PullRequestItem,
	type PullRequestMergeAction,
	type PullRequestMergeInfo,
	type PullRequestPage,
	type PullRequestQueueMode,
	type PullRequestReviewComment,
	type RepositoryMergeMethods,
	type ReviewStatus,
	type SubmitPullRequestReviewInput,
	type WorkflowJob,
	type WorkflowJobDependency,
	type WorkflowRun,
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
		databaseId: OptionalNullableNumber,
		detailsUrl: OptionalNullableString,
		checkSuite: Schema.optionalKey(
			Schema.NullOr(
				Schema.Struct({
					workflowRun: Schema.optionalKey(
						Schema.NullOr(
							Schema.Struct({
								databaseId: OptionalNullableNumber,
								workflow: Schema.optionalKey(Schema.NullOr(Schema.Struct({ name: OptionalNullableString }))),
							}),
						),
					),
				}),
			),
		),
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
	headRefName: Schema.String,
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

const WorkflowRunsResponseSchema = Schema.Struct({
	workflow_runs: Schema.Array(
		Schema.Struct({
			id: Schema.Number,
			name: OptionalNullableString,
			status: OptionalNullableString,
			conclusion: OptionalNullableString,
			html_url: Schema.String,
			event: OptionalNullableString,
			head_branch: OptionalNullableString,
			created_at: OptionalNullableString,
			updated_at: OptionalNullableString,
		}),
	),
})

const WorkflowRunJobsResponseSchema = Schema.Struct({
	jobs: Schema.Array(
		Schema.Struct({
			id: Schema.Number,
			name: OptionalNullableString,
			status: OptionalNullableString,
			conclusion: OptionalNullableString,
			started_at: OptionalNullableString,
			completed_at: OptionalNullableString,
			steps: Schema.optionalKey(
				Schema.NullOr(
					Schema.Array(
						Schema.Struct({
							number: Schema.Number,
							name: OptionalNullableString,
							status: OptionalNullableString,
							conclusion: OptionalNullableString,
						}),
					),
				),
			),
		}),
	),
})

const WorkflowRunInfoResponseSchema = Schema.Struct({
	path: OptionalNullableString,
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
              ... on CheckRun {
                name
                status
                conclusion
                databaseId
                detailsUrl
                checkSuite {
                  workflowRun {
                    databaseId
                    workflow { name }
                  }
                }
              }
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
        headRefName
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
        headRefName
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

const toCheckStatus = (raw: string | null | undefined): CheckRunStatus => (raw ? (CHECK_STATUS_BY_RAW[raw.toUpperCase()] ?? "pending") : "pending")

const toCheckConclusion = (raw: string | null | undefined): CheckConclusion | null => (raw ? (CHECK_CONCLUSION_BY_RAW[raw.toUpperCase()] ?? null) : null)

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

		if (check.__typename === "CheckRun") {
			checks.push({
				name,
				status,
				conclusion,
				...(check.databaseId != null ? { databaseId: check.databaseId } : {}),
				detailsUrl: check.detailsUrl ?? null,
				...(check.checkSuite?.workflowRun?.databaseId != null ? { workflowRunId: check.checkSuite.workflowRun.databaseId } : {}),
				workflowName: check.checkSuite?.workflowRun?.workflow?.name ?? null,
			})
		} else {
			checks.push({ name, status, conclusion })
		}

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
		headRefName: item.headRefName,
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

const parseWorkflowRunJobs = (response: Schema.Schema.Type<typeof WorkflowRunJobsResponseSchema>): readonly WorkflowJob[] =>
	response.jobs.map((job) => ({
		id: job.id,
		name: job.name ?? `job-${job.id}`,
		status: toCheckStatus(job.status),
		conclusion: toCheckConclusion(job.conclusion),
		startedAt: normalizeDate(job.started_at),
		completedAt: normalizeDate(job.completed_at),
		steps: (job.steps ?? []).map((step) => ({
			number: step.number,
			name: step.name ?? `step-${step.number}`,
			status: toCheckStatus(step.status),
			conclusion: toCheckConclusion(step.conclusion),
		})),
	}))

const parseWorkflowRuns = (response: Schema.Schema.Type<typeof WorkflowRunsResponseSchema>): readonly WorkflowRun[] =>
	response.workflow_runs.map((run) => ({
		id: run.id,
		name: run.name ?? `run-${run.id}`,
		status: toCheckStatus(run.status),
		conclusion: toCheckConclusion(run.conclusion),
		url: run.html_url,
		event: run.event ?? "pull_request",
		branch: run.head_branch ?? "",
		createdAt: normalizeDate(run.created_at),
		updatedAt: normalizeDate(run.updated_at),
		jobs: [],
	}))

const parseWorkflowDependenciesFromYaml = (source: string): readonly WorkflowJobDependency[] => {
	const lines = source.replace(/\t/g, "  ").split("\n")
	const jobsIndex = lines.findIndex((line) => /^jobs:\s*(#.*)?$/.test(line.trimEnd()))
	if (jobsIndex < 0) return []

	const dependencies: WorkflowJobDependency[] = []
	let currentId: string | null = null
	let currentName: string | null = null
	let currentNeeds: string[] = []

	const flush = () => {
		if (!currentId) return
		dependencies.push({ id: currentId, name: currentName ?? currentId, needs: [...new Set(currentNeeds)] })
		currentId = null
		currentName = null
		currentNeeds = []
	}

	const parseInlineNeeds = (value: string): string[] => {
		const trimmed = value.trim()
		if (trimmed.startsWith("[")) {
			return trimmed
				.replace(/^\[/, "")
				.replace(/\]$/, "")
				.split(",")
				.map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
				.filter((entry) => entry.length > 0)
		}
		return trimmed.length > 0 ? [trimmed.replace(/^['"]|['"]$/g, "")] : []
	}

	for (let index = jobsIndex + 1; index < lines.length; index++) {
		const raw = lines[index] ?? ""
		if (raw.trim().length === 0 || raw.trimStart().startsWith("#")) continue
		const indent = raw.length - raw.trimStart().length
		if (indent < 2) break

		const trimmed = raw.trim()
		const jobMatch = /^([A-Za-z0-9_.-]+):\s*(?:#.*)?$/.exec(trimmed)
		if (indent === 2 && jobMatch) {
			flush()
			currentId = jobMatch[1] ?? null
			continue
		}

		if (!currentId) continue

		if (indent >= 4) {
			const nameMatch = /^name:\s*(.+)\s*$/.exec(trimmed)
			if (nameMatch) {
				currentName = nameMatch[1]?.trim().replace(/^['"]|['"]$/g, "") ?? null
				continue
			}

			const needsMatch = /^needs:\s*(.*)$/.exec(trimmed)
			if (needsMatch) {
				const value = needsMatch[1] ?? ""
				if (value.trim().length === 0) {
					for (let child = index + 1; child < lines.length; child++) {
						const nextRaw = lines[child] ?? ""
						if (nextRaw.trim().length === 0 || nextRaw.trimStart().startsWith("#")) continue
						const childIndent = nextRaw.length - nextRaw.trimStart().length
						if (childIndent <= indent) break
						const childMatch = /^-\s*(.+)$/.exec(nextRaw.trim())
						if (childMatch?.[1]) currentNeeds.push(childMatch[1].trim().replace(/^['"]|['"]$/g, ""))
					}
				} else {
					currentNeeds.push(...parseInlineNeeds(value))
				}
			}
		}
	}

	flush()
	return dependencies
}

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
		readonly listWorkflowRunsForPullRequest: (repository: string, headSha: string) => Effect.Effect<readonly WorkflowRun[], GitHubError>
		readonly getWorkflowRunJobs: (repository: string, runId: number) => Effect.Effect<readonly WorkflowJob[], GitHubError>
		readonly getWorkflowJobLog: (repository: string, jobId: number) => Effect.Effect<string, CommandError>
		readonly getWorkflowRunDependencies: (repository: string, runId: number, headSha: string) => Effect.Effect<readonly WorkflowJobDependency[], GitHubError>
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

			const listWorkflowRunsForPullRequest = (repository: string, headSha: string) =>
				ghJson("listWorkflowRunsForPullRequest", WorkflowRunsResponseSchema, ["api", `repos/${repository}/actions/runs?head_sha=${encodeURIComponent(headSha)}&per_page=30`]).pipe(
					Effect.map(parseWorkflowRuns),
				)

			const getWorkflowRunJobs = (repository: string, runId: number) =>
				ghJson("getWorkflowRunJobs", WorkflowRunJobsResponseSchema, ["api", `repos/${repository}/actions/runs/${runId}/jobs?per_page=100`]).pipe(Effect.map(parseWorkflowRunJobs))

			const getWorkflowJobLog = (repository: string, jobId: number) =>
				command.run("gh", ["api", `repos/${repository}/actions/jobs/${jobId}/logs`]).pipe(
					Effect.map((result) => result.stdout),
					Effect.withSpan("GitHubService.getWorkflowJobLog"),
				)

			const getWorkflowRunDependencies = Effect.fn("GitHubService.getWorkflowRunDependencies")(function* (repository: string, runId: number, headSha: string) {
				const runInfo = yield* ghJson("getWorkflowRunInfo", WorkflowRunInfoResponseSchema, ["api", `repos/${repository}/actions/runs/${runId}`])
				const workflowPath = runInfo.path
				if (!workflowPath) return []
				const workflowFile = yield* command.runSchema(Schema.Struct({ content: Schema.String, encoding: Schema.String }), "gh", [
					"api",
					`repos/${repository}/contents/${workflowPath}?ref=${encodeURIComponent(headSha)}`,
				])
				const source = workflowFile.encoding === "base64" ? Buffer.from(workflowFile.content, "base64").toString("utf8") : workflowFile.content
				return parseWorkflowDependenciesFromYaml(source)
			})

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
				listWorkflowRunsForPullRequest,
				getWorkflowRunJobs,
				getWorkflowJobLog,
				getWorkflowRunDependencies,
			})
		}),
	)

	static readonly layer = GitHubService.layerNoDeps.pipe(Layer.provide(CommandRunner.layer))
}
