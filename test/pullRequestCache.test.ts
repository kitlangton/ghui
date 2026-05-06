import { describe, expect, test } from "bun:test"
import type { PullRequestItem } from "../src/domain.ts"
import { mergeCachedDetails } from "../src/pullRequestCache.ts"

const pullRequest = (overrides: Partial<PullRequestItem> = {}): PullRequestItem => ({
	repository: "owner/repo",
	author: "author",
	headRefOid: "abc123",
	headRefName: "feature/checks",
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
	closedAt: null,
	url: "https://github.com/owner/repo/pull/1",
	...overrides,
})

describe("mergeCachedDetails", () => {
	test("preserves cached detail fields without overwriting fresh check status", () => {
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
			checkStatus: "passing",
			checkSummary: "checks 9/9",
			checks: [{ name: "ci", status: "completed", conclusion: "success" }],
			detailLoaded: false,
		})

		const [merged] = mergeCachedDetails([fresh], [cached])

		expect(merged).toMatchObject({
			title: "Updated title",
			body: "cached body",
			additions: 10,
			deletions: 2,
			changedFiles: 3,
			checkStatus: "passing",
			checkSummary: "checks 9/9",
			detailLoaded: true,
		})
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
