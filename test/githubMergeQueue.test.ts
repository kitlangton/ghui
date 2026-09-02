import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { pullRequestMergeMethods } from "../src/domain.ts"
import { GitHubService } from "../src/services/GitHubService.ts"
import { mergeQueueCommandLayer } from "./fixtures/mergeQueue.ts"
import { runIsolatedProbe } from "./isolatedProbe.ts"

describe("GitHubService merge queue", () => {
	for (const queueEnabled of [false, true]) {
		for (const kind of ["now", "auto", "admin"] as const) {
			for (const method of pullRequestMergeMethods) {
				test(`${queueEnabled ? "queue" : "ordinary"} ${kind} ${method} uses safe merge flags`, async () => {
					const calls: string[][] = []
					const layer = GitHubService.layerNoDeps.pipe(Layer.provide(mergeQueueCommandLayer({ queueEnabled }, calls)))
					await Effect.runPromise(
						GitHubService.use((github) =>
							Effect.gen(function* () {
								const info = yield* github.getPullRequestMergeInfo("example/queue-demo", 42)
								yield* github.mergePullRequest(info.repository, info.number, { kind, method, mergeQueueEnabled: info.mergeQueueEnabled })
								expect(info.mergeQueueEnabled).toBe(queueEnabled)
							}),
						).pipe(Effect.provide(layer)),
					)
					const mergeCall = calls.find((call) => call[1] === "pr" && call[2] === "merge")
					expect(mergeCall).toEqual([
						"gh",
						"pr",
						"merge",
						"42",
						"--repo",
						"example/queue-demo",
						`--${method}`,
						...(kind === "now" ? [] : [`--${kind}`]),
						...(queueEnabled ? [] : ["--delete-branch"]),
					])
					expect(calls.find((call) => call[1] === "api" && call[2] === "graphql")?.find((arg) => arg.startsWith("query="))).toContain("mergeQueue { id }")
				})
			}
		}
	}

	test("disabling auto-merge is unchanged", async () => {
		const calls: string[][] = []
		await Effect.runPromise(
			GitHubService.use((github) => github.mergePullRequest("example/queue-demo", 42, { kind: "disable-auto" })).pipe(
				Effect.provide(GitHubService.layerNoDeps.pipe(Layer.provide(mergeQueueCommandLayer({ queueEnabled: true }, calls)))),
			),
		)
		expect(calls.filter((call) => call[1] === "pr")).toEqual([["gh", "pr", "merge", "42", "--repo", "example/queue-demo", "--disable-auto"]])
	})
})

