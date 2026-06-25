import { describe, expect, test } from "bun:test"
import type { PullRequestItem } from "../src/domain.ts"
import { buildPullRequestListRows, pullRequestListRowIndex, pullRequestListVisualLineCount } from "../src/ui/PullRequestList.tsx"

const pullRequest = (overrides: Partial<PullRequestItem> = {}): PullRequestItem => ({
	repository: "owner/repo",
	author: "author",
	headRefOid: "abc123",
	headRefName: "feature/pagination",
	baseRefName: "main",
	defaultBranchName: "main",
	number: 1,
	title: "Update pagination",
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

describe("buildPullRequestListRows", () => {
	test("shows a loaded-count footer when more pull requests are available", () => {
		const rows = buildPullRequestListRows({
			groups: [["owner/repo", [pullRequest()]]],
			status: "ready",
			error: null,
			filterText: "",
			loadedCount: 50,
			hasMore: true,
			isLoadingMore: false,
		})

		expect(rows.at(-1)).toEqual({ _tag: "load-more", text: "↓ Press enter to load more  ·  50 loaded" })
	})

	test("shows an in-progress footer while loading the next page", () => {
		const rows = buildPullRequestListRows({
			groups: [["owner/repo", [pullRequest()]]],
			status: "ready",
			error: null,
			filterText: "",
			loadedCount: 50,
			hasMore: true,
			isLoadingMore: true,
			loadingIndicator: "⠋",
		})

		expect(rows.at(-1)).toEqual({ _tag: "load-more", text: "⠋ Loading more pull requests... (50 loaded)" })
	})

	test("maps pull requests to their first visual line", () => {
		const first = pullRequest({ number: 1, url: "https://github.com/owner/repo/pull/1" })
		const second = pullRequest({ number: 2, url: "https://github.com/owner/repo/pull/2" })
		const rows = buildPullRequestListRows({
			groups: [["owner/repo", [first, second]]],
			status: "ready",
			error: null,
			filterText: "",
			loadedCount: 2,
			hasMore: false,
			isLoadingMore: false,
		})

		expect(pullRequestListRowIndex(rows, first.url)).toBe(2)
		expect(pullRequestListRowIndex(rows, second.url)).toBe(4)
	})

	test("uses one visual line per pull request in authored-only views", () => {
		const first = pullRequest({ number: 1, url: "https://github.com/owner/repo/pull/1" })
		const second = pullRequest({ number: 2, url: "https://github.com/owner/repo/pull/2" })
		const rows = buildPullRequestListRows({
			groups: [["owner/repo", [first, second]]],
			status: "ready",
			error: null,
			filterText: "",
			loadedCount: 2,
			hasMore: false,
			isLoadingMore: false,
			compact: true,
		})

		expect(pullRequestListRowIndex(rows, second.url)).toBe(3)
		expect(pullRequestListVisualLineCount(rows)).toBe(4)
	})
})
