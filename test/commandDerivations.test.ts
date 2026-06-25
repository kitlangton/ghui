import { describe, expect, test } from "bun:test"
import { runIsolatedProbe } from "./isolatedProbe.ts"

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
		const stdout = await runIsolatedProbe(probe)
		expect(stdout).toBe("Pull request surface is not active.")
	})
})

describe("Issue command derivations", () => {
	test("disables closing an already closed issue", async () => {
		const probe = `
			import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
			import { noOpenIssueReasonAtom } from "./src/commands/derivations.ts"
			import { activeIssueViewAtom, issueQueueLoadCacheAtom } from "./src/ui/issues/atoms.ts"
			import { workspaceSurfaceAtom } from "./src/workspace/atoms.ts"
			import { issueViewCacheKey } from "./src/issueViews.ts"
			const registry = AtomRegistry.make()
			const view = { _tag: "Queue", mode: "authored", repository: null }
			const issue = { repository: "owner/repo", author: "kit", number: 1, state: "closed", title: "Closed", body: "", labels: [], commentCount: 0, createdAt: new Date(), updatedAt: new Date(), url: "1" }
			registry.set(activeIssueViewAtom, view)
			registry.set(issueQueueLoadCacheAtom, { [issueViewCacheKey(view)]: { view, data: [issue], fetchedAt: new Date(), endCursor: null, hasNextPage: false } })
			registry.set(workspaceSurfaceAtom, "issues")
			console.log(registry.get(noOpenIssueReasonAtom))
		`
		const stdout = await runIsolatedProbe(probe)
		expect(stdout).toBe("Issue is not open.")
	})
})
