import { Effect, Layer } from "effect"
import type {
	CheckItem,
	CreatePullRequestCommentInput,
	Mergeable,
	PullRequestComment,
	PullRequestItem,
	PullRequestLabel,
	PullRequestMergeInfo,
	PullRequestPage,
	PullRequestQueueMode,
	PullRequestReviewComment,
	PullRequestStateFilter,
	ReviewStatus,
} from "../domain.js"
import { mergeInfoFromPullRequest } from "../mergeActions.js"
import { GitHubService } from "./GitHubService.js"

export interface MockOptions {
	readonly prCount: number
	readonly repoCount?: number
	readonly username?: string
	readonly seed?: number
}

const REVIEW_CYCLE: readonly ReviewStatus[] = ["approved", "changes", "review", "none", "draft"]
const MERGEABLE_CYCLE: readonly Mergeable[] = ["mergeable", "conflicting", "unknown"]

const synthCheckSummary = (passed: number, total: number): Pick<PullRequestItem, "checkStatus" | "checkSummary" | "checks"> => {
	const checks: readonly CheckItem[] = Array.from({ length: total }, (_, index) => ({
		name: `check-${index}`,
		status: "completed",
		conclusion: index < passed ? "success" : "failure",
	}))
	if (total === 0) return { checkStatus: "none", checkSummary: null, checks: [] }
	if (passed === total) return { checkStatus: "passing", checkSummary: `${passed}/${total}`, checks }
	return { checkStatus: "failing", checkSummary: `${passed}/${total}`, checks }
}

const synthLabels = (index: number): readonly PullRequestLabel[] => {
	if (index % 5 === 0) return [{ name: "bug", color: "#d73a4a" }]
	if (index % 7 === 0)
		return [
			{ name: "enhancement", color: "#a2eeef" },
			{ name: "tests", color: "#0e8a16" },
		]
	return []
}

const buildPullRequest = (index: number, options: Required<MockOptions>): PullRequestItem => {
	const repoIndex = index % options.repoCount
	const repository = `mock-org/repo-${repoIndex}`
	const number = 1000 + index
	const total = 8 + (index % 5)
	const passed = total - (index % 3 === 0 ? 1 : 0)
	const review = REVIEW_CYCLE[index % REVIEW_CYCLE.length]!
	const createdAt = new Date(Date.now() - index * 86_400_000)

	return {
		repository,
		author: options.username,
		headRefOid: `deadbeef${index.toString(16).padStart(8, "0")}`,
		headRefName: `mock-branch-${index}`,
		number,
		title: `Mock PR ${number}: example change ${index}`,
		body: `This is mock pull request #${number}.\n\nLine A.\nLine B.`,
		labels: synthLabels(index),
		additions: 10 + index,
		deletions: 5 + (index % 11),
		changedFiles: 1 + (index % 7),
		state: "open",
		reviewStatus: review,
		...synthCheckSummary(passed, total),
		autoMergeEnabled: index % 11 === 0,
		detailLoaded: true,
		createdAt,
		closedAt: null,
		url: `https://github.com/${repository}/pull/${number}`,
	}
}

export const buildMockPullRequests = (options: MockOptions): readonly PullRequestItem[] => {
	const resolved: Required<MockOptions> = {
		prCount: options.prCount,
		repoCount: options.repoCount ?? 4,
		username: options.username ?? "mock-user",
		seed: options.seed ?? 0,
	}
	return Array.from({ length: resolved.prCount }, (_, index) => buildPullRequest(index, resolved))
}

const filterByState = (stateFilter: PullRequestStateFilter, source: readonly PullRequestItem[]) => source.filter((item) => item.state === stateFilter)

const filterByView = (mode: PullRequestQueueMode, repository: string | null, stateFilter: PullRequestStateFilter, source: readonly PullRequestItem[]) => {
	const filtered = filterByState(stateFilter, source)
	if (mode === "repository") return repository ? filtered.filter((item) => item.repository === repository) : []
	return filtered
}

const pageItems = (source: readonly PullRequestItem[], cursor: string | null, pageSize: number): PullRequestPage => {
	const start = cursor ? Number.parseInt(cursor, 10) : 0
	const safeStart = Number.isFinite(start) && start >= 0 ? start : 0
	const safePageSize = Math.max(1, Math.min(100, pageSize))
	const end = Math.min(source.length, safeStart + safePageSize)
	return {
		items: source.slice(safeStart, end),
		endCursor: end > safeStart ? String(end) : null,
		hasNextPage: end < source.length,
	}
}

const mockDiff = `diff --git a/src/mockDiff.ts b/src/mockDiff.ts
--- a/src/mockDiff.ts
+++ b/src/mockDiff.ts
@@ -1,6 +1,6 @@
 export const before = true
-const oldOne = 1
+const newOne = 1
-  sameName()
+	sameName()
-const oldTwo = 2
+const newTwo = 2
 export const after = true`

