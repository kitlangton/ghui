import { Context, Effect, Layer, Schema, Stream } from "effect"
import * as Option from "effect/Option"
import { config } from "../config.js"
import {
	type CreatePullRequestCommentInput,
	type IssueItem,
	type PullRequestComment,
	type PullRequestItem,
	type PullRequestMergeAction,
	type PullRequestMergeInfo,
	type PullRequestReviewComment,
	type RepositoryDetails,
	type RepositoryMergeMethods,
	type SubmitPullRequestReviewInput,
} from "../domain.js"
import { type ItemListInput, type ItemPage, searchQualifier } from "../item.js"
import { mergeActionCliArgs } from "../mergeActions.js"
import { CommandError, CommandRunner, commandTelemetryAttributes, type JsonParseError } from "./CommandRunner.js"
import {
	fallbackCreatedComment,
	fallbackEditedReviewComment,
	fallbackReplyComment,
	itemPage,
	parseIssueComment,
	parseIssueComments,
	parseIssueSearchNode,
	parsePullRequest,
	parsePullRequestComment,
	parsePullRequestComments,
	parsePullRequestFiles,
	parsePullRequestMergeInfo,
	parsePullRequestSummary,
	parseRepositoryDetails,
	parseRepositoryMergeMethods,
	pullRequestFilesToPatch,
	reviewCommentAsComment,
	sortComments,
} from "./githubNormalize.js"
import {
	CommentsResponseSchema,
	issueSearchQuery,
	MergeInfoResponseSchema,
	PullRequestAdminMergeResponseSchema,
	PullRequestCommentSchema,
	pullRequestDetailQuery,
	PullRequestDetailResponseSchema,
	PullRequestFilesResponseSchema,
	pullRequestSummarySearchQuery,
	RawIssueSearchNodeSchema,
	RawPullRequestSummaryNodeSchema,
	RepoLabelsResponseSchema,
	RepositoryDetailsResponseSchema,
	RepositoryMergeMethodsResponseSchema,
	RepositoryPullRequestsResponseSchema,
	repositoryDetailsQuery,
	repositoryPullRequestsQuery,
	SearchResponseSchema,
	type SearchResponse,
	ViewerSchema,
} from "./githubSchemas.js"
export { isGitHubRateLimitError } from "./githubRateLimit.js"

const repositoryParts = (repository: string) => {
	const [owner, name] = repository.split("/")
	return owner && name ? { owner, name } : null
}

export type GitHubError = CommandError | JsonParseError | Schema.SchemaError

const REVIEW_EVENT_CLI_FLAG = {
	COMMENT: "--comment",
	APPROVE: "--approve",
	REQUEST_CHANGES: "--request-changes",
} as const satisfies Record<SubmitPullRequestReviewInput["event"], string>

export class GitHubService extends Context.Service<
	GitHubService,
	{
		readonly listPullRequestPage: (input: ItemListInput<"pullRequest">) => Effect.Effect<ItemPage<PullRequestItem>, GitHubError>
		readonly listIssuePage: (input: ItemListInput<"issue">) => Effect.Effect<ItemPage<IssueItem>, GitHubError>
		readonly listAllPullRequests: (input: Omit<ItemListInput<"pullRequest">, "cursor" | "pageSize">) => Effect.Effect<readonly PullRequestItem[], GitHubError>
		readonly listAllIssues: (input: Omit<ItemListInput<"issue">, "cursor" | "pageSize">) => Effect.Effect<readonly IssueItem[], GitHubError>
		readonly getPullRequestDetails: (repository: string, number: number) => Effect.Effect<PullRequestItem, GitHubError>
		readonly getRepositoryDetails: (repository: string) => Effect.Effect<RepositoryDetails, GitHubError>
		readonly getAuthenticatedUser: () => Effect.Effect<string, GitHubError>
		readonly getPullRequestDiff: (repository: string, number: number) => Effect.Effect<string, GitHubError>
		readonly listPullRequestReviewComments: (repository: string, number: number) => Effect.Effect<readonly PullRequestReviewComment[], GitHubError>
		readonly listPullRequestComments: (repository: string, number: number) => Effect.Effect<readonly PullRequestComment[], GitHubError>
		readonly listIssueComments: (repository: string, number: number) => Effect.Effect<readonly PullRequestComment[], GitHubError>
		readonly getPullRequestMergeInfo: (repository: string, number: number) => Effect.Effect<PullRequestMergeInfo, GitHubError>
		readonly getRepositoryMergeMethods: (repository: string) => Effect.Effect<RepositoryMergeMethods, GitHubError>
		readonly mergePullRequest: (repository: string, number: number, action: PullRequestMergeAction) => Effect.Effect<void, CommandError>
		readonly closePullRequest: (repository: string, number: number) => Effect.Effect<void, CommandError>
		readonly closeIssue: (repository: string, number: number) => Effect.Effect<void, CommandError>
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
		readonly addIssueLabel: (repository: string, number: number, label: string) => Effect.Effect<void, CommandError>
		readonly removeIssueLabel: (repository: string, number: number, label: string) => Effect.Effect<void, CommandError>
	}
