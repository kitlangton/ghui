import { describe, expect, test } from "bun:test"
import { pullRequestQueueSearchQualifier } from "../src/domain.js"
import { activePullRequestViews, viewCacheKey, viewLabel } from "../src/pullRequestViews.js"

describe("pullRequestQueueSearchQualifier", () => {
	test("repository mode with repository → repo: qualifier", () => {
		expect(pullRequestQueueSearchQualifier("repository", "owner/name")).toBe("repo:owner/name")
	})

	test("repository mode without repository falls back to @me and excludes archived repositories", () => {
		expect(pullRequestQueueSearchQualifier("repository", null)).toBe("author:@me archived:false")
	})

	test("authored mode → author:@me excluding archived repositories", () => {
		expect(pullRequestQueueSearchQualifier("authored", null)).toBe("author:@me archived:false")
	})

	test("review mode → review-requested:@me excluding archived repositories regardless of repository", () => {
		expect(pullRequestQueueSearchQualifier("review", "owner/name")).toBe("review-requested:@me archived:false")
	})

	test("assigned mode → assignee:@me excluding archived repositories", () => {
		expect(pullRequestQueueSearchQualifier("assigned", null)).toBe("assignee:@me archived:false")
	})

	test("mentioned mode → mentions:@me excluding archived repositories", () => {
		expect(pullRequestQueueSearchQualifier("mentioned", null)).toBe("mentions:@me archived:false")
	})
})

describe("viewCacheKey", () => {
	test("repository view key includes repo path", () => {
		expect(viewCacheKey({ _tag: "Repository", repository: "owner/name", stateFilter: "open" })).toBe("repository:owner/name:open")
	})

	test("queue view key is the mode literal", () => {
		expect(viewCacheKey({ _tag: "Queue", mode: "authored", repository: null, stateFilter: "open" })).toBe("authored:open")
		expect(viewCacheKey({ _tag: "Queue", mode: "review", repository: "owner/name", stateFilter: "merged" })).toBe("review:merged")
	})
})

describe("activePullRequestViews", () => {
	test("queue tabs stay unscoped when coming from a repository view", () => {
		const views = activePullRequestViews({ _tag: "Repository", repository: "owner/name", stateFilter: "closed" })

		expect(views[0]).toEqual({ _tag: "Repository", repository: "owner/name", stateFilter: "open" })
		expect(views.slice(1).every((view) => view._tag === "Queue" && view.repository === null && view.stateFilter === "open")).toBe(true)
	})
})

describe("viewLabel", () => {
	test("adds state suffix for non-open filters", () => {
		expect(viewLabel({ _tag: "Queue", mode: "authored", repository: null, stateFilter: "open" })).toBe("authored")
		expect(viewLabel({ _tag: "Queue", mode: "authored", repository: null, stateFilter: "merged" })).toBe("authored (merged)")
	})
})