export const MockGitHubService = {
	layer: (options: MockOptions) => {
		const items = buildMockPullRequests(options)
		const username = options.username ?? "mock-user"
		const summaryItems = items.map(
			(item) =>
				({
					...item,
					body: "",
					labels: [],
					additions: 0,
					deletions: 0,
					changedFiles: 0,
					detailLoaded: false,
				}) satisfies PullRequestItem,
		)
		const findPullRequest = (repository: string, number: number) => items.find((item) => item.repository === repository && item.number === number) ?? items[0]!
		const comments = (repository: string, number: number): readonly PullRequestComment[] => [
			{
				_tag: "comment",
				id: `mock-comment:${repository}:${number}:1`,
				author: "mock-reviewer",
				body: `Top-level discussion for #${number}. This should appear after the summary with its own separator.`,
				createdAt: new Date(Date.now() - 3_600_000),
				url: null,
			},
			{
				_tag: "review-comment",
				id: `mock-review:${repository}:${number}:1`,
				author: "mock-reviewer",
				body: "Inline review comment rendered in the same comments stream.",
				createdAt: new Date(Date.now() - 1_800_000),
				url: null,
				path: "src/App.tsx",
				line: 42,
				side: "RIGHT",
				inReplyTo: null,
			},
			{
				_tag: "review-comment",
				id: `mock-review:${repository}:${number}:2`,
				author: "another-reviewer",
				body: "Threaded reply on the same line — should render indented.",
				createdAt: new Date(Date.now() - 1_200_000),
				url: null,
				path: "src/App.tsx",
				line: 42,
				side: "RIGHT",
				inReplyTo: `mock-review:${repository}:${number}:1`,
			},
		]
		const reviewComments = (repository: string, number: number): readonly PullRequestReviewComment[] =>
			comments(repository, number).flatMap((comment) =>
				comment._tag === "review-comment"
					? [
							{
								id: comment.id,
								path: comment.path,
								line: comment.line,
								side: comment.side,
								author: comment.author,
								body: comment.body,
								createdAt: comment.createdAt,
								url: comment.url,
								inReplyTo: comment.inReplyTo,
							},
						]
					: [],
			)

		return Layer.succeed(
			GitHubService,
			GitHubService.of({
				listOpenPullRequests: (mode: PullRequestQueueMode, repository: string | null, stateFilter: PullRequestStateFilter) =>
					Effect.succeed(filterByView(mode, repository, stateFilter, summaryItems)),
				listOpenPullRequestPage: (input) => Effect.succeed(pageItems(filterByView(input.mode, input.repository, input.stateFilter, summaryItems), input.cursor, input.pageSize)),
				listOpenPullRequestDetails: (mode: PullRequestQueueMode, repository: string | null, stateFilter: PullRequestStateFilter) =>
					Effect.succeed(filterByView(mode, repository, stateFilter, items)),
				getPullRequestDetails: (repository, number) => Effect.succeed(findPullRequest(repository, number)),
				getAuthenticatedUser: () => Effect.succeed(username),
				getPullRequestDiff: (_repo, _number) => Effect.succeed(mockDiff),
				listPullRequestReviewComments: (repository, number) => Effect.succeed(reviewComments(repository, number)),
				listPullRequestComments: (repository, number) => Effect.succeed(comments(repository, number)),
				getPullRequestMergeInfo: (repository, number) => {
					const pr = findPullRequest(repository, number)
					return Effect.succeed({
						...mergeInfoFromPullRequest(pr),
						repository,
						number,
						mergeable: MERGEABLE_CYCLE[number % MERGEABLE_CYCLE.length]!,
						reviewStatus: pr.reviewStatus === "draft" ? "approved" : pr.reviewStatus,
						checkStatus: "passing",
						checkSummary: "10/10",
					} satisfies PullRequestMergeInfo)
				},
				getRepositoryMergeMethods: () => Effect.succeed({ squash: true, merge: true, rebase: true }),
				mergePullRequest: () => Effect.void,
				closePullRequest: () => Effect.void,
				createPullRequestComment: (input: CreatePullRequestCommentInput) =>
					Effect.succeed({
						id: `mock:${Date.now()}`,
						path: input.path,
						line: input.line,
						side: input.side,
						author: username,
						body: input.body,
						createdAt: new Date(),
						url: null,
						inReplyTo: null,
					} satisfies PullRequestReviewComment),
				createPullRequestIssueComment: (_repo, _number, body) =>
					Effect.succeed({
						_tag: "comment" as const,
						id: `mock-issue:${Date.now()}`,
						author: username,
						body,
						createdAt: new Date(),
						url: null,
					}),
				replyToReviewComment: (_repo, _number, inReplyTo, body) =>
					Effect.succeed({
						_tag: "review-comment" as const,
						id: `mock-reply:${inReplyTo}:${Date.now()}`,
						path: "src/App.tsx",
						line: 42,
						side: "RIGHT" as const,
						author: username,
						body,
						createdAt: new Date(),
						url: null,
						inReplyTo,
					}),
				editPullRequestIssueComment: (_repo, commentId, body) =>
					Effect.succeed({
						_tag: "comment" as const,
						id: commentId,
						author: username,
						body,
						createdAt: new Date(),
						url: null,
					}),
				editReviewComment: (_repo, commentId, body) =>
					Effect.succeed({
						_tag: "review-comment" as const,
						id: commentId,
						path: "src/App.tsx",
						line: 42,
						side: "RIGHT" as const,
						author: username,
						body,
						createdAt: new Date(),
						url: null,
						inReplyTo: null,
					}),
				deletePullRequestIssueComment: () => Effect.void,
				deleteReviewComment: () => Effect.void,
				submitPullRequestReview: () => Effect.void,
				toggleDraftStatus: () => Effect.void,
				listRepoLabels: () => Effect.succeed([]),
				addPullRequestLabel: () => Effect.void,
				removePullRequestLabel: () => Effect.void,
			}),
		)
	},
}