>()("ghui/GitHubService") {
	static readonly layerNoDeps = Layer.effect(
		GitHubService,
		Effect.gen(function* () {
			const command = yield* CommandRunner

			const githubApiAttributes = (label: string, args: readonly string[]) => ({
				...commandTelemetryAttributes("gh", args),
				"github.operation": label,
			})

			const ghJson = <S extends Schema.Top>(label: string, schema: S, args: readonly string[]) =>
				command.runSchema(schema, "gh", args).pipe(Effect.withSpan(`GitHubService.${label}`, { attributes: githubApiAttributes(label, args) }))

			const ghVoid = (label: string, args: readonly string[]) =>
				command.run("gh", args).pipe(Effect.withSpan(`GitHubService.${label}`, { attributes: githubApiAttributes(label, args) }), Effect.asVoid)

			// One search-page fetcher for items of any kind. Owns the GraphQL call,
			// argument shaping, and decoder; the caller supplies the GraphQL query,
			// the raw schema, and the parser.
			const searchItemPage = <RawSchema extends Schema.Top, Item>(label: string, graphqlQuery: string, schema: RawSchema, parse: (node: RawSchema["Type"]) => Item) => {
				const responseSchema = SearchResponseSchema(schema)
				return <K extends "pullRequest" | "issue">(input: ItemListInput<K>) =>
					Effect.gen(function* () {
						const args = [
							"api",
							"graphql",
							"-f",
							`query=${graphqlQuery}`,
							"-F",
							`searchQuery=${searchQualifier(input)}`,
							"-F",
							`first=${input.pageSize}`,
							...(input.cursor ? ["-F", `after=${input.cursor}`] : []),
						] as const
						const response: SearchResponse<RawSchema["Type"]> = yield* ghJson(label, responseSchema, args)
						return itemPage(response.data.search, parse)
					})
			}

			const listPullRequestSearchPage = searchItemPage("listPullRequestSearchPage", pullRequestSummarySearchQuery, RawPullRequestSummaryNodeSchema, parsePullRequestSummary)
			const listIssueSearchPage = searchItemPage("listIssueSearchPage", issueSearchQuery, RawIssueSearchNodeSchema, parseIssueSearchNode)

			// Repo-scoped PRs use GitHub's `repository.pullRequests` connection rather
			// than `search`; it's faster and returns authoritative repo ordering.
			const listRepositoryPullRequestPage = Effect.fn("GitHubService.listRepositoryPullRequestPage")(function* (input: {
				repository: string
				cursor: string | null
				pageSize: number
			}) {
				const repo = repositoryParts(input.repository)
				if (!repo) {
					return yield* new CommandError({ command: "gh", args: [], detail: `Invalid repository: ${input.repository}`, cause: input.repository })
				}

				const args = [
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
				] as const
				const response = yield* ghJson("listRepositoryPullRequestPage", RepositoryPullRequestsResponseSchema, args)
				const connection = response.data.repository?.pullRequests
				if (!connection) {
					return yield* new CommandError({ command: "gh", args: [], detail: `Repository not found: ${input.repository}`, cause: input.repository })
				}
				return itemPage(connection, parsePullRequestSummary)
			})

			// One page-fetcher per kind, accepting the unified `ItemListInput`.
			// Mode "all" with a repository uses GitHub's repository connection (faster
			// and authoritative ordering); everything else uses the search endpoint.
			const listPullRequestPage = Effect.fn("GitHubService.listPullRequestPage")(function* (input: ItemListInput<"pullRequest">) {
				const pageSize = Math.max(1, Math.min(100, input.pageSize))
				if (input.mode === "all" && input.repository !== null) {
					return yield* listRepositoryPullRequestPage({ repository: input.repository, cursor: input.cursor, pageSize })
				}
				return yield* listPullRequestSearchPage({ ...input, pageSize })
			})

			const listIssuePage = Effect.fn("GitHubService.listIssuePage")(function* (input: ItemListInput<"issue">) {
				const pageSize = Math.max(1, Math.min(100, input.pageSize))
				return yield* listIssueSearchPage({ ...input, pageSize })
			})

			// Drain every page for an item query into a single array, using
			// `Stream.paginate`. Interrupting the surrounding fiber stops mid-flight.
			const drainItemPages = <K extends "pullRequest" | "issue", Item>(
				query: Omit<ItemListInput<K>, "cursor" | "pageSize">,
				pageFetch: (input: ItemListInput<K>) => Effect.Effect<ItemPage<Item>, GitHubError>,
				limit: number,
			): Effect.Effect<readonly Item[], GitHubError> => {
				type State = { readonly cursor: string | null; readonly fetched: number }
				const stream = Stream.paginate<State, Item, GitHubError>({ cursor: null, fetched: 0 }, ({ cursor, fetched }) => {
					const remaining = limit - fetched
					if (remaining <= 0) return Effect.succeed([[], Option.none()] as const)
					const pageSize = Math.min(100, remaining)
					return pageFetch({ ...query, cursor, pageSize } as ItemListInput<K>).pipe(
						Effect.map((page): readonly [readonly Item[], Option.Option<State>] => {
							const items = page.items.slice(0, remaining)
							const nextFetched = fetched + items.length
							const next: Option.Option<State> =
								page.hasNextPage && page.endCursor && nextFetched < limit ? Option.some({ cursor: page.endCursor, fetched: nextFetched }) : Option.none()
							return [items, next]
						}),
					)
				})
				return Stream.runCollect(stream).pipe(Effect.map((chunk) => Array.from(chunk)))
			}

			const listAllPullRequests = (input: Omit<ItemListInput<"pullRequest">, "cursor" | "pageSize">) =>
				drainItemPages<"pullRequest", PullRequestItem>(input, listPullRequestPage, config.prFetchLimit)
			const listAllIssues = (input: Omit<ItemListInput<"issue">, "cursor" | "pageSize">) => drainItemPages<"issue", IssueItem>(input, listIssuePage, config.prFetchLimit)

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

			const authenticatedUser = yield* ghJson("getAuthenticatedUser", ViewerSchema, ["api", "user"]).pipe(
				Effect.map((viewer) => viewer.login),
				Effect.cachedWithTTL("5 minutes"),
			)
			const getAuthenticatedUser = () => authenticatedUser

			const getRepositoryDetails = Effect.fn("GitHubService.getRepositoryDetails")(function* (repository: string) {
				const repo = repositoryParts(repository)
				if (!repo) {
					return yield* new CommandError({ command: "gh", args: [], detail: `Invalid repository: ${repository}`, cause: repository })
				}
				const response = yield* ghJson("getRepositoryDetails", RepositoryDetailsResponseSchema, [
					"api",
					"graphql",
					"-f",
					`query=${repositoryDetailsQuery}`,
					"-F",
					`owner=${repo.owner}`,
					"-F",
					`name=${repo.name}`,
				])
				const node = response.data.repository
				if (!node) {
					return yield* new CommandError({ command: "gh", args: [], detail: `Repository not found: ${repository}`, cause: repository })
				}
				return parseRepositoryDetails(repository, node)
			})

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

			const listIssueComments = (repository: string, number: number) =>
				ghJson("listIssueComments", CommentsResponseSchema, ["api", "--paginate", "--slurp", `repos/${repository}/issues/${number}/comments`]).pipe(Effect.map(parseIssueComments))

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

				return parsePullRequestMergeInfo(repository, info, adminInfo?.data.repository.pullRequest?.viewerCanMergeAsAdmin ?? false)
			})

			const getRepositoryMergeMethods = Effect.fn("GitHubService.getRepositoryMergeMethods")(function* (repository: string) {
				const response = yield* ghJson("getRepositoryMergeMethods", RepositoryMergeMethodsResponseSchema, [
					"repo",
					"view",
					repository,
					"--json",
					"squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed",
				])
				return parseRepositoryMergeMethods(response)
			})

			const mergePullRequest = (repository: string, number: number, action: PullRequestMergeAction) =>
				ghVoid("mergePullRequest", ["pr", "merge", String(number), "--repo", repository, ...mergeActionCliArgs(action)])

			const closePullRequest = (repository: string, number: number) => ghVoid("closePullRequest", ["pr", "close", String(number), "--repo", repository])

			const closeIssue = (repository: string, number: number) => ghVoid("closeIssue", ["issue", "close", String(number), "--repo", repository])

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
				if (!review) return fallbackReplyComment(inReplyTo, body)
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
				if (!review) return fallbackEditedReviewComment(commentId, body)
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
				ghJson("listRepoLabels", RepoLabelsResponseSchema, ["label", "list", "--repo", repository, "--json", "name,color", "--limit", "1000"]).pipe(
					Effect.map((labels) => labels.map((label) => ({ name: label.name, color: `#${label.color}` }))),
				)

			const addPullRequestLabel = (repository: string, number: number, label: string) =>
				ghVoid("addPullRequestLabel", ["pr", "edit", String(number), "--repo", repository, "--add-label", label])

			const removePullRequestLabel = (repository: string, number: number, label: string) =>
				ghVoid("removePullRequestLabel", ["pr", "edit", String(number), "--repo", repository, "--remove-label", label])

			const addIssueLabel = (repository: string, number: number, label: string) =>
				ghVoid("addIssueLabel", ["issue", "edit", String(number), "--repo", repository, "--add-label", label])

			const removeIssueLabel = (repository: string, number: number, label: string) =>
				ghVoid("removeIssueLabel", ["issue", "edit", String(number), "--repo", repository, "--remove-label", label])

			return GitHubService.of({
				listPullRequestPage,
				listIssuePage,
				listAllPullRequests,
				listAllIssues,
				getPullRequestDetails,
				getRepositoryDetails,
				getAuthenticatedUser,
				getPullRequestDiff,
				listPullRequestReviewComments,
				listPullRequestComments,
				listIssueComments,
				getPullRequestMergeInfo,
				getRepositoryMergeMethods,
				mergePullRequest,
				closePullRequest,
				closeIssue,
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
				addIssueLabel,
				removeIssueLabel,
			})
		}),
	)

	static readonly layer = GitHubService.layerNoDeps.pipe(Layer.provide(CommandRunner.layer))
}