describe("production merge flow", () => {
	for (const directConfirm of [false, true]) {
		for (const isDraft of [false, true]) {
			test(`failed queue lookup blocks ${directConfirm ? "direct confirmation" : "Enter"} for ${isDraft ? "draft" : "ready"} PRs`, async () => {
				const stdout = await runIsolatedProbe(`
					import { probeMergeFlow } from "./test/mergeQueueFlowProbe.tsx"
					console.log(JSON.stringify(await probeMergeFlow(${JSON.stringify({ queueEnabled: true, kind: "auto", lookupFailure: true, directConfirm, isDraft })})))
				`)
				const result = JSON.parse(stdout)
				expect(result.error).toBe("Fixture queue lookup denied")
				expect(result.loading).toBe(false)
				expect(result.errorFrame).toContain(result.error)
				expect(result.errorFrame).not.toContain("Enable auto-merge")
				expect(result.confirmationCalls).toEqual([])
				expect(result.pendingConfirm).toBeNull()
				expect(result.availableActionCount).toBe(0)
				if (!directConfirm) expect(result.dispatch).toBe("disabled")
				expect(result.state).toBe("open")
				expect(result.reviewStatus).toBe(isDraft ? "draft" : "approved")
				expect(result.autoMergeEnabled).toBe(false)
			})
		}
	}

	for (const queueEnabled of [false, true]) {
		for (const kind of ["now", "auto", "admin"] as const) {
			test(`${queueEnabled ? "queue" : "ordinary"} ${kind} keeps truthful pending and successful state`, async () => {
				const stdout = await runIsolatedProbe(`
					import { probeMergeFlow } from "./test/mergeQueueFlowProbe.tsx"
					console.log(JSON.stringify(await probeMergeFlow(${JSON.stringify({ queueEnabled, kind })})))
				`)
				const result = JSON.parse(stdout)
				const queueRequest = queueEnabled && kind !== "admin"
				expect(result.pendingState).toBe(queueRequest || kind === "auto" ? "open" : "merged")
				expect(result.finalState).toBe(result.pendingState)
				expect(result.autoMergeEnabled).toBe(!queueEnabled && kind === "auto")
				expect(result.completed).toEqual(queueRequest || kind === "auto" ? [] : ["merged"])
				expect(result.refreshes).toEqual(queueRequest ? ["Requested merge queue for #42"] : kind === "auto" ? [] : [`${kind === "admin" ? "Admin merged" : "Merged"} #42`])
				expect(result.notices).toEqual(!queueEnabled && kind === "auto" ? ["Enabled auto-merge #42"] : [])
				expect(result.restored).toBe(0)
				if (queueRequest) expect(result.modalFrame).toContain("Add to merge queue")
				if (kind === "admin") expect(result.modalFrame).toContain("(admin)")
				if (queueEnabled && kind === "admin") expect(result.modalFrame).toContain("Bypass the merge queue")
			})
		}
	}

	test("queue failure leaves the PR open and reports the error", async () => {
		const stdout = await runIsolatedProbe(`
			import { probeMergeFlow } from "./test/mergeQueueFlowProbe.tsx"
			console.log(JSON.stringify(await probeMergeFlow({ queueEnabled: true, kind: "now", fail: true })))
		`)
		const result = JSON.parse(stdout)
		expect(result.pendingState).toBe("open")
		expect(result.finalState).toBe("open")
		expect(result.completed).toEqual([])
		expect(result.refreshes).toEqual([])
		expect(result.notices).toEqual(["Fixture merge rejected"])
		expect(result.restored).toBe(0)
	})

	test("ordinary merge failure still rolls back optimistic completion", async () => {
		const stdout = await runIsolatedProbe(`
			import { probeMergeFlow } from "./test/mergeQueueFlowProbe.tsx"
			console.log(JSON.stringify(await probeMergeFlow({ queueEnabled: false, kind: "now", fail: true })))
		`)
		const result = JSON.parse(stdout)
		expect(result.pendingState).toBe("merged")
		expect(result.finalState).toBe("open")
		expect(result.restored).toBe(1)
		expect(result.notices).toEqual(["Fixture merge rejected"])
	})

	test("draft queue action still confirms twice and marks ready before requesting the queue", async () => {
		const stdout = await runIsolatedProbe(`
			import { probeMergeFlow } from "./test/mergeQueueFlowProbe.tsx"
			console.log(JSON.stringify(await probeMergeFlow({ queueEnabled: true, kind: "now", isDraft: true })))
		`)
		const result = JSON.parse(stdout)
		expect(result.firstConfirmMutations).toEqual([])
		expect(result.mutations.map((call: string[]) => call[2])).toEqual(["ready", "merge"])
		expect(result.completed).toEqual([])
		expect(result.refreshes).toEqual(["Requested merge queue for #42"])
		expect(result.finalState).toBe("open")
		expect(result.finalReviewStatus).toBe("none")
	})

	test("draft queue failure after marking ready refreshes rather than restoring draft state", async () => {
		const stdout = await runIsolatedProbe(`
			import { probeMergeFlow } from "./test/mergeQueueFlowProbe.tsx"
			console.log(JSON.stringify(await probeMergeFlow({ queueEnabled: true, kind: "now", isDraft: true, fail: true })))
		`)
		const result = JSON.parse(stdout)
		expect(result.finalState).toBe("open")
		expect(result.finalReviewStatus).toBe("none")
		expect(result.restored).toBe(0)
		expect(result.refreshes).toEqual(["Merge failed for #42"])
		expect(result.notices).toEqual(["Fixture merge rejected"])
	})

	test("pending checks request the queue without claiming auto-merge or completion", async () => {
		const stdout = await runIsolatedProbe(`
			import { probeMergeFlow } from "./test/mergeQueueFlowProbe.tsx"
			console.log(JSON.stringify(await probeMergeFlow({ queueEnabled: true, kind: "auto", pendingChecks: true })))
		`)
		const result = JSON.parse(stdout)
		expect(result.pendingState).toBe("open")
		expect(result.autoMergeEnabled).toBe(false)
		expect(result.completed).toEqual([])
		expect(result.refreshes).toEqual(["Requested merge queue for #42"])
		expect(result.modalFrame).toContain("Enable merge queue when ready")
	})
})
