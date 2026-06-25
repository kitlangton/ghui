import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { CommandRunner, type CommandResult } from "../src/services/CommandRunner.ts"
import { GitHubService } from "../src/services/GitHubService.ts"
import { classifyGitHubRateLimit, isGitHubRateLimitError } from "../src/services/githubRateLimit.ts"

interface RecordedCall {
	readonly command: string
	readonly args: readonly string[]
}

const fakeCommandRunner = (response: string, recorder: RecordedCall[]) =>
	Layer.succeed(
		CommandRunner,
		CommandRunner.of({
			run: (command, args) => {
				recorder.push({ command, args: [...args] })
				const result: CommandResult = { stdout: response, stderr: "", exitCode: 0 }
				return Effect.succeed(result)
			},
			runSchema: <S extends Schema.Top>(schema: S, command: string, args: readonly string[]) => {
				recorder.push({ command, args: [...args] })
				return Effect.try({
					try: () => JSON.parse(response) as unknown,
					catch: (cause) => cause,
				}).pipe(Effect.flatMap((value) => Schema.decodeUnknownEffect(schema)(value))) as Effect.Effect<S["Type"], never, S["DecodingServices"]>
			},
		}),
	)

const baseIssueResponse = JSON.stringify({
	id: 9001,
	user: { login: "kit" },
	body: "Updated body",
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-02T00:00:00Z",
	html_url: "https://github.com/owner/repo/issues/1#issuecomment-9001",
	url: "https://api.github.com/repos/owner/repo/issues/comments/9001",
})

const baseReviewResponse = JSON.stringify({
	id: 7777,
	node_id: "PRRC_abc",
	user: { login: "kit" },
	body: "Updated review body",
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-02T00:00:00Z",
	path: "src/foo.ts",
	line: 42,
	original_line: 42,
	side: "RIGHT",
	in_reply_to_id: null,
	html_url: "https://github.com/owner/repo/pull/1#discussion_r7777",
	url: "https://api.github.com/repos/owner/repo/pulls/comments/7777",
})

const runWith = <A>(effect: Effect.Effect<A, unknown, GitHubService>, layer: Layer.Layer<GitHubService>) =>
	Effect.runPromise(effect.pipe(Effect.provide(layer)) as Effect.Effect<A>)

const operationCall = (recorder: readonly RecordedCall[]) => {
	expect(recorder.filter((call) => call.args[0] === "api" && call.args[1] === "user")).toHaveLength(1)
	const call = recorder.find((call) => !(call.args[0] === "api" && call.args[1] === "user"))
	if (!call) throw new Error("Expected a GitHub operation after authentication")
	return call
}

const repositoryPullRequestListResponse = JSON.stringify({
	data: {
		repository: {
			pullRequests: {
				nodes: [
					{
						number: 42,
						title: "Keep startup queries cheap",
						isDraft: false,
						reviewDecision: null,
						autoMergeRequest: null,
						state: "OPEN",
						merged: false,
						createdAt: "2026-01-01T00:00:00Z",
						updatedAt: "2026-01-01T00:00:00Z",
						closedAt: null,
						url: "https://github.com/owner/repo/pull/42",
						author: { login: "kit" },
						headRefOid: "abc123",
						headRefName: "cheap-list-query",
						baseRefName: "main",
						repository: { nameWithOwner: "owner/repo", defaultBranchRef: { name: "main" } },
					},
				],
				pageInfo: { hasNextPage: false, endCursor: null },
			},
		},
	},
})

