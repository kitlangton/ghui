import { describe, expect, test } from "bun:test"
import type { PullRequestComment, PullRequestItem } from "../src/domain.ts"
import { bodyPreview, getDetailHeaderHeight, getDetailJunctionRows, getScrollableDetailBodyHeight, truncateConversationPath } from "../src/ui/DetailsPane.tsx"

const pullRequest = (body: string): PullRequestItem => ({
	repository: "owner/repo",
	author: "kitlangton",
	headRefOid: "abc123",
	headRefName: "feat/details",
	number: 1,
	title: "Title",
	body,
	labels: [],
	additions: 1,
	deletions: 1,
	changedFiles: 1,
	state: "open",
	reviewStatus: "none",
	checkStatus: "none",
	checkSummary: null,
	checks: [],
	autoMergeEnabled: false,
	detailLoaded: true,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	closedAt: null,
	url: "https://github.com/owner/repo/pull/1",
})

describe("truncateConversationPath", () => {
	test("preserves package and repository segments plus the filename", () => {
		expect(truncateConversationPath("packages/opencode/src/project/bootstrap-service.ts", 45)).toBe("packages/opencode/…/bootstrap-service.ts")
	})

	test("keeps useful trailing directories when they fit", () => {
		expect(truncateConversationPath("packages/opencode/src/project/bootstrap-service.ts", 48)).toBe("packages/opencode/…/project/bootstrap-service.ts")
	})

	test("keeps narrow paths inside the target width", () => {
		const truncated = truncateConversationPath("very-long-top-level-directory/src/file.ts", 12)
		expect(truncated).toHaveLength(12)
		expect(truncated).toBe("…src/file.ts")
	})
})

describe("bodyPreview markdown tables", () => {
	const lineText = (line: ReturnType<typeof bodyPreview>[number]) => line.segments.map((segment) => segment.text).join("")

	test("renders pipe tables without raw markdown separator rows", () => {
		const rows = bodyPreview("| Consumer | Sketch accommodation |\n|---|---|\n| `Session.Service.get` | **typed errors** |", 80, 10)
		const text = rows.map(lineText)

		expect(text[0]).toContain("Consumer")
		expect(text[0]).toContain("Sketch accommodation")
		expect(text[1]).toContain("─┼─")
		expect(text).not.toContain("|---|---|")
		expect(text.join("\n")).toContain("Session.Service.get")
		expect(text.join("\n")).not.toContain("`Session.Service.get`")
		expect(text.join("\n")).not.toContain("**typed errors**")
	})

	test("only parses tables with a separator row", () => {
		const rows = bodyPreview("A | B\nnot a table", 40, 10)
		expect(rows.map(lineText)).toEqual(["A | B", "not a table"])
	})
})

const comments: readonly PullRequestComment[] = [
	{
		_tag: "comment",
		id: "comment-1",
		author: "kitlangton",
		body: "hello",
		createdAt: new Date("2026-01-01T01:00:00Z"),
		url: null,
	},
]

describe("detail pane junction rows", () => {
	test("emits a header-level comments summary divider when comments are ready", () => {
		const pr = pullRequest("Line A\nLine B\nLine C")
		const headerDividerRow = 3
		const commentsSummaryDivider = 5

		expect(getDetailJunctionRows({ pullRequest: pr, paneWidth: 60, comments, commentsStatus: "ready" })).toEqual([headerDividerRow, commentsSummaryDivider])
	})

	test("does not reserve comments space while loading or empty", () => {
		const pr = pullRequest("Line A\nLine B")
		const baseJunctionRows = getDetailJunctionRows({ pullRequest: pr, paneWidth: 60 })
		const baseBodyHeight = getScrollableDetailBodyHeight(pr, 58)

		expect(getDetailJunctionRows({ pullRequest: pr, paneWidth: 60, comments: [], commentsStatus: "loading" })).toEqual(baseJunctionRows)
		expect(getDetailJunctionRows({ pullRequest: pr, paneWidth: 60, comments: [], commentsStatus: "ready" })).toEqual(baseJunctionRows)
		expect(getScrollableDetailBodyHeight(pr, 58)).toBe(baseBodyHeight)
	})

	test("comment summaries add header height without growing body height", () => {
		const pr = pullRequest("Line A\nLine B")
		const baseHeaderHeight = getDetailHeaderHeight(pr, 60, true)
		const baseBodyHeight = getScrollableDetailBodyHeight(pr, 58)

		expect(getDetailHeaderHeight(pr, 60, true, comments, "ready")).toBe(baseHeaderHeight + 2)
		expect(getScrollableDetailBodyHeight(pr, 58)).toBe(baseBodyHeight)
	})
})
