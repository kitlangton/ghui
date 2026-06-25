import { describe, expect, test } from "bun:test"
import { runIsolatedProbe } from "./isolatedProbe.ts"

describe("item view atoms", () => {
	test("reactive queue atoms publish each settled mock View under its own cache key", async () => {
		const probe = `
			import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
			import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
			import { activeIssueViewAtom, issuesAtom, issueQueueLoadCacheAtom } from "./src/ui/issues/atoms.ts"
			import { activeViewAtom, pullRequestsAtom, queueLoadCacheAtom } from "./src/ui/pullRequests/atoms.ts"
			import { issueViewCacheKey } from "./src/issueViews.ts"
			import { viewCacheKey } from "./src/pullRequestViews.ts"
			const registry = AtomRegistry.make()
			const waitFor = (atom) => new Promise((resolve, reject) => {
				const settle = (result) => {
					if (result.waiting) return false
					if (AsyncResult.isFailure(result)) reject(result.cause)
					else if (AsyncResult.isSuccess(result)) resolve(result.value)
					else return false
					return true
				}
				if (settle(registry.get(atom))) return
				let unsubscribe = () => {}
				unsubscribe = registry.subscribe(atom, (result) => {
					if (settle(result)) unsubscribe()
				})
			})
			const prViews = [
				{ _tag: "Queue", mode: "authored", repository: null },
				{ _tag: "Repository", repository: "owner/repo" },
				{ _tag: "Queue", mode: "authored", repository: "owner/repo" },
			]
			const issueViews = [
				{ _tag: "Queue", mode: "authored", repository: null },
				{ _tag: "Repository", repository: "owner/repo" },
				{ _tag: "Queue", mode: "authored", repository: "owner/repo" },
			]
			for (const view of prViews) {
				registry.set(activeViewAtom, view)
				await waitFor(pullRequestsAtom)
			}
			for (const view of issueViews) {
				registry.set(activeIssueViewAtom, view)
				await waitFor(issuesAtom)
			}
			const prCache = registry.get(queueLoadCacheAtom)
			const issueCache = registry.get(issueQueueLoadCacheAtom)
			console.log([
				prViews.every((view) => prCache[viewCacheKey(view)]?.view === view),
				issueViews.every((view) => issueCache[issueViewCacheKey(view)]?.view === view),
				issueViews.every((view) => issueCache[issueViewCacheKey(view)]?.data.length <= 2 && !issueCache[issueViewCacheKey(view)]?.hasNextPage),
			].join(","))
		`
		const stdout = await runIsolatedProbe(probe, {
			GHUI_MOCK_PR_COUNT: "20",
			GHUI_MOCK_REPOSITORY: "owner/repo",
			GHUI_MOCK_WORKSPACE_PREFERENCES_PATH: "off",
			GHUI_PR_FETCH_LIMIT: "2",
		})
		expect(stdout).toBe("true,true,true")
	})

	test("keyed detail atoms isolate concurrent pull request requests", async () => {
		const probe = `
			import { Effect } from "effect"
			import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
			import { pullRequestDetailsForRevision, recentlyCompletedPullRequestsAtom } from "./src/ui/pullRequests/atoms.ts"
			const registry = AtomRegistry.make()
			const completedUrl = "https://github.com/owner/repo/pull/1000"
			const first = pullRequestDetailsForRevision("owner/repo\\u00001000\\u0000deadbeef00000000")
			const second = pullRequestDetailsForRevision("owner/repo\\u00001001\\u0000deadbeef00000001")
			const [firstDetail, secondDetail] = await Promise.all([
				Effect.runPromise(AtomRegistry.getResult(registry, first, { suspendOnWaiting: true })),
				Effect.runPromise(AtomRegistry.getResult(registry, second, { suspendOnWaiting: true })),
			])
			registry.set(recentlyCompletedPullRequestsAtom, { [completedUrl]: { ...firstDetail, state: "closed", closedAt: new Date(), detailLoaded: false } })
			registry.refresh(first)
			await Effect.runPromise(AtomRegistry.getResult(registry, first, { suspendOnWaiting: true }))
			const completed = registry.get(recentlyCompletedPullRequestsAtom)[completedUrl]
			console.log([first !== second, firstDetail.number, secondDetail.number, completed.detailLoaded, completed.state].join(","))
		`
		const stdout = await runIsolatedProbe(probe, {
			GHUI_MOCK_PR_COUNT: "2",
			GHUI_MOCK_REPO_COUNT: "1",
			GHUI_MOCK_REPOSITORY: "owner/repo",
			GHUI_MOCK_FIXTURE_PATH: "/tmp/ghui-no-detail-fixture.json",
			GHUI_MOCK_WORKSPACE_PREFERENCES_PATH: "off",
		})
		expect(stdout).toBe("true,1000,1001,true,closed")
	})

	test("HOME exposes one canonical load-more slot and hides it while filtering", async () => {
		const probe = `
			import { Effect } from "effect"
			import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
			import { filterQueryAtom } from "./src/ui/filter/atoms.ts"
			import { activeViewAtom, pullRequestLoadMoreSlotAvailableAtom, pullRequestsAtom } from "./src/ui/pullRequests/atoms.ts"
			const registry = AtomRegistry.make()
			const view = { _tag: "Queue", mode: "authored", repository: null }
			registry.set(activeViewAtom, view)
			await Effect.runPromise(AtomRegistry.getResult(registry, pullRequestsAtom, { suspendOnWaiting: true }))
			const before = registry.get(pullRequestLoadMoreSlotAvailableAtom)
			registry.set(filterQueryAtom, "anything")
			const filtered = registry.get(pullRequestLoadMoreSlotAvailableAtom)
			console.log([before, filtered].join(","))
		`
		const stdout = await runIsolatedProbe(probe, {
			GHUI_MOCK_PR_COUNT: "20",
			GHUI_MOCK_FIXTURE_PATH: "/tmp/ghui-no-pagination-fixture.json",
			GHUI_MOCK_WORKSPACE_PREFERENCES_PATH: "off",
			GHUI_PR_PAGE_SIZE: "2",
			GHUI_PR_FETCH_LIMIT: "20",
		})
		expect(stdout).toBe("true,false")
	})

	test("switching a subscribed repo list to author:@me reads that view's cached rows", async () => {
		// The app runtime layer is selected at module-import time. Exercise the
		// atom graph in a child process so this test cannot change the mock/live
		// layer used by terminal-render tests in the same Bun test run.
		const probe = `
			import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
			import { activeViewAtom, loadedPullRequestCountAtom, queueLoadCacheAtom, visiblePullRequestsAtom } from "./src/ui/pullRequests/atoms.ts"
			import { viewCacheKey } from "./src/pullRequestViews.ts"
			const registry = AtomRegistry.make()
			const repositoryView = { _tag: "Repository", repository: "anomalyco/opencode" }
			const authoredView = { _tag: "Queue", mode: "authored", repository: "anomalyco/opencode" }
			const item = (number, author) => ({ repository: "anomalyco/opencode", author, number, url: String(number), createdAt: new Date(2026, 0, number), updatedAt: new Date(2026, 0, number) })
			const load = (view, data) => ({ view, data, fetchedAt: new Date(), endCursor: null, hasNextPage: false })
			registry.set(queueLoadCacheAtom, {
				[viewCacheKey(repositoryView)]: load(repositoryView, [item(1, "kitlangton"), item(2, "another-author")]),
				[viewCacheKey(authoredView)]: load(authoredView, [item(1, "kitlangton")]),
			})
			registry.set(activeViewAtom, repositoryView)
			const unsubscribe = registry.subscribe(visiblePullRequestsAtom, () => {})
			registry.get(visiblePullRequestsAtom)
			registry.set(activeViewAtom, authoredView)
			const visible = registry.get(visiblePullRequestsAtom)
			console.log(visible.map((pullRequest) => pullRequest.author).join(",") + "|" + registry.get(loadedPullRequestCountAtom))
			unsubscribe()
		`
		const stdout = await runIsolatedProbe(probe)
		expect(stdout).toBe("kitlangton|1")
	})

	test("issue display atoms follow the active cached view after a repo filter switch", async () => {
		const probe = `
			import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
			import { activeIssueViewAtom, issueListAtom, issueQueueLoadCacheAtom, loadedIssueCountAtom } from "./src/ui/issues/atoms.ts"
			import { issueViewCacheKey } from "./src/issueViews.ts"
			const registry = AtomRegistry.make()
			const repositoryView = { _tag: "Repository", repository: "anomalyco/opencode" }
			const authoredView = { _tag: "Queue", mode: "authored", repository: "anomalyco/opencode" }
			const item = (number, author) => ({ repository: "anomalyco/opencode", author, number, state: "open", title: String(number), body: "", labels: [], commentCount: 0, createdAt: new Date(2026, 0, number), updatedAt: new Date(2026, 0, number), url: String(number) })
			const load = (view, data) => ({ view, data, fetchedAt: new Date(), endCursor: null, hasNextPage: false })
			registry.set(issueQueueLoadCacheAtom, {
				[issueViewCacheKey(repositoryView)]: load(repositoryView, [item(1, "kitlangton"), item(2, "another-author")]),
				[issueViewCacheKey(authoredView)]: load(authoredView, [item(1, "kitlangton")]),
			})
			registry.set(activeIssueViewAtom, repositoryView)
			const unsubscribe = registry.subscribe(issueListAtom, () => {})
			registry.get(issueListAtom)
			registry.set(activeIssueViewAtom, authoredView)
			const visible = registry.get(issueListAtom)
			console.log(visible.map((issue) => issue.author).join(",") + "|" + registry.get(loadedIssueCountAtom))
			unsubscribe()
		`
		const stdout = await runIsolatedProbe(probe)
		expect(stdout).toBe("kitlangton|1")
	})

	test("commands and comments target the same filtered issue the surface displays", async () => {
		const probe = `
			import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
			import { activeIssueViewAtom, issueListAtom, issueQueueLoadCacheAtom, selectedIssueAtom } from "./src/ui/issues/atoms.ts"
			import { filterQueryAtom } from "./src/ui/filter/atoms.ts"
			import { selectedIssueIndexAtom } from "./src/ui/listSelection/atoms.ts"
			import { workspaceSurfaceAtom } from "./src/workspace/atoms.ts"
			import { selectedCommentSubjectAtom } from "./src/ui/comments/atoms.ts"
			import { issueViewCacheKey } from "./src/issueViews.ts"
			const registry = AtomRegistry.make()
			const view = { _tag: "Queue", mode: "authored", repository: null }
			const item = (number, title) => ({ repository: "anomalyco/opencode", author: "kitlangton", number, state: "open", title, body: "", labels: [], commentCount: 0, createdAt: new Date(2026, 0, number), updatedAt: new Date(2026, 0, number), url: String(number) })
			registry.set(issueQueueLoadCacheAtom, { [issueViewCacheKey(view)]: { view, data: [item(1, "First"), item(2, "Needle")], fetchedAt: new Date(), endCursor: null, hasNextPage: false } })
			registry.set(activeIssueViewAtom, view)
			registry.set(workspaceSurfaceAtom, "issues")
			registry.set(filterQueryAtom, "needle")
			registry.set(selectedIssueIndexAtom, 0)
			const visible = registry.get(issueListAtom)
			console.log(visible.map((issue) => issue.number).join(",") + "|" + registry.get(selectedIssueAtom)?.number + "|" + registry.get(selectedCommentSubjectAtom)?.number)
		`
		const stdout = await runIsolatedProbe(probe)
		expect(stdout).toBe("2|2|2")
	})
})
