import { Context, Effect, Layer, Schema } from "effect"
import { config } from "../config.js"
import { DiffCommentSide, pullRequestQueueSearchQualifier, type CheckItem, type CreatePullRequestCommentInput, type Mergeable, type PullRequestComment, type PullRequestItem, type PullRequestMergeAction, type PullRequestMergeInfo, type PullRequestQueueMode, type PullRequestReviewComment, type ReviewStatus } from "../domain.js"
import { getMergeActionDefinition } from "../mergeActions.js"
import { CommandRunner, type CommandError, type JsonParseError } from "./CommandRunner.js"

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

const RawPullRequestSummaryNodeSchema = Schema.Struct(RawPullRequestSummaryFields)

const RawPullRequestNodeSchema = Schema.Struct({
	...RawPullRequestSummaryFields,
	body: Schema.String,
	labels: Schema.Struct({ nodes: Schema.Array(RawLabelSchema) }),
	additions: Schema.Number,
	deletions: Schema.Number,
	changedFiles: Schema.Number,
	statusCheckRollup: Schema.optionalKey(Schema.NullOr(Schema.Struct({
		contexts: Schema.Struct({ nodes: Schema.Array(RawCheckContextSchema) }),
	}))),
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

const CommentsResponseSchema = Schema.Union([
	Schema.Array(PullRequestCommentSchema),
	Schema.Array(Schema.Array(PullRequestCommentSchema)),
])

const RepoLabelsResponseSchema = Schema.Array(Schema.Struct({
	name: Schema.String,
	color: Schema.String,
}))

type RawPullRequestSummaryNode = Schema.Schema.Type<typeof RawPullRequestSummaryNodeSchema>
type RawPullRequestNode = Schema.Schema.Type<typeof RawPullRequestNodeSchema>
type RawCheckContext = Schema.Schema.Type<typeof RawCheckContextSchema>
type RawPullRequestComment = Schema.Schema.Type<typeof PullRequestCommentSchema>

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

const pullRequestSearchQuery = `
query PullRequests($searchQuery: String!, $first: Int!, $after: String) {
  search(query: $searchQuery, type: ISSUE, first: $first, after: $after) {
    nodes {
      ... on PullRequest {
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
        labels(first: 20) { nodes { name color } }
        statusCheckRollup {
          contexts(first: 100) {
            nodes {
              __typename
              ... on CheckRun { name status conclusion }
              ... on StatusContext { context state }
            }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
`

interface GitHubIssueComment {
	readonly id: number
	readonly user?: { readonly login?: string | null } | null
	readonly body?: string | null
	readonly created_at: string
	readonly updated_at: string
	readonly html_url: string
}

interface GitHubReviewThreadsResponse {
	readonly data?: {
		readonly repository?: {
			readonly pullRequest?: {
				readonly reviewThreads?: {
					readonly nodes?: readonly GitHubReviewThread[] | null
				} | null
			} | null
		} | null
	} | null
}

interface GitHubReviewThread {
	readonly id: string
	readonly isResolved?: boolean | null
	readonly comments?: { readonly nodes?: readonly GitHubThreadComment[] | null } | null
}

interface GitHubThreadComment {
	readonly id: string
	readonly databaseId?: number | null
	readonly author?: { readonly login?: string | null } | null
	readonly body?: string | null
	readonly createdAt: string
	readonly updatedAt: string
	readonly url: string
	readonly path?: string | null
	readonly line?: number | null
	readonly originalLine?: number | null
	readonly replyTo?: { readonly id?: string | null } | null
}

const pullRequestSummarySearchQuery = `
query PullRequests($searchQuery: String!, $first: Int!, $after: String) {
  search(query: $searchQuery, type: ISSUE, first: $first, after: $after) {
    nodes {
      ... on PullRequest {
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
        repository { nameWithOwner }
      }
    }
    pageInfo { hasNextPage endCursor }
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

const parsePullRequestSummary = (item: RawPullRequestSummaryNode): PullRequestItem => ({
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
	checkStatus: "none",
	checkSummary: null,
	checks: [],
	autoMergeEnabled: item.autoMergeRequest !== null,
	detailLoaded: false,
	createdAt: new Date(item.createdAt),
	closedAt: normalizeDate(item.closedAt),
	url: item.url,
})

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

const searchQuery = (mode: PullRequestQueueMode, author: string) => `${pullRequestQueueSearchQualifier(mode, author)} is:pr is:open sort:created-desc`

const sortNewestFirst = (pullRequests: readonly PullRequestItem[]) =>
	[...pullRequests].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())

const parseIssueComment = (comment: GitHubIssueComment): PullRequestComment => ({
	id: `issue:${comment.id}`,
	databaseId: comment.id,
	kind: "issue",
	author: comment.user?.login ?? "unknown",
	body: comment.body ?? "",
	createdAt: new Date(comment.created_at),
	updatedAt: new Date(comment.updated_at),
	htmlUrl: comment.html_url,
	context: null,
	threadId: null,
	parentId: null,
	depth: 0,
})

const parseThreadComment = (thread: GitHubReviewThread, comment: GitHubThreadComment, index: number): PullRequestComment => ({
	id: `thread:${comment.id}`,
	databaseId: comment.databaseId ?? null,
	kind: "thread",
	author: comment.author?.login ?? "unknown",
	body: comment.body ?? "",
	createdAt: new Date(comment.createdAt),
	updatedAt: new Date(comment.updatedAt),
	htmlUrl: comment.url,
	context: comment.path
		? { path: comment.path, line: comment.line ?? null, originalLine: comment.originalLine ?? null, resolved: thread.isResolved ?? null }
		: null,
	threadId: thread.id,
	parentId: comment.replyTo?.id ? `thread:${comment.replyTo.id}` : null,
	depth: index === 0 ? 0 : 1,
})

const mergeComments = (comments: readonly PullRequestComment[]) => {
	const byKey = new Map<string, PullRequestComment>()
	for (const comment of comments) {
		// REST review comments and GraphQL review-thread comments can overlap.
		// Use databaseId when present so the same GitHub comment is rendered once.
		const key = comment.databaseId ? `db:${comment.databaseId}` : comment.id
		if (!byKey.has(key)) byKey.set(key, comment)
	}

	const groups = new Map<string, PullRequestComment[]>()
	for (const comment of byKey.values()) {
		const key = comment.threadId ?? comment.id
		groups.set(key, [...(groups.get(key) ?? []), comment])
	}

	return [...groups.values()]
		.map((group) => group.sort((left, right) => {
			if (left.depth !== right.depth) return left.depth - right.depth
			return left.createdAt.getTime() - right.createdAt.getTime()
		}))
		.sort((left, right) => left[0]!.createdAt.getTime() - right[0]!.createdAt.getTime())
		.flat()
}

const parsePullRequestComment = (comment: RawPullRequestComment): PullRequestReviewComment | null => {
	const line = comment.line ?? comment.original_line
	if (!comment.path || !line || (comment.side !== "LEFT" && comment.side !== "RIGHT")) return null
	return {
		id: String(comment.id ?? comment.node_id ?? `${comment.path}:${comment.side}:${line}:${comment.created_at ?? ""}:${comment.body ?? ""}`),
		path: comment.path,
		line,
		side: comment.side,
		author: comment.user?.login ?? "unknown",
		body: comment.body ?? "",
		createdAt: comment.created_at ? new Date(comment.created_at) : null,
		url: comment.html_url ?? comment.url ?? null,
	}
}

const parsePullRequestComments = (response: Schema.Schema.Type<typeof CommentsResponseSchema>): readonly PullRequestReviewComment[] => {
	const pages: readonly (readonly RawPullRequestComment[])[] = Array.isArray(response[0])
		? response as readonly (readonly RawPullRequestComment[])[]
		: [response as readonly RawPullRequestComment[]]
	return pages.flatMap((page) => page.flatMap((comment) => {
		const parsed = parsePullRequestComment(comment)
		return parsed ? [parsed] : []
	}))
}

const fallbackCreatedComment = (input: CreatePullRequestCommentInput): PullRequestReviewComment => ({
	id: `created:${input.repository}:${input.number}:${input.path}:${input.side}:${input.line}:${Date.now()}`,
	path: input.path,
	line: input.line,
	side: input.side,
	author: config.author.replace(/^@/, "") || "you",
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

export class GitHubService extends Context.Service<GitHubService, {
	readonly listOpenPullRequests: (mode: PullRequestQueueMode) => Effect.Effect<readonly PullRequestItem[], GitHubError>
	readonly listOpenPullRequestDetails: (mode: PullRequestQueueMode) => Effect.Effect<readonly PullRequestItem[], GitHubError>
	readonly getAuthenticatedUser: () => Effect.Effect<string, GitHubError>
	readonly getPullRequestDiff: (repository: string, number: number) => Effect.Effect<string, CommandError>
	readonly listPullRequestComments: (repository: string, number: number) => Effect.Effect<readonly PullRequestReviewComment[], GitHubError>
	readonly getPullRequestMergeInfo: (repository: string, number: number) => Effect.Effect<PullRequestMergeInfo, GitHubError>
	readonly mergePullRequest: (repository: string, number: number, action: PullRequestMergeAction) => Effect.Effect<void, CommandError>
	readonly closePullRequest: (repository: string, number: number) => Effect.Effect<void, CommandError>
	readonly createPullRequestComment: (input: CreatePullRequestCommentInput) => Effect.Effect<PullRequestReviewComment, GitHubError>
	readonly listPullRequestConversationComments: (repository: string, number: number) => Effect.Effect<readonly PullRequestComment[], GitHubError>
	readonly toggleDraftStatus: (repository: string, number: number, isDraft: boolean) => Effect.Effect<void, CommandError>
	readonly listRepoLabels: (repository: string) => Effect.Effect<readonly { readonly name: string; readonly color: string | null }[], GitHubError>
	readonly addPullRequestLabel: (repository: string, number: number, label: string) => Effect.Effect<void, CommandError>
	readonly removePullRequestLabel: (repository: string, number: number, label: string) => Effect.Effect<void, CommandError>
}>()("ghui/GitHubService") {
	static readonly layerNoDeps = Layer.effect(
		GitHubService,
		Effect.gen(function*() {
			const command = yield* CommandRunner

			const paginateSearch = <Item extends Schema.Top>(label: string, query: string, schema: Item, parse: (node: Item["Type"]) => PullRequestItem) => {
				const responseSchema = SearchResponseSchema(schema)
				return Effect.fn(`GitHubService.${label}`)(function*(mode: PullRequestQueueMode) {
					const pullRequests: PullRequestItem[] = []
					let cursor: string | null = null

					while (pullRequests.length < config.prFetchLimit) {
						const pageSize = Math.min(100, config.prFetchLimit - pullRequests.length)
						const response: SearchResponse<Item["Type"]> = yield* command.runSchema(responseSchema, "gh", [
							"api", "graphql",
							"-f", `query=${query}`,
							"-F", `searchQuery=${searchQuery(mode, config.author)}`,
							"-F", `first=${pageSize}`,
							...(cursor ? ["-F", `after=${cursor}`] : []),
						])

						for (const node of response.data.search.nodes) {
							if (node) pullRequests.push(parse(node))
						}

						if (!response.data.search.pageInfo.hasNextPage) break
						cursor = response.data.search.pageInfo.endCursor
						if (!cursor) break
					}

					return sortNewestFirst(pullRequests)
				})
			}

			const listOpenPullRequests = paginateSearch("listOpenPullRequests", pullRequestSummarySearchQuery, RawPullRequestSummaryNodeSchema, parsePullRequestSummary)
			const listOpenPullRequestDetails = paginateSearch("listOpenPullRequestDetails", pullRequestSearchQuery, RawPullRequestNodeSchema, parsePullRequest)

			const getAuthenticatedUser = Effect.fn("GitHubService.getAuthenticatedUser")(function*() {
				const viewer = yield* command.runSchema(ViewerSchema, "gh", ["api", "user"])
				return viewer.login
			})

			const getPullRequestDiff = Effect.fn("GitHubService.getPullRequestDiff")(function*(repository: string, number: number) {
				const result = yield* command.run("gh", ["pr", "diff", String(number), "--repo", repository, "--color", "never"])
				return result.stdout
			})

			const listPullRequestComments = Effect.fn("GitHubService.listPullRequestComments")(function*(repository: string, number: number) {
				const response = yield* command.runSchema(CommentsResponseSchema, "gh", [
					"api", "--paginate", "--slurp", `repos/${repository}/pulls/${number}/comments`,
				])
				return parsePullRequestComments(response)
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

			const mergePullRequest = Effect.fn("GitHubService.mergePullRequest")(function*(repository: string, number: number, action: PullRequestMergeAction) {
				const base = ["pr", "merge", String(number), "--repo", repository] as const
				yield* command.run("gh", [...base, ...getMergeActionDefinition(action).cliArgs])
			})

			const closePullRequest = Effect.fn("GitHubService.closePullRequest")(function*(repository: string, number: number) {
				yield* command.run("gh", ["pr", "close", String(number), "--repo", repository])
			})

			const createPullRequestComment = Effect.fn("GitHubService.createPullRequestComment")(function*(input: CreatePullRequestCommentInput) {
				const response = yield* command.runSchema(PullRequestCommentSchema, "gh", [
					"api", "--method", "POST", `repos/${input.repository}/pulls/${input.number}/comments`,
					"-f", `body=${input.body}`,
					"-f", `commit_id=${input.commitId}`,
					"-f", `path=${input.path}`,
					"-F", `line=${input.line}`,
					"-f", `side=${input.side}`,
				])
				return parsePullRequestComment(response) ?? fallbackCreatedComment(input)
			})

			const toggleDraftStatus = Effect.fn("GitHubService.toggleDraftStatus")(function*(repository: string, number: number, isDraft: boolean) {
				yield* command.run("gh", ["pr", "ready", String(number), "--repo", repository, ...(isDraft ? [] : ["--undo"])])
			})

			const listPullRequestConversationComments = Effect.fn("GitHubService.listPullRequestConversationComments")(function*(repository: string, number: number) {
				const [owner, name] = repository.split("/")
				const comments = yield* command.runJson<readonly GitHubIssueComment[]>("gh", [
					"api", `repos/${repository}/issues/${number}/comments`, "--paginate",
				])
				let reviewThreads: GitHubReviewThreadsResponse = {}
				if (owner && name) {
					reviewThreads = yield* command.runJson<GitHubReviewThreadsResponse>("gh", [
						"api", "graphql",
						"-f", "query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved comments(first:100){nodes{id databaseId author{login} body createdAt updatedAt url path line originalLine replyTo{id}}}}}}}}",
						"-F", `owner=${owner}`,
						"-F", `name=${name}`,
						"-F", `number=${number}`,
					]).pipe(Effect.catch(() => Effect.succeed({} as GitHubReviewThreadsResponse)))
				}
				const threadComments = reviewThreads.data?.repository?.pullRequest?.reviewThreads?.nodes?.flatMap((thread) =>
					(thread.comments?.nodes ?? []).map((comment, index) => parseThreadComment(thread, comment, index)),
				) ?? []
				return mergeComments([
					...comments.map(parseIssueComment),
					...threadComments,
				])
			})

			const listRepoLabels = Effect.fn("GitHubService.listRepoLabels")(function*(repository: string) {
				const labels = yield* command.runSchema(RepoLabelsResponseSchema, "gh", [
					"label", "list", "--repo", repository, "--json", "name,color", "--limit", "100",
				])
				return labels.map((label) => ({ name: label.name, color: `#${label.color}` }))
			})

			const addPullRequestLabel = Effect.fn("GitHubService.addPullRequestLabel")(function*(repository: string, number: number, label: string) {
				yield* command.run("gh", ["pr", "edit", String(number), "--repo", repository, "--add-label", label])
			})

			const removePullRequestLabel = Effect.fn("GitHubService.removePullRequestLabel")(function*(repository: string, number: number, label: string) {
				yield* command.run("gh", ["pr", "edit", String(number), "--repo", repository, "--remove-label", label])
			})

			return GitHubService.of({
				listOpenPullRequests,
				listOpenPullRequestDetails,
				getAuthenticatedUser,
				getPullRequestDiff,
				listPullRequestComments,
				getPullRequestMergeInfo,
				mergePullRequest,
				closePullRequest,
				createPullRequestComment,
				listPullRequestConversationComments,
				toggleDraftStatus,
				listRepoLabels,
				addPullRequestLabel,
				removePullRequestLabel,
			})
		}),
	)

	static readonly layer = GitHubService.layerNoDeps.pipe(Layer.provide(CommandRunner.layer))
}
