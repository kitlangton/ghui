import { Context, Effect, Layer, Schema } from "effect"
import { config } from "../config.js"
import { DiffCommentSide, pullRequestQueueSearchQualifier, type CheckItem, type CreatePullRequestCommentInput, type ListPullRequestPageInput, type Mergeable, type PullRequestConversationItem, type PullRequestItem, type PullRequestMergeAction, type PullRequestMergeInfo, type PullRequestPage, type PullRequestQueueMode, type PullRequestReviewComment, type ReviewStatus, type SubmitPullRequestReviewInput } from "../domain.js"
import { getMergeActionDefinition } from "../mergeActions.js"
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
		repository: Schema.NullOr(Schema.Struct({
			pullRequest: Schema.NullOr(RawPullRequestNodeSchema),
		})),
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
		repository: Schema.NullOr(Schema.Struct({
			pullRequests: Schema.Struct({
				nodes: Schema.Array(Schema.NullOr(RawPullRequestSummaryNodeSchema)),
				pageInfo: PageInfoSchema,
			}),
		})),
	}),
})

const ViewerSchema = Schema.Struct({ login: Schema.String })

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

const PullRequestCommentSchema = Schema.Struct({
	id: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.Number, Schema.String]))),
	node_id: OptionalNullableString,
	body: OptionalNullableString,
	html_url: OptionalNullableString,
	url: OptionalNullableString,
	created_at: OptionalNullableString,
	user: Schema.optionalKey(Schema.NullOr(Schema.Struct({
		login: OptionalNullableString,
	}))),
	path: OptionalNullableString,
	line: OptionalNullableNumber,
	original_line: OptionalNullableNumber,
	side: Schema.optionalKey(Schema.NullOr(DiffCommentSide)),
})

const PullRequestFileSchema = Schema.Struct({
	filename: Schema.String,
	previous_filename: OptionalNullableString,
	status: OptionalNullableString,
	patch: OptionalNullableString,
})

const CommentsResponseSchema = Schema.Union([
	Schema.Array(PullRequestCommentSchema),
	Schema.Array(Schema.Array(PullRequestCommentSchema)),
])

const PullRequestFilesResponseSchema = Schema.Union([
	Schema.Array(PullRequestFileSchema),
	Schema.Array(Schema.Array(PullRequestFileSchema)),
])

const RepoLabelsResponseSchema = Schema.Array(Schema.Struct({
	name: Schema.String,
	color: Schema.String,
}))

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

const normalizeCheckStatus = (raw: string | null | undefined): CheckItem["status"] =>
	raw ? CHECK_STATUS_BY_RAW[raw] ?? "pending" : "pending"

const normalizeCheckConclusion = (raw: string | null | undefined): CheckItem["conclusion"] =>
	raw ? CHECK_CONCLUSION_BY_RAW[raw] ?? null : null