describe("GitHubService list queries", () => {
	test("shares concurrent authenticated-user lookups", async () => {
		const recorder: RecordedCall[] = []
		const layer = GitHubService.layerNoDeps.pipe(Layer.provide(fakeCommandRunner(JSON.stringify({ login: "kit" }), recorder)))
		const users = await runWith(
			GitHubService.use((github) => Effect.all([github.getAuthenticatedUser(), github.getAuthenticatedUser(), github.getAuthenticatedUser()], { concurrency: "unbounded" })),
			layer,
		)

		expect(users).toEqual(["kit", "kit", "kit"])
		expect(recorder.filter((call) => call.args[0] === "api" && call.args[1] === "user")).toHaveLength(1)
	})

	test("repository PR list query omits expensive status checks", async () => {
		const recorder: RecordedCall[] = []
		const layer = GitHubService.layerNoDeps.pipe(Layer.provide(fakeCommandRunner(repositoryPullRequestListResponse, recorder)))
		const page = await runWith(
			GitHubService.use((github) => github.listPullRequestPage({ kind: "pullRequest", mode: "all", repository: "owner/repo", cursor: null, pageSize: 1 })),
			layer,
		)

		expect(page.items).toHaveLength(1)
		expect(page.items[0]!.checkStatus).toBe("none")
		const call = operationCall(recorder)
		const queryArg = call.args.find((arg) => arg.startsWith("query=")) ?? ""
		expect(queryArg).not.toContain("statusCheckRollup")
		expect(queryArg).not.toContain("contexts(first: 100)")
		expect(call.args).toContain("first=1")
	})

	test("classifies GitHub rate limit errors", () => {
		expect(classifyGitHubRateLimit("graphql_rate_limit: API rate limit already exceeded")).toBe("graphql")
		expect(classifyGitHubRateLimit("You have exceeded a secondary rate limit")).toBe("secondary")
		expect(isGitHubRateLimitError({ detail: "API rate limit already exceeded for user ID 1." })).toBe(true)
		expect(isGitHubRateLimitError({ detail: "Repository not found" })).toBe(false)
	})

	test("loads large repository label sets for the label picker", async () => {
		const recorder: RecordedCall[] = []
		const layer = GitHubService.layerNoDeps.pipe(Layer.provide(fakeCommandRunner("[]", recorder)))
		await runWith(
			GitHubService.use((github) => github.listRepoLabels("owner/repo")),
			layer,
		)

		expect(operationCall(recorder).args).toContain("1000")
	})
})

describe("GitHubService comment edit/delete", () => {
	test("editPullRequestIssueComment PATCHes the issue comments endpoint", async () => {
		const recorder: RecordedCall[] = []
		const layer = GitHubService.layerNoDeps.pipe(Layer.provide(fakeCommandRunner(baseIssueResponse, recorder)))
		const updated = await runWith(
			GitHubService.use((github) => github.editPullRequestIssueComment("owner/repo", "9001", "Updated body")),
			layer,
		)

		expect(updated._tag).toBe("comment")
		expect(updated.body).toBe("Updated body")
		expect(updated.id).toBe("9001")
		const call = operationCall(recorder)
		expect(call.command).toBe("gh")
		expect(call.args).toEqual(["api", "--method", "PATCH", "repos/owner/repo/issues/comments/9001", "-f", "body=Updated body"])
	})

	test("editReviewComment PATCHes the pulls comments endpoint", async () => {
		const recorder: RecordedCall[] = []
		const layer = GitHubService.layerNoDeps.pipe(Layer.provide(fakeCommandRunner(baseReviewResponse, recorder)))
		const updated = await runWith(
			GitHubService.use((github) => github.editReviewComment("owner/repo", "7777", "Updated review body")),
			layer,
		)

		expect(updated._tag).toBe("review-comment")
		expect(updated.body).toBe("Updated review body")
		expect(operationCall(recorder).args).toEqual(["api", "--method", "PATCH", "repos/owner/repo/pulls/comments/7777", "-f", "body=Updated review body"])
	})

	test("deletePullRequestIssueComment DELETEs the issue comments endpoint", async () => {
		const recorder: RecordedCall[] = []
		const layer = GitHubService.layerNoDeps.pipe(Layer.provide(fakeCommandRunner("", recorder)))
		await runWith(
			GitHubService.use((github) => github.deletePullRequestIssueComment("owner/repo", "9001")),
			layer,
		)

		expect(operationCall(recorder).args).toEqual(["api", "--method", "DELETE", "repos/owner/repo/issues/comments/9001"])
	})

	test("deleteReviewComment DELETEs the pulls comments endpoint", async () => {
		const recorder: RecordedCall[] = []
		const layer = GitHubService.layerNoDeps.pipe(Layer.provide(fakeCommandRunner("", recorder)))
		await runWith(
			GitHubService.use((github) => github.deleteReviewComment("owner/repo", "7777")),
			layer,
		)

		expect(operationCall(recorder).args).toEqual(["api", "--method", "DELETE", "repos/owner/repo/pulls/comments/7777"])
	})
})
