import { Effect, Layer } from "effect"
import type {
	CheckItem,
	CreatePullRequestCommentInput,
	IssueItem,
	Mergeable,
	PullRequestComment,
	PullRequestItem,
	PullRequestMergeInfo,
	PullRequestQueueMode,
	PullRequestReviewComment,
	ReviewStatus,
} from "../domain.js"
import type { ItemListInput } from "../item.js"
import { mergeInfoFromPullRequest } from "../mergeActions.js"
import { mockAuthor, mockBody, mockIssueTitle, mockLabels, mockPullRequestBranch, mockPullRequestTitle } from "./mockData.js"
import { mockWorkflowRunDetails, mockWorkflowRuns } from "./mockRuns.js"
import { GitHubService } from "./GitHubService.js"
import { loadMockFixtureSnapshot } from "./mockFixtures.js"

export interface MockOptions {
	readonly prCount: number
	readonly repoCount?: number
	readonly repository?: string | null
	readonly repositories?: readonly string[]
	readonly username?: string
	readonly seed?: number
}

const REVIEW_CYCLE: readonly ReviewStatus[] = ["approved", "changes", "review", "none", "draft"]
const MERGEABLE_CYCLE: readonly Mergeable[] = ["mergeable", "conflicting", "unknown"]
const MOCK_REPOSITORIES = ["mock-org/repo-0", "mock-org/repo-1", "mock-org/repo-2", "mock-org/repo-3"] as const

const mockRepository = (index: number, primaryRepository: string | null) =>
	index === 0 && primaryRepository ? primaryRepository : (MOCK_REPOSITORIES[index % MOCK_REPOSITORIES.length] ?? `mock-org/repo-${index}`)

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

const buildPullRequest = (index: number, options: Required<MockOptions>): PullRequestItem => {
	const repoIndex = index % options.repoCount
	const repository = options.repositories[repoIndex % options.repositories.length] ?? mockRepository(repoIndex, options.repository)
	const number = 1000 + index
	const total = 8 + (index % 5)
	const passed = total - (index % 3 === 0 ? 1 : 0)
	const review = REVIEW_CYCLE[index % REVIEW_CYCLE.length]!
	const createdAt = new Date(Date.now() - index * 86_400_000)
	const updatedAt = new Date(Date.now() - index * 3_600_000)

	return {
		repository,
		author: index % 4 === 0 ? options.username : mockAuthor(index),
		headRefOid: `deadbeef${index.toString(16).padStart(8, "0")}`,
		headRefName: mockPullRequestBranch(index),
		baseRefName: index % 9 === 0 ? "release" : "main",
		defaultBranchName: "main",
		number,
		title: mockPullRequestTitle(index),
		body: mockBody("pull-request", index),
		labels: mockLabels(index),
		additions: 10 + index,
		deletions: 5 + (index % 11),
		changedFiles: 1 + (index % 7),
		state: "open",
		reviewStatus: review,
		...synthCheckSummary(passed, total),
		autoMergeEnabled: index % 11 === 0,
		detailLoaded: true,
		createdAt,
		updatedAt,
		closedAt: null,
		url: `https://github.com/${repository}/pull/${number}`,
	}
}

export const buildMockPullRequests = (options: MockOptions): readonly PullRequestItem[] => {
	const resolved: Required<MockOptions> = {
		prCount: options.prCount,
		repoCount: options.repoCount ?? 4,
		repository: options.repository ?? null,
		repositories: options.repositories ?? [],
		username: options.username ?? "mock-user",
		seed: options.seed ?? 0,
	}
	return Array.from({ length: resolved.prCount }, (_, index) => buildPullRequest(index, resolved))
}

const buildMockIssues = (options: MockOptions): readonly IssueItem[] => {
	const resolved: Required<MockOptions> = {
		prCount: options.prCount,
		repoCount: options.repoCount ?? 4,
		repository: options.repository ?? null,
		repositories: options.repositories ?? [],
		username: options.username ?? "mock-user",
		seed: options.seed ?? 0,
	}
	return Array.from({ length: Math.max(8, Math.ceil(resolved.prCount / 3)) }, (_, index) => {
		const repoIndex = index % resolved.repoCount
		const repository = mockRepository(repoIndex, resolved.repository)
		const number = 2000 + index
		return {
			repository,
			number,
			state: "open" as const,
			title: mockIssueTitle(index),
			body: mockBody("issue", index),
			author: index % 2 === 0 ? resolved.username : mockAuthor(index),
			labels: mockLabels(index),
			commentCount: index % 6,
			createdAt: new Date(Date.now() - index * 43_200_000),
			updatedAt: new Date(Date.now() - index * 3_600_000),
			url: `https://github.com/${repository}/issues/${number}`,
		} satisfies IssueItem
	})
}