const getContextStatus = (context: RawCheckContext): CheckItem["status"] =>
	RawCheckContextSchema.match(context, {
		CheckRun: (run) => normalizeCheckStatus(run.status),
		StatusContext: (status) => status.state === "PENDING" ? "in_progress" : "completed",
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
		const name = check.__typename === "CheckRun" ? check.name ?? "check" : check.context ?? "check"
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
	return `${pullRequestQueueSearchQualifier(mode, repository)} is:pr is:open archived:false ${sort}`
}

const pullRequestPage = <Item>(connection: PullRequestConnection<Item>, parse: (node: Item) => PullRequestItem): PullRequestPage => ({
	items: connection.nodes.flatMap((node) => node ? [parse(node)] : []),
	endCursor: connection.pageInfo.endCursor,
	hasNextPage: connection.pageInfo.hasNextPage && connection.pageInfo.endCursor !== null,
})

const repositoryParts = (repository: string) => {
	const [owner, name] = repository.split("/")
	return owner && name ? { owner, name } : null
}

const rawCommentFields = (comment: RawPullRequestComment, fallbackId: string) => ({
	id: String(comment.id ?? comment.node_id ?? fallbackId),
	author: comment.user?.login ?? "unknown",
	body: comment.body ?? "",
	createdAt: comment.created_at ? new Date(comment.created_at) : null,
	url: comment.html_url ?? comment.url ?? null,
})

const parsePullRequestComment = (comment: RawPullRequestComment): PullRequestReviewComment | null => {
	const line = comment.line ?? comment.original_line
	if (!comment.path || !line || (comment.side !== "LEFT" && comment.side !== "RIGHT")) return null
	return {
		...rawCommentFields(comment, `${comment.path}:${comment.side}:${line}:${comment.created_at ?? ""}:${comment.body ?? ""}`),
		path: comment.path,
		line,
		side: comment.side,
	}
}

const parsePullRequestComments = (response: Schema.Schema.Type<typeof CommentsResponseSchema>): readonly PullRequestReviewComment[] => {
	return flattenSlurpedPages(response).flatMap((comment) => {
		const parsed = parsePullRequestComment(comment)
		return parsed ? [parsed] : []
	})
}

const parseIssueComment = (comment: RawPullRequestComment): PullRequestConversationItem => ({
	_tag: "comment",
	...rawCommentFields(comment, `${comment.created_at ?? ""}:${comment.body ?? ""}`),
})

const reviewCommentConversationItem = (comment: PullRequestReviewComment): PullRequestConversationItem => ({
	_tag: "review-comment",
	...comment,
})

const conversationItemTime = (item: PullRequestConversationItem) => item.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER

const sortConversationItems = (items: readonly PullRequestConversationItem[]) =>
	[...items].sort((left, right) => conversationItemTime(left) - conversationItemTime(right) || left.id.localeCompare(right.id))

const parseIssueComments = (response: Schema.Schema.Type<typeof CommentsResponseSchema>): readonly PullRequestConversationItem[] =>
	flattenSlurpedPages(response).map(parseIssueComment)

const flattenSlurpedPages = <Item>(response: readonly Item[] | readonly (readonly Item[])[]): readonly Item[] =>
	Array.isArray(response[0]) ? (response as readonly (readonly Item[])[]).flat() : response as readonly Item[]

const parsePullRequestFiles = (response: Schema.Schema.Type<typeof PullRequestFilesResponseSchema>): readonly RawPullRequestFile[] =>
	flattenSlurpedPages(response)

const diffPath = (path: string) => /\s|"/.test(path) ? JSON.stringify(path) : path

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

export const pullRequestFilesToPatch = (files: readonly RawPullRequestFile[]) =>
	files.map(fileHeaderPatch).join("\n")

const fallbackCreatedComment = (input: CreatePullRequestCommentInput): PullRequestReviewComment => ({
	id: `created:${input.repository}:${input.number}:${input.path}:${input.side}:${input.line}:${Date.now()}`,
	path: input.path,
	line: input.line,
	side: input.side,
	author: "you",
	body: input.body,
	createdAt: new Date(),
	url: null,
})

export type GitHubError = CommandError | JsonParseError | Schema.SchemaError

const MERGEABLE_BY_RAW: Record<string, Mergeable> = {
	MERGEABLE: "mergeable",
	CONFLICTING: "conflicting",
}

const normalizeMergeable = (value: string): Mergeable =>
	MERGEABLE_BY_RAW[value] ?? "unknown"

const REVIEW_EVENT_CLI_FLAG = {
	COMMENT: "--comment",
	APPROVE: "--approve",
	REQUEST_CHANGES: "--request-changes",
} as const satisfies Record<SubmitPullRequestReviewInput["event"], string>

export class GitHubService extends Context.Service<GitHubService, {
	readonly listOpenPullRequests: (mode: PullRequestQueueMode, repository: string | null) => Effect.Effect<readonly PullRequestItem[], GitHubError>
	readonly listOpenPullRequestPage: (input: ListPullRequestPageInput) => Effect.Effect<PullRequestPage, GitHubError>
	readonly listOpenPullRequestDetails: (mode: PullRequestQueueMode, repository: string | null) => Effect.Effect<readonly PullRequestItem[], GitHubError>
	readonly getPullRequestDetails: (repository: string, number: number) => Effect.Effect<PullRequestItem, GitHubError>
	readonly getAuthenticatedUser: () => Effect.Effect<string, GitHubError>
	readonly getPullRequestDiff: (repository: string, number: number) => Effect.Effect<string, GitHubError>
	readonly listPullRequestComments: (repository: string, number: number) => Effect.Effect<readonly PullRequestReviewComment[], GitHubError>
	readonly listPullRequestConversation: (repository: string, number: number) => Effect.Effect<readonly PullRequestConversationItem[], GitHubError>
	readonly getPullRequestMergeInfo: (repository: string, number: number) => Effect.Effect<PullRequestMergeInfo, GitHubError>
	readonly mergePullRequest: (repository: string, number: number, action: PullRequestMergeAction) => Effect.Effect<void, CommandError>
	readonly closePullRequest: (repository: string, number: number) => Effect.Effect<void, CommandError>
	readonly createPullRequestComment: (input: CreatePullRequestCommentInput) => Effect.Effect<PullRequestReviewComment, GitHubError>
	readonly submitPullRequestReview: (input: SubmitPullRequestReviewInput) => Effect.Effect<void, CommandError>
	readonly toggleDraftStatus: (repository: string, number: number, isDraft: boolean) => Effect.Effect<void, CommandError>
	readonly listRepoLabels: (repository: string) => Effect.Effect<readonly { readonly name: string; readonly color: string | null }[], GitHubError>
	readonly addPullRequestLabel: (repository: string, number: number, label: string) => Effect.Effect<void, CommandError>
	readonly removePullRequestLabel: (repository: string, number: number, label: string) => Effect.Effect<void, CommandError>
}>()("ghui/GitHubService") {
	static readonly layerNoDeps = Layer.effect(
		GitHubService,
		Effect.gen(function*() {
			const command = yield* CommandRunner

			const ghJson = <S extends Schema.Top>(label: string, schema: S, args: readonly string[]) =>
				command.runSchema(schema, "gh", args).pipe(Effect.withSpan(`GitHubService.${label}`))

			const ghVoid = (label: string, args: readonly string[]) =>
				command.run("gh", args).pipe(Effect.withSpan(`GitHubService.${label}`), Effect.asVoid)

			const searchPage = <Item extends Schema.Top>(label: string, query: string, schema: Item, parse: (node: Item["Type"]) => PullRequestItem) => {
				const responseSchema = SearchResponseSchema(schema)
				return Effect.fn(`GitHubService.${label}`)(function*(input: ListPullRequestPageInput) {
					const response: SearchResponse<Item["Type"]> = yield* command.runSchema(responseSchema, "gh", [
						"api", "graphql",
						"-f", `query=${query}`,
						"-F", `searchQuery=${searchQuery(input.mode, input.repository)}`,
						"-F", `first=${input.pageSize}`,
						...(input.cursor ? ["-F", `after=${input.cursor}`] : []),
					])
					return pullRequestPage(response.data.search, parse)
				})
			}

			const listOpenPullRequestSearchPage = searchPage("listOpenPullRequestSearchPage", pullRequestSummarySearchQuery, RawPullRequestSummaryNodeSchema, parsePullRequestSummary)
			const listOpenPullRequestDetailsPage = searchPage("listOpenPullRequestDetailsPage", pullRequestSearchQuery, RawPullRequestNodeSchema, parsePullRequest)

			const listRepositoryPullRequestPage = Effect.fn("GitHubService.listRepositoryPullRequestPage")(function*(input: ListPullRequestPageInput) {
				if (!input.repository) return { items: [], endCursor: null, hasNextPage: false } satisfies PullRequestPage
				const repo = repositoryParts(input.repository)
				if (!repo) {
					return yield* new CommandError({ command: "gh", args: [], detail: `Invalid repository: ${input.repository}`, cause: input.repository })
				}

				const response = yield* command.runSchema(RepositoryPullRequestsResponseSchema, "gh", [
					"api", "graphql",
					"-f", `query=${repositoryPullRequestsQuery}`,
					"-F", `owner=${repo.owner}`,
					"-F", `name=${repo.name}`,
					"-F", `first=${input.pageSize}`,
					...(input.cursor ? ["-F", `after=${input.cursor}`] : []),
				])
				const connection = response.data.repository?.pullRequests
				if (!connection) {
					return yield* new CommandError({ command: "gh", args: [], detail: `Repository not found: ${input.repository}`, cause: input.repository })
				}
				return pullRequestPage(connection, parsePullRequestSummary)
			})

			const listOpenPullRequestPage = Effect.fn("GitHubService.listOpenPullRequestPage")(function*(input: ListPullRequestPageInput) {
				const pageSize = Math.max(1, Math.min(100, input.pageSize))
				const pageInput = { ...input, pageSize }
				if (pageInput.mode === "repository" && pageInput.repository) return yield* listRepositoryPullRequestPage(pageInput)
				return yield* listOpenPullRequestSearchPage(pageInput)
			})

			const paginatePages = Effect.fn("GitHubService.paginatePages")(function*(mode: PullRequestQueueMode, repository: string | null, loadPage: (input: ListPullRequestPageInput) => Effect.Effect<PullRequestPage, GitHubError>) {
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

			const listOpenPullRequests = Effect.fn("GitHubService.listOpenPullRequests")(function*(mode: PullRequestQueueMode, repository: string | null) {
				return yield* paginatePages(mode, repository, listOpenPullRequestPage)
			})
			const listOpenPullRequestDetails = Effect.fn("GitHubService.listOpenPullRequestDetails")(function*(mode: PullRequestQueueMode, repository: string | null) {
				return yield* paginatePages(mode, repository, listOpenPullRequestDetailsPage)
			})

			const getPullRequestDetails = Effect.fn("GitHubService.getPullRequestDetails")(function*(repository: string, number: number) {
				const repo = repositoryParts(repository)
				if (!repo) {
					return yield* new CommandError({ command: "gh", args: [], detail: `Invalid repository: ${repository}`, cause: repository })
				}

				const response = yield* command.runSchema(PullRequestDetailResponseSchema, "gh", [
					"api", "graphql",
					"-f", `query=${pullRequestDetailQuery}`,
					"-F", `owner=${repo.owner}`,
					"-F", `name=${repo.name}`,
					"-F", `number=${number}`,
				])
				const pullRequest = response.data.repository?.pullRequest
				if (!pullRequest) {
					return yield* new CommandError({ command: "gh", args: [], detail: `Pull request not found: ${repository}#${number}`, cause: `${repository}#${number}` })
				}
				return parsePullRequest(pullRequest)
			})

			const getAuthenticatedUser = () =>
				ghJson("getAuthenticatedUser", ViewerSchema, ["api", "user"]).pipe(Effect.map((viewer) => viewer.login))

			const getPullRequestDiff = (repository: string, number: number) =>
				ghJson("getPullRequestDiff", PullRequestFilesResponseSchema, [
					"api", "--paginate", "--slurp", `repos/${repository}/pulls/${number}/files`,
				]).pipe(Effect.map((response) => pullRequestFilesToPatch(parsePullRequestFiles(response))))

			const listPullRequestComments = (repository: string, number: number) =>
				ghJson("listPullRequestComments", CommentsResponseSchema, [
					"api", "--paginate", "--slurp", `repos/${repository}/pulls/${number}/comments`,
				]).pipe(Effect.map(parsePullRequestComments))

			const listPullRequestConversation = Effect.fn("GitHubService.listPullRequestConversation")(function*(repository: string, number: number) {
				const [issueComments, reviewComments] = yield* Effect.all([
					ghJson("listPullRequestIssueComments", CommentsResponseSchema, [
						"api", "--paginate", "--slurp", `repos/${repository}/issues/${number}/comments`,
					]).pipe(Effect.map(parseIssueComments)),
					listPullRequestComments(repository, number).pipe(Effect.map((comments) => comments.map(reviewCommentConversationItem))),
				], { concurrency: "unbounded" })

				return sortConversationItems([...issueComments, ...reviewComments])
			})

			const getPullRequestMergeInfo = Effect.fn("GitHubService.getPullRequestMergeInfo")(function*(repository: string, number: number) {
				const info = yield* command.runSchema(MergeInfoResponseSchema, "gh", [
					"pr", "view", String(number), "--repo", repository,
					"--json", "number,title,state,isDraft,mergeable,reviewDecision,autoMergeRequest,statusCheckRollup",
				])
				const checkInfo = getCheckInfoFromContexts(info.statusCheckRollup)

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
				} satisfies PullRequestMergeInfo
			})

			const mergePullRequest = (repository: string, number: number, action: PullRequestMergeAction) =>
				ghVoid("mergePullRequest", ["pr", "merge", String(number), "--repo", repository, ...getMergeActionDefinition(action).cliArgs])

			const closePullRequest = (repository: string, number: number) =>
				ghVoid("closePullRequest", ["pr", "close", String(number), "--repo", repository])

			const createPullRequestComment = Effect.fn("GitHubService.createPullRequestComment")(function*(input: CreatePullRequestCommentInput) {
				const response = yield* command.runSchema(PullRequestCommentSchema, "gh", [
					"api", "--method", "POST", `repos/${input.repository}/pulls/${input.number}/comments`,
					"-f", `body=${input.body}`,
					"-f", `commit_id=${input.commitId}`,
					"-f", `path=${input.path}`,
					"-F", `line=${input.line}`,
					"-f", `side=${input.side}`,
					...(input.startLine === undefined ? [] : ["-F", `start_line=${input.startLine}`, "-f", `start_side=${input.startSide ?? input.side}`]),
				])
				return parsePullRequestComment(response) ?? fallbackCreatedComment(input)
			})

			const submitPullRequestReview = (input: SubmitPullRequestReviewInput) =>
				ghVoid("submitPullRequestReview", [
					"pr", "review", String(input.number), "--repo", input.repository,
					REVIEW_EVENT_CLI_FLAG[input.event],
					"--body", input.body,
				])

			const toggleDraftStatus = (repository: string, number: number, isDraft: boolean) =>
				ghVoid("toggleDraftStatus", ["pr", "ready", String(number), "--repo", repository, ...(isDraft ? [] : ["--undo"])])

			const listRepoLabels = (repository: string) =>
				ghJson("listRepoLabels", RepoLabelsResponseSchema, [
					"label", "list", "--repo", repository, "--json", "name,color", "--limit", "100",
				]).pipe(Effect.map((labels) => labels.map((label) => ({ name: label.name, color: `#${label.color}` }))))

			const addPullRequestLabel = (repository: string, number: number, label: string) =>
				ghVoid("addPullRequestLabel", ["pr", "edit", String(number), "--repo", repository, "--add-label", label])

			const removePullRequestLabel = (repository: string, number: number, label: string) =>
				ghVoid("removePullRequestLabel", ["pr", "edit", String(number), "--repo", repository, "--remove-label", label])

			return GitHubService.of({
				listOpenPullRequests,
				listOpenPullRequestPage,
				listOpenPullRequestDetails,
				getPullRequestDetails,
				getAuthenticatedUser,
				getPullRequestDiff,
				listPullRequestComments,
				listPullRequestConversation,
				getPullRequestMergeInfo,
				mergePullRequest,
				closePullRequest,
				createPullRequestComment,
				submitPullRequestReview,
				toggleDraftStatus,
				listRepoLabels,
				addPullRequestLabel,
				removePullRequestLabel,
			})
		}),
	)

	static readonly layer = GitHubService.layerNoDeps.pipe(Layer.provide(CommandRunner.layer))
}
