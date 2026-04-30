import { Context, Effect, Layer } from "effect"
import { config } from "../config.js"
import type { CheckItem, PullRequestItem, PullRequestMergeAction, PullRequestMergeInfo } from "../domain.js"
import { CommandRunner, type CommandError, type JsonParseError } from "./CommandRunner.js"

interface GitHubPullRequestSummaryNode {
	readonly number: number
	readonly title: string
	readonly isDraft: boolean
	readonly reviewDecision: string | null
	readonly autoMergeRequest: unknown | null
	readonly state: string
	readonly createdAt: string
	readonly closedAt?: string | null
	readonly url: string
	readonly repository: {
		readonly nameWithOwner: string
	}
}

interface GitHubPullRequestNode extends GitHubPullRequestSummaryNode {
	readonly body: string
	readonly labels: {
		readonly nodes: readonly {
			readonly name: string
			readonly color?: string | null
		}[]
	}
	readonly additions: number
	readonly deletions: number
	readonly changedFiles: number
	readonly statusCheckRollup?: {
		readonly contexts: {
			readonly nodes: readonly GraphQLCheckContext[]
		}
	} | null
}

type GraphQLCheckContext =
	| {
		readonly __typename: "CheckRun"
		readonly name?: string | null
		readonly status?: string | null
		readonly conclusion?: string | null
	}
	| {
		readonly __typename: "StatusContext"
		readonly context?: string | null
		readonly state?: string | null
	}

interface GraphQLSearchResponse {
	readonly data: {
		readonly search: {
			readonly nodes: readonly (GitHubPullRequestNode | null)[]
			readonly pageInfo: {
				readonly hasNextPage: boolean
				readonly endCursor: string | null
			}
		}
	}
}

interface GraphQLSearchSummaryResponse {
	readonly data: {
		readonly search: {
			readonly nodes: readonly (GitHubPullRequestSummaryNode | null)[]
			readonly pageInfo: {
				readonly hasNextPage: boolean
				readonly endCursor: string | null
			}
		}
	}
}

interface GitHubViewer {
	readonly login: string
}

