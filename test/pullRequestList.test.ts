import { describe, expect, test } from "bun:test"
import type { PullRequestItem } from "../src/domain.ts"
import { buildPullRequestListRows } from "../src/ui/PullRequestList.tsx"

const pullRequest = (overrides: Partial<PullRequestItem> = {}): PullRequestItem => ({
	repository: "owner/repo",
	author: "author",
	headRefOid: "abc123",
	headRefName: "feature/pagination",
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
			showFilterBar: false,
			loadedCount: 50,
			hasMore: true,
			isLoadingMore: false,
		})

		expect(rows.at(-1)).toEqual({ _tag: "load-more", text: "- 50 loaded, more available" })
	})

	test("shows an in-progress footer while loading the next page", () => {
		const rows = buildPullRequestListRows({
			groups: [["owner/repo", [pullRequest()]]],
			status: "ready",
			error: null,
			filterText: "",
			showFilterBar: false,
			loadedCount: 50,
			hasMore: true,
			isLoadingMore: true,
			loadingIndicator: "⠋",
		})

		expect(rows.at(-1)).toEqual({ _tag: "load-more", text: "⠋ Loading more pull requests... (50 loaded)" })
	})
})
