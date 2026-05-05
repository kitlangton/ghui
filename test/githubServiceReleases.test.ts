import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { CommandRunner, type CommandResult } from "../src/services/CommandRunner.ts"
import { GitHubService } from "../src/services/GitHubService.ts"

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

const releaseJson = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({
		id: 42,
		tag_name: "v1.2.3",
		target_commitish: "main",
		name: "v1.2.3",
		body: "Release notes",
		draft: false,
		prerelease: false,
		created_at: "2026-01-01T00:00:00Z",
		published_at: "2026-01-02T00:00:00Z",
		html_url: "https://github.com/owner/repo/releases/tag/v1.2.3",
		author: { login: "kit" },
		assets: [],
		...overrides,
	})

const runWith = <A>(effect: Effect.Effect<A, unknown, GitHubService>, layer: Layer.Layer<GitHubService>) =>
	Effect.runPromise(effect.pipe(Effect.provide(layer)) as Effect.Effect<A>)

describe("GitHubService releases", () => {
	test("listReleases hits the paginated releases endpoint", async () => {
		const recorder: RecordedCall[] = []
		const layer = GitHubService.layerNoDeps.pipe(Layer.provide(fakeCommandRunner(`[${releaseJson()}]`, recorder)))
		const page = await runWith(
			GitHubService.use((github) => github.listReleases("owner/repo", 1, 30)),
			layer,
		)

		expect(page.items).toHaveLength(1)
		expect(page.items[0]!.tagName).toBe("v1.2.3")
		expect(page.items[0]!.author?.login).toBe("kit")
		expect(page.hasNextPage).toBe(false)
		expect(recorder[0]!.args).toEqual(["api", "repos/owner/repo/releases?per_page=30&page=1"])
	})

	test("getRelease parses body and assets", async () => {
		const recorder: RecordedCall[] = []
		const json = releaseJson({
			body: "Hello",
			assets: [
				{
					id: 1,
					name: "ghui-darwin-arm64",
					label: null,
					size: 1024,
					download_count: 7,
					content_type: "application/octet-stream",
					browser_download_url: "https://example.com/dl",
					url: "https://example.com/api",
					created_at: "2026-01-01T00:00:00Z",
					updated_at: "2026-01-01T00:00:00Z",
				},
			],
		})
		const layer = GitHubService.layerNoDeps.pipe(Layer.provide(fakeCommandRunner(json, recorder)))
		const release = await runWith(
			GitHubService.use((github) => github.getRelease("owner/repo", 42)),
			layer,
		)
		expect(release.body).toBe("Hello")
		expect(release.assets).toHaveLength(1)
		expect(release.assets[0]!.name).toBe("ghui-darwin-arm64")
		expect(recorder[0]!.args).toEqual(["api", "repos/owner/repo/releases/42"])
	})

	test("createRelease POSTs all provided fields", async () => {
		const recorder: RecordedCall[] = []
		const layer = GitHubService.layerNoDeps.pipe(Layer.provide(fakeCommandRunner(releaseJson(), recorder)))
		await runWith(
			GitHubService.use((github) =>
				github.createRelease("owner/repo", {
					tagName: "v1.2.3",
					targetCommitish: "main",
					name: "v1.2.3",
					body: "notes",
					draft: false,
					prerelease: false,
					makeLatest: "true",
				}),
			),
			layer,
		)
		expect(recorder[0]!.args).toEqual([
			"api",
			"--method",
			"POST",
			"repos/owner/repo/releases",
			"-f",
			"tag_name=v1.2.3",
			"-f",
			"target_commitish=main",
			"-f",
			"name=v1.2.3",
			"-f",
			"body=notes",
			"-F",
			"draft=false",
			"-F",
			"prerelease=false",
			"-f",
			"make_latest=true",
		])
	})

	test("updateRelease PATCHes the release endpoint", async () => {
		const recorder: RecordedCall[] = []
		const layer = GitHubService.layerNoDeps.pipe(Layer.provide(fakeCommandRunner(releaseJson(), recorder)))
		await runWith(
			GitHubService.use((github) => github.updateRelease("owner/repo", 42, { name: "renamed" })),
			layer,
		)
		expect(recorder[0]!.args).toEqual(["api", "--method", "PATCH", "repos/owner/repo/releases/42", "-f", "name=renamed"])
	})

	test("deleteRelease DELETEs the release endpoint", async () => {
		const recorder: RecordedCall[] = []
		const layer = GitHubService.layerNoDeps.pipe(Layer.provide(fakeCommandRunner("", recorder)))
		await runWith(
			GitHubService.use((github) => github.deleteRelease("owner/repo", 42)),
			layer,
		)
		expect(recorder[0]!.args).toEqual(["api", "--method", "DELETE", "repos/owner/repo/releases/42"])
	})

	test("generateReleaseNotes posts to the generate-notes endpoint", async () => {
		const recorder: RecordedCall[] = []
		const layer = GitHubService.layerNoDeps.pipe(Layer.provide(fakeCommandRunner(JSON.stringify({ name: "v1.2.3", body: "notes" }), recorder)))
		const notes = await runWith(
			GitHubService.use((github) => github.generateReleaseNotes("owner/repo", { tagName: "v1.2.3", previousTagName: "v1.2.2" })),
			layer,
		)
		expect(notes.name).toBe("v1.2.3")
		expect(recorder[0]!.args).toEqual(["api", "--method", "POST", "repos/owner/repo/releases/generate-notes", "-f", "tag_name=v1.2.3", "-f", "previous_tag_name=v1.2.2"])
	})

	test("listTags reads the tags endpoint with --paginate --slurp", async () => {
		const recorder: RecordedCall[] = []
		const layer = GitHubService.layerNoDeps.pipe(Layer.provide(fakeCommandRunner(JSON.stringify([[{ name: "v1.0.0", commit: { sha: "abc" } }]]), recorder)))
		const tags = await runWith(
			GitHubService.use((github) => github.listTags("owner/repo")),
			layer,
		)
		expect(tags).toHaveLength(1)
		expect(tags[0]!.name).toBe("v1.0.0")
		expect(recorder[0]!.args).toEqual(["api", "--paginate", "--slurp", "repos/owner/repo/tags?per_page=100"])
	})

	test("getDefaultBranch reads the repo metadata", async () => {
		const recorder: RecordedCall[] = []
		const layer = GitHubService.layerNoDeps.pipe(Layer.provide(fakeCommandRunner(JSON.stringify({ default_branch: "trunk" }), recorder)))
		const branch = await runWith(
			GitHubService.use((github) => github.getDefaultBranch("owner/repo")),
			layer,
		)
		expect(branch).toBe("trunk")
		expect(recorder[0]!.args).toEqual(["api", "repos/owner/repo"])
	})
})