const filterByView = (mode: PullRequestQueueMode, repository: string | null, source: readonly PullRequestItem[], username: string, strictUserScope: boolean) => {
	if (mode === "repository") return repository ? source.filter((item) => item.repository === repository) : []
	if (repository) return source.filter((item) => item.repository === repository)
	if (!strictUserScope) return source
	const authored = source.filter((item) => item.author === username)
	if (mode === "authored") return authored
	if (mode === "review") return source.filter((item) => item.author !== username && item.reviewStatus === "review")
	if (mode === "assigned") return source.filter((item) => item.author !== username && item.reviewStatus === "changes")
	return source.filter((item) => item.author !== username).slice(0, Math.ceil(source.length / 8))
}

const slicePage = <T>(source: readonly T[], cursor: string | null, pageSize: number): { items: readonly T[]; endCursor: string | null; hasNextPage: boolean } => {
	const start = cursor ? Number.parseInt(cursor, 10) : 0
	const safeStart = Number.isFinite(start) && start >= 0 ? start : 0
	const safePageSize = Math.max(1, Math.min(100, pageSize))
	const end = Math.min(source.length, safeStart + safePageSize)
	return { items: source.slice(safeStart, end), endCursor: end > safeStart ? String(end) : null, hasNextPage: end < source.length }
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

const uniqueLabels = (items: readonly { readonly labels: readonly { readonly name: string; readonly color: string | null }[] }[]) => {
	const byName = new Map<string, { readonly name: string; readonly color: string | null }>()
	for (const item of items) {
		for (const label of item.labels) {
			const key = label.name.toLowerCase()
			if (!byName.has(key)) byName.set(key, label)
		}
	}
	return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export const MockGitHubService = {
	layer: (options: MockOptions) => {
		const fixture = loadMockFixtureSnapshot()
		const strictUserScope = fixture !== null
		const username = options.username ?? "mock-user"
		const items = fixture ? fixture.pullRequests.slice(0, options.prCount) : buildMockPullRequests(options)
		const userItems = fixture
			? buildMockPullRequests({
					prCount: Math.max(8, Math.min(24, Math.ceil(options.prCount / 8))),
					repoCount: options.repoCount ?? 4,
					repository: null,
					...(options.repositories ? { repositories: options.repositories } : {}),
					username,
				})
			: items.map((item) => ({ ...item, author: username }))
		const issues = fixture ? fixture.issues : buildMockIssues(options)
		const fixturePullRequestsByKey = new Map(fixture ? fixture.pullRequests.map((item) => [`${item.repository}#${item.number}`, item]) : [])
		const fixtureIssuesByKey = new Map(fixture ? fixture.issues.map((item) => [`${item.repository}#${item.number}`, item]) : [])
		const pullRequestSource = (mode: PullRequestQueueMode, repository: string | null) => (mode === "repository" || repository ? items : userItems)

		// Map the new `ItemListMode` onto the legacy `PullRequestQueueMode` filter
		// path so the mock applies the same scoping as the real service.
		const queueModeForListMode = (mode: "all" | "authored" | "review" | "assigned" | "mentioned"): PullRequestQueueMode => (mode === "all" ? "repository" : mode)

		const filterIssuesByMode = (mode: "all" | "authored" | "assigned" | "mentioned", repository: string | null, source: readonly IssueItem[]): readonly IssueItem[] => {
			const scopedToRepo = repository ? source.filter((issue) => issue.repository === repository) : source
			if (mode === "all") return scopedToRepo
			if (mode === "authored") return scopedToRepo.filter((issue) => issue.author === username)
			// Mock has no assignee/mentions metadata; treat both as "items not authored by me"
			// so the mode visibly differs from "authored".
			return scopedToRepo.filter((issue) => issue.author !== username).slice(0, Math.max(1, Math.ceil(scopedToRepo.length / 4)))
		}
		const fixturePullRequest = (repository: string, number: number) => fixturePullRequestsByKey.get(`${repository}#${number}`) ?? null
		const fixtureIssue = (repository: string, number: number) => fixtureIssuesByKey.get(`${repository}#${number}`) ?? null
		const findPullRequest = (repository: string, number: number) => [...items, ...userItems].find((item) => item.repository === repository && item.number === number) ?? items[0]!
		const labelsForRepository = (repository: string) =>
			uniqueLabels([...items.filter((item) => item.repository === repository), ...issues.filter((issue) => issue.repository === repository)])
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
		const pullRequestComments = (repository: string, number: number): readonly PullRequestComment[] =>
			fixturePullRequest(repository, number)?.comments ?? comments(repository, number)
		const issueComments = (repository: string, number: number): readonly PullRequestComment[] => {
			const fixture = fixtureIssue(repository, number)
			if (fixture?.comments) return fixture.comments
			const issue = fixture ?? issues.find((item) => item.repository === repository && item.number === number)
			if (!issue) return []
			return issue.commentCount > 0
				? comments(repository, number)
						.filter((comment) => comment._tag === "comment")
						.slice(0, issue.commentCount)
				: []
		}
		const reviewComments = (repository: string, number: number): readonly PullRequestReviewComment[] =>
			fixturePullRequest(repository, number)?.reviewComments ??
			pullRequestComments(repository, number).flatMap((comment) =>
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
				getPullRequestDetails: (repository, number) => Effect.succeed(findPullRequest(repository, number)),
				getRepositoryDetails: (repository: string) => {
					const seed = Array.from(repository).reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 0)
					const openIssueCount = issues.filter((issue) => issue.repository === repository).length
					const openPullRequestCount = items.filter((item) => item.repository === repository).length
					return Effect.succeed({
						repository,
						description: `Mock repository ${repository} — synthesized for offline development.`,
						url: `https://github.com/${repository}`,
						stargazerCount: 12 + (seed % 4000),
						forkCount: 1 + (seed % 80),
						openIssueCount,
						openPullRequestCount,
						defaultBranch: "main",
						pushedAt: new Date(Date.now() - (seed % 86_400_000)),
						isArchived: false,
						isPrivate: seed % 5 === 0,
					})
				},
				getAuthenticatedUser: () => Effect.succeed(username),
				getPullRequestDiff: (repository, number) => Effect.succeed(fixturePullRequest(repository, number)?.diff ?? mockDiff),
				listWorkflowRunsForCommit: (repository, headSha) => Effect.succeed(mockWorkflowRuns(repository, headSha)),
				getWorkflowRunDetails: (repository, runId) => {
					for (const pr of [...items, ...userItems]) {
						const details = mockWorkflowRunDetails(repository, pr.headRefOid, runId)
						if (details) return Effect.succeed(details)
					}
					// Unknown id (shouldn't happen in mock): fall back to the first PR's first run.
					const firstSha = items[0]?.headRefOid ?? "deadbeef00000000"
					const first = mockWorkflowRuns(repository, firstSha)[0]
					return Effect.succeed(mockWorkflowRunDetails(repository, firstSha, first?.id ?? runId) ?? { ...(first ?? ({} as never)), jobs: [] })
				},
				listPullRequestReviewComments: (repository, number) => Effect.succeed(reviewComments(repository, number)),
				listPullRequestComments: (repository, number) => Effect.succeed(pullRequestComments(repository, number)),
				listIssueComments: (repository, number) => Effect.succeed(issueComments(repository, number)),
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
				closeIssue: () => Effect.void,
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
				listRepoLabels: (repository) => Effect.succeed(labelsForRepository(repository)),
				addPullRequestLabel: () => Effect.void,
				removePullRequestLabel: () => Effect.void,
				addIssueLabel: () => Effect.void,
				removeIssueLabel: () => Effect.void,
				listPullRequestPage: (input: ItemListInput<"pullRequest">) => {
					const queueMode = queueModeForListMode(input.mode)
					const filtered = filterByView(queueMode, input.repository, pullRequestSource(queueMode, input.repository), username, strictUserScope)
					return Effect.succeed(slicePage(filtered, input.cursor, input.pageSize))
				},
				listIssuePage: (input: ItemListInput<"issue">) => Effect.succeed(slicePage(filterIssuesByMode(input.mode, input.repository, issues), input.cursor, input.pageSize)),
				listAllPullRequests: (input: {
					readonly kind: "pullRequest"
					readonly mode: "all" | "authored" | "review" | "assigned" | "mentioned"
					readonly repository: string | null
				}) => {
					const queueMode = queueModeForListMode(input.mode)
					return Effect.succeed(filterByView(queueMode, input.repository, pullRequestSource(queueMode, input.repository), username, strictUserScope))
				},
				listAllIssues: (input: { readonly kind: "issue"; readonly mode: "all" | "authored" | "assigned" | "mentioned"; readonly repository: string | null }) =>
					Effect.succeed(filterIssuesByMode(input.mode, input.repository, issues)),
			}),
		)
	},
}