interface GitHubMergeInfoResponse {
	readonly number: number
	readonly title: string
	readonly state: string
	readonly isDraft: boolean
	readonly mergeable: string
	readonly reviewDecision: string | null
	readonly autoMergeRequest: unknown | null
	readonly statusCheckRollup: readonly GraphQLCheckContext[]
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
        createdAt
        closedAt
        url
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
        createdAt
        closedAt
        url
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

const getReviewStatus = (item: { readonly isDraft: boolean; readonly reviewDecision: string | null }): PullRequestItem["reviewStatus"] => {
	if (item.isDraft) return "draft"
	if (item.reviewDecision === "APPROVED") return "approved"
	if (item.reviewDecision === "CHANGES_REQUESTED") return "changes"
	if (item.reviewDecision === "REVIEW_REQUIRED") return "review"
	return "none"
}

const normalizeCheckStatus = (raw?: string | null): CheckItem["status"] => {
	if (raw === "COMPLETED") return "completed"
	if (raw === "IN_PROGRESS") return "in_progress"
	if (raw === "QUEUED") return "queued"
	return "pending"
}

const normalizeCheckConclusion = (raw?: string | null): CheckItem["conclusion"] => {
	if (raw === "SUCCESS") return "success"
	if (raw === "FAILURE" || raw === "ERROR") return "failure"
	if (raw === "NEUTRAL") return "neutral"
	if (raw === "SKIPPED") return "skipped"
	if (raw === "CANCELLED") return "cancelled"
	if (raw === "TIMED_OUT") return "timed_out"
	return null
}

const getContextStatus = (context: GraphQLCheckContext): CheckItem["status"] => {
	if (context.__typename === "CheckRun") return normalizeCheckStatus(context.status)
	if (context.state === "PENDING") return "in_progress"
	return "completed"
}

const getContextConclusion = (context: GraphQLCheckContext): CheckItem["conclusion"] => {
	if (context.__typename === "CheckRun") return normalizeCheckConclusion(context.conclusion)
	if (context.state === "SUCCESS") return "success"
	if (context.state === "FAILURE" || context.state === "ERROR") return "failure"
	return null
}

const getCheckInfoFromContexts = (contexts: readonly GraphQLCheckContext[]): Pick<PullRequestItem, "checkStatus" | "checkSummary" | "checks"> => {
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

const getCheckInfo = (item: GitHubPullRequestNode): Pick<PullRequestItem, "checkStatus" | "checkSummary" | "checks"> =>
	getCheckInfoFromContexts(item.statusCheckRollup?.contexts.nodes ?? [])

const parsePullRequest = (item: GitHubPullRequestNode): PullRequestItem => {
	const checkInfo = getCheckInfo(item)

	return {
		repository: item.repository.nameWithOwner,
		number: item.number,
		title: item.title,
		body: item.body,
		labels: item.labels.nodes.map((label) => ({
			name: label.name,
			color: label.color ? `#${label.color}` : null,
		})),
		additions: item.additions,
		deletions: item.deletions,
		changedFiles: item.changedFiles,
		state: item.state.toLowerCase() === "open" ? "open" : "closed",
		reviewStatus: getReviewStatus(item),
		checkStatus: checkInfo.checkStatus,
		checkSummary: checkInfo.checkSummary,
		checks: checkInfo.checks,
		autoMergeEnabled: item.autoMergeRequest !== null,
		detailLoaded: true,
		createdAt: new Date(item.createdAt),
		closedAt: normalizeDate(item.closedAt),
		url: item.url,
	}
}

const parsePullRequestSummary = (item: GitHubPullRequestSummaryNode): PullRequestItem => ({
	repository: item.repository.nameWithOwner,
	number: item.number,
	title: item.title,
	body: "",
	labels: [],
	additions: 0,
	deletions: 0,
	changedFiles: 0,
	state: item.state.toLowerCase() === "open" ? "open" : "closed",
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

const searchQuery = (author: string) => `author:${author} is:pr is:open sort:created-desc`

type GitHubError = CommandError | JsonParseError

const normalizeMergeable = (value: string): PullRequestMergeInfo["mergeable"] => {
	if (value === "MERGEABLE") return "mergeable"
	if (value === "CONFLICTING") return "conflicting"
	return "unknown"
}

export class GitHubService extends Context.Service<GitHubService, {
	readonly listOpenPullRequests: () => Effect.Effect<readonly PullRequestItem[], GitHubError>
	readonly listOpenPullRequestDetails: () => Effect.Effect<readonly PullRequestItem[], GitHubError>
	readonly getAuthenticatedUser: () => Effect.Effect<string, GitHubError>
	readonly getPullRequestDiff: (repository: string, number: number) => Effect.Effect<string, CommandError>
	readonly getPullRequestMergeInfo: (repository: string, number: number) => Effect.Effect<PullRequestMergeInfo, GitHubError>
	readonly mergePullRequest: (repository: string, number: number, action: PullRequestMergeAction) => Effect.Effect<void, CommandError>
	readonly toggleDraftStatus: (repository: string, number: number, isDraft: boolean) => Effect.Effect<void, CommandError>
	readonly listRepoLabels: (repository: string) => Effect.Effect<readonly { readonly name: string; readonly color: string | null }[], GitHubError>
	readonly addPullRequestLabel: (repository: string, number: number, label: string) => Effect.Effect<void, CommandError>
	readonly removePullRequestLabel: (repository: string, number: number, label: string) => Effect.Effect<void, CommandError>
}>()("ghui/GitHubService") {
	static readonly layerNoDeps = Layer.effect(
		GitHubService,
		Effect.gen(function*() {
			const command = yield* CommandRunner

			const listOpenPullRequests = Effect.fn("GitHubService.listOpenPullRequests")(function*() {
				const pullRequests: PullRequestItem[] = []
				let cursor: string | null = null

				while (pullRequests.length < config.prFetchLimit) {
					const pageSize = Math.min(100, config.prFetchLimit - pullRequests.length)
					const response: GraphQLSearchSummaryResponse = yield* command.runJson<GraphQLSearchSummaryResponse>("gh", [
						"api", "graphql",
						"-f", `query=${pullRequestSummarySearchQuery}`,
						"-F", `searchQuery=${searchQuery(config.author)}`,
						"-F", `first=${pageSize}`,
						...(cursor ? ["-F", `after=${cursor}`] : []),
					])

					for (const node of response.data.search.nodes) {
						if (node) pullRequests.push(parsePullRequestSummary(node))
					}

					if (!response.data.search.pageInfo.hasNextPage) break
					cursor = response.data.search.pageInfo.endCursor
					if (!cursor) break
				}

				return pullRequests.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
			})

			const listOpenPullRequestDetails = Effect.fn("GitHubService.listOpenPullRequestDetails")(function*() {
				const pullRequests: PullRequestItem[] = []
				let cursor: string | null = null

				while (pullRequests.length < config.prFetchLimit) {
					const pageSize = Math.min(100, config.prFetchLimit - pullRequests.length)
					const response: GraphQLSearchResponse = yield* command.runJson<GraphQLSearchResponse>("gh", [
						"api", "graphql",
						"-f", `query=${pullRequestSearchQuery}`,
						"-F", `searchQuery=${searchQuery(config.author)}`,
						"-F", `first=${pageSize}`,
						...(cursor ? ["-F", `after=${cursor}`] : []),
					])

					for (const node of response.data.search.nodes) {
						if (node) pullRequests.push(parsePullRequest(node))
					}

					if (!response.data.search.pageInfo.hasNextPage) break
					cursor = response.data.search.pageInfo.endCursor
					if (!cursor) break
				}

				return pullRequests.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
			})

			const getAuthenticatedUser = Effect.fn("GitHubService.getAuthenticatedUser")(function*() {
				const viewer = yield* command.runJson<GitHubViewer>("gh", ["api", "user"])
				return viewer.login
			})

			const getPullRequestDiff = Effect.fn("GitHubService.getPullRequestDiff")(function*(repository: string, number: number) {
				const result = yield* command.run("gh", ["pr", "diff", String(number), "--repo", repository, "--color", "never"])
				return result.stdout
			})

			const getPullRequestMergeInfo = Effect.fn("GitHubService.getPullRequestMergeInfo")(function*(repository: string, number: number) {
				const info = yield* command.runJson<GitHubMergeInfoResponse>("gh", [
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
				if (action === "disable-auto") {
					yield* command.run("gh", [...base, "--disable-auto"])
				} else if (action === "auto") {
					yield* command.run("gh", [...base, "--squash", "--auto", "--delete-branch"])
				} else if (action === "admin") {
					yield* command.run("gh", [...base, "--squash", "--admin", "--delete-branch"])
				} else {
					yield* command.run("gh", [...base, "--squash", "--delete-branch"])
				}
			})

			const toggleDraftStatus = Effect.fn("GitHubService.toggleDraftStatus")(function*(repository: string, number: number, isDraft: boolean) {
				yield* command.run("gh", ["pr", "ready", String(number), "--repo", repository, ...(isDraft ? [] : ["--undo"])])
			})

			const listRepoLabels = Effect.fn("GitHubService.listRepoLabels")(function*(repository: string) {
				const labels = yield* command.runJson<readonly { name: string; color: string }[]>("gh", [
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
				getPullRequestMergeInfo,
				mergePullRequest,
				toggleDraftStatus,
				listRepoLabels,
				addPullRequestLabel,
				removePullRequestLabel,
			})
		}),
	)

	static readonly layer = GitHubService.layerNoDeps.pipe(Layer.provide(CommandRunner.layer))
}
