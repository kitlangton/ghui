import { Effect, Layer } from "effect"
import type {
	Branch,
	CheckItem,
	CreatePullRequestCommentInput,
	CreateReleaseInput,
	DiscussionCategory,
	Mergeable,
	PullRequestComment,
	PullRequestItem,
	PullRequestLabel,
	PullRequestMergeInfo,
	PullRequestPage,
	PullRequestQueueMode,
	PullRequestReviewComment,
	Release,
	ReleasePage,
	ReleaseSummary,
	ReviewStatus,
	Tag,
	UpdateReleaseInput,
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

const filterByView = (mode: PullRequestQueueMode, repository: string | null, source: readonly PullRequestItem[]) => {
	if (mode === "repository") return repository ? source.filter((item) => item.repository === repository) : []
	return source
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

const buildMockReleases = (repos: readonly string[]): Map<string, Release[]> => {
	const map = new Map<string, Release[]>()
	for (const repo of repos) {
		const releases: Release[] = Array.from({ length: 3 }, (_, index) => {
			const version = `v0.${3 - index}.0`
			const publishedAt = new Date(Date.now() - index * 7 * 86_400_000)
			return {
				id: 100 + index,
				tagName: version,
				name: `Release ${version}`,
				isDraft: false,
				isPrerelease: index === 0,
				targetCommitish: "main",
				author: { login: "mock-user" },
				createdAt: publishedAt,
				publishedAt,
				htmlUrl: `https://github.com/${repo}/releases/tag/${version}`,
				body: `## What's changed\n\n- Mock change ${index} A\n- Mock change ${index} B\n`,
				discussionUrl: null,
				assets: [],
			} satisfies Release
		})
		map.set(repo, releases)
	}
	return map
}

export const MockGitHubService = {
	layer: (options: MockOptions) => {
		const items = buildMockPullRequests(options)
		const repos = Array.from(new Set(items.map((item) => item.repository)))
		const releasesByRepo = buildMockReleases(repos)
		let nextReleaseId = 1000
		const toSummary = (release: Release): ReleaseSummary => ({
			id: release.id,
			tagName: release.tagName,
			name: release.name,
			isDraft: release.isDraft,
			isPrerelease: release.isPrerelease,
			targetCommitish: release.targetCommitish,
			author: release.author,
			createdAt: release.createdAt,
			publishedAt: release.publishedAt,
			htmlUrl: release.htmlUrl,
		})
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
				listOpenPullRequests: (mode: PullRequestQueueMode, repository: string | null) => Effect.succeed(filterByView(mode, repository, summaryItems)),
				listOpenPullRequestPage: (input) => Effect.succeed(pageItems(filterByView(input.mode, input.repository, summaryItems), input.cursor, input.pageSize)),
				listOpenPullRequestDetails: (mode: PullRequestQueueMode, repository: string | null) => Effect.succeed(filterByView(mode, repository, items)),
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
				listReleases: (repository: string, page: number, perPage = 30) => {
					const all = releasesByRepo.get(repository) ?? []
					const safePage = Math.max(1, Math.floor(page))
					const safePerPage = Math.max(1, Math.min(100, Math.floor(perPage)))
					const start = (safePage - 1) * safePerPage
					const slice = all.slice(start, start + safePerPage)
					return Effect.succeed({
						items: slice.map(toSummary),
						hasNextPage: start + slice.length < all.length,
						nextPage: start + slice.length < all.length ? safePage + 1 : null,
					} satisfies ReleasePage)
				},
				getRelease: (repository, releaseId) => {
					const found = (releasesByRepo.get(repository) ?? []).find((r) => r.id === releaseId)
					return found ? Effect.succeed(found) : Effect.succeed((releasesByRepo.get(repository) ?? [])[0]!)
				},
				getLatestRelease: (repository) => {
					const all = (releasesByRepo.get(repository) ?? []).filter((r) => !r.isDraft && !r.isPrerelease)
					return Effect.succeed(all[0] ?? null)
				},
				listTags: (repository) => {
					const tags: readonly Tag[] = (releasesByRepo.get(repository) ?? []).map((r) => ({ name: r.tagName, commitSha: "deadbeef" }))
					return Effect.succeed(tags)
				},
				listBranches: (_repository) =>
					Effect.succeed([
						{ name: "main", commitSha: "deadbeef", isDefault: true },
						{ name: "develop", commitSha: "feedface", isDefault: false },
					] satisfies readonly Branch[]),
				getDefaultBranch: () => Effect.succeed("main"),
				generateReleaseNotes: (_repository, input) =>
					Effect.succeed({
						name: `Release ${input.tagName}`,
						body: `## What's Changed\n\n- Mock generated notes for ${input.tagName}\n${input.previousTagName ? `\n**Full Changelog**: ${input.previousTagName}...${input.tagName}\n` : ""}`,
					}),
				listDiscussionCategories: () =>
					Effect.succeed([
						{ id: "DC_1", name: "Announcements", slug: "announcements", emoji: ":mega:" },
						{ id: "DC_2", name: "General", slug: "general", emoji: ":speech_balloon:" },
					] satisfies readonly DiscussionCategory[]),
				createRelease: (repository: string, input: CreateReleaseInput) => {
					const now = new Date()
					const release: Release = {
						id: nextReleaseId++,
						tagName: input.tagName,
						name: input.name ?? null,
						isDraft: input.draft ?? false,
						isPrerelease: input.prerelease ?? false,
						targetCommitish: input.targetCommitish ?? "main",
						author: { login: username },
						createdAt: now,
						publishedAt: input.draft ? null : now,
						htmlUrl: `https://github.com/${repository}/releases/tag/${input.tagName}`,
						body: input.body ?? "",
						discussionUrl: input.discussionCategoryName ? `https://github.com/${repository}/discussions/1` : null,
						assets: [],
					}
					const list = releasesByRepo.get(repository) ?? []
					releasesByRepo.set(repository, [release, ...list])
					return Effect.succeed(release)
				},
				updateRelease: (repository: string, releaseId: number, input: UpdateReleaseInput) => {
					const list = releasesByRepo.get(repository) ?? []
					const idx = list.findIndex((r) => r.id === releaseId)
					if (idx === -1) return Effect.succeed(list[0]!)
					const current = list[idx]!
					const updated: Release = {
						...current,
						tagName: input.tagName ?? current.tagName,
						targetCommitish: input.targetCommitish ?? current.targetCommitish,
						name: input.name !== undefined ? input.name : current.name,
						body: input.body !== undefined ? input.body : current.body,
						isDraft: input.draft ?? current.isDraft,
						isPrerelease: input.prerelease ?? current.isPrerelease,
					}
					const next = [...list]
					next[idx] = updated
					releasesByRepo.set(repository, next)
					return Effect.succeed(updated)
				},
				deleteRelease: (repository, releaseId) => {
					const list = releasesByRepo.get(repository) ?? []
					releasesByRepo.set(
						repository,
						list.filter((r) => r.id !== releaseId),
					)
					return Effect.void
				},
			}),
		)
	},
}
