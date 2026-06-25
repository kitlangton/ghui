import { describe, expect, test } from "bun:test"
import type { PullRequestItem } from "../src/domain.ts"
import { freshPullRequestLoad, mergeCachedDetails, mergePullRequestDetail } from "../src/pullRequestCache.ts"

const pullRequest = (overrides: Partial<PullRequestItem> = {}): PullRequestItem => ({
	repository: "owner/repo",
	author: "author",
	headRefOid: "abc123",
	headRefName: "feature/checks",
	baseRefName: "main",
	defaultBranchName: "main",
	number: 1,
	title: "Update checks",
	body: "",
	labels: [],
	additions: 0,
	deletions: 0,
	changedFiles: 0,
	state: "open",
	reviewStatus: "none",
	checkStatus: "none",
	checkSummary: null,
	checks: [],
	autoMergeEnabled: false,
	detailLoaded: false,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	updatedAt: new Date("2026-01-01T00:00:00Z"),
	closedAt: null,
	url: "https://github.com/owner/repo/pull/1",
	...overrides,
})

describe("mergeCachedDetails", () => {
	test("hydrates detail fields without replacing authoritative summary metadata", () => {
		const summary = pullRequest({ title: "Current title", updatedAt: new Date("2026-01-01T00:00:00Z"), reviewStatus: "approved" })
		const detail = pullRequest({
			title: "Fallback detail title",
			body: "Hydrated body",
			updatedAt: new Date("2026-06-01T00:00:00Z"),
			reviewStatus: "none",
			additions: 12,
			detailLoaded: true,
		})

		const merged = mergePullRequestDetail(summary, detail)

		expect(merged.title).toBe("Current title")
		expect(merged.updatedAt).toEqual(new Date("2026-01-01T00:00:00Z"))
		expect(merged.reviewStatus).toBe("approved")
		expect(merged.body).toBe("Hydrated body")
		expect(merged.additions).toBe(12)
		expect(merged.detailLoaded).toBe(true)
	})

	test("preserves cached checks because the summary fragment never carries a real rollup", () => {
		// The list query omits `statusCheckRollup` for cost; a fresh "summary" PR
		// always lands with checkStatus = "none". Merging the cached detail's
		// checks back in is what keeps the row's ✓/✗ icon stable across refreshes.
		const cached = pullRequest({
			body: "cached body",
			additions: 10,
			deletions: 2,
			changedFiles: 3,
			checkStatus: "pending",
			checkSummary: "checks 8/9",
			checks: [{ name: "ci", status: "in_progress", conclusion: null }],
			detailLoaded: true,
		})
		const fresh = pullRequest({
			title: "Updated title",
			checkStatus: "none",
			checkSummary: null,
			checks: [],
			detailLoaded: false,
		})

		const [merged] = mergeCachedDetails([fresh], [cached])

		expect(merged).toMatchObject({
			title: "Updated title",
			body: "cached body",
			additions: 10,
			deletions: 2,
			changedFiles: 3,
			checkStatus: "pending",
			checkSummary: "checks 8/9",
			checks: [{ name: "ci", status: "in_progress", conclusion: null }],
			detailLoaded: true,
		})
	})

	test("preserves cached checks across many refreshes (regression: vanishing check icons)", () => {
		const cached = pullRequest({
			checkStatus: "passing",
			checkSummary: "9/9",
			checks: [{ name: "ci", status: "completed", conclusion: "success" }],
			detailLoaded: true,
		})
		const fresh = pullRequest({ checkStatus: "none", checkSummary: null, checks: [], detailLoaded: false })
		const [first] = mergeCachedDetails([fresh], [cached])
		const [second] = mergeCachedDetails([fresh], [first!])
		const [third] = mergeCachedDetails([fresh], [second!])
		expect(third).toMatchObject({ checkStatus: "passing", checkSummary: "9/9", detailLoaded: true })
	})

	test("does not preserve cached details after the pull request head changes", () => {
		const cached = pullRequest({
			headRefOid: "old-sha",
			body: "cached body",
			detailLoaded: true,
		})
		const fresh = pullRequest({
			headRefOid: "new-sha",
			body: "",
			detailLoaded: false,
		})

		const [merged] = mergeCachedDetails([fresh], [cached])

		expect(merged).toMatchObject({
			headRefOid: "new-sha",
			body: "",
			detailLoaded: false,
		})
	})
})

describe("freshPullRequestLoad", () => {
	test("accepts an authoritative empty refresh over cached rows", () => {
		const view = { _tag: "Repository", repository: "owner/repo" } as const
		const previous = { view, data: [pullRequest()], fetchedAt: new Date(), endCursor: "cursor", hasNextPage: false }
		const next = freshPullRequestLoad(view, { items: [], endCursor: null, hasNextPage: false }, previous, 500)

		expect(next.data).toEqual([])
	})
})
