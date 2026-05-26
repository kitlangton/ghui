import { describe, expect, test } from "bun:test"

describe("PR command derivations", () => {
	test("disables PR mutations when a hidden PR remains selected on Issues", async () => {
		// Application atoms bind their runtime at import time; run this graph in
		// isolation so terminal-render tests can select their mock runtime later.
		const probe = `
			import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
			import { noOpenPullRequestReasonAtom } from "./src/commands/derivations.ts"
			import { activeViewAtom, queueLoadCacheAtom } from "./src/ui/pullRequests/atoms.ts"
			import { workspaceSurfaceAtom } from "./src/workspace/atoms.ts"
			const registry = AtomRegistry.make()
			const view = { _tag: "Repository", repository: "owner/repo" }
			const pr = { repository: "owner/repo", author: "kit", headRefOid: "abc", headRefName: "feature", baseRefName: "main", defaultBranchName: "main", number: 1, title: "Open PR", body: "", labels: [], additions: 0, deletions: 0, changedFiles: 0, state: "open", reviewStatus: "none", checkStatus: "none", checkSummary: null, checks: [], autoMergeEnabled: false, detailLoaded: false, createdAt: new Date(), updatedAt: new Date(), closedAt: null, url: "https://github.com/owner/repo/pull/1" }
			registry.set(activeViewAtom, view)
			registry.set(queueLoadCacheAtom, { "pullRequest:all:owner/repo": { view, data: [pr], fetchedAt: new Date(), endCursor: null, hasNextPage: false } })
			registry.set(workspaceSurfaceAtom, "issues")
			console.log(registry.get(noOpenPullRequestReasonAtom))
		`
		const process = Bun.spawn(["bun", "--eval", probe], { cwd: new URL("..", import.meta.url).pathname, stdout: "pipe", stderr: "pipe" })
		const stdout = await new Response(process.stdout).text()
		const stderr = await new Response(process.stderr).text()

		expect(await process.exited, stderr).toBe(0)
		expect(stdout.trim()).toBe("Pull request surface is not active.")
	})
})
