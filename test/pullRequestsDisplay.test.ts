import { describe, expect, test } from "bun:test"
import type { PullRequestItem, ReviewStatus } from "../src/domain.js"
import { colors } from "../src/ui/colors.js"
import { failingCheckNames, pullRequestMetadataText, pullRequestRowDisplay, reviewIcon, reviewLabel } from "../src/ui/pullRequests.js"

const open: PullRequestItem = {
	repository: "owner/repo",
	author: "kit",
	headRefOid: "deadbeef",
	headRefName: "feature/thing",
	number: 42,
	title: "feat: thing",
	body: "",
	labels: [],
	additions: 0,
	deletions: 0,
	changedFiles: 1,
	state: "open",
	reviewStatus: "approved",
	checkStatus: "passing",
	checkSummary: "checks 5/5",
	checks: [],
	autoMergeEnabled: false,
	detailLoaded: true,
	createdAt: new Date("2026-01-01"),
	closedAt: null,
	url: "https://github.com/owner/repo/pull/42",
}

describe("pullRequestRowDisplay", () => {
	test("open + selected uses selectedText/accent", () => {
		const display = pullRequestRowDisplay(open, true)
		expect(display.rowFg).toBe(colors.selectedText)
		expect(display.numberFg).toBe(colors.accent)
		expect(display.checkText).toBe("5/5")
	})

	test("open + unselected uses default text/count", () => {
		const display = pullRequestRowDisplay(open, false)
		expect(display.rowFg).toBe(colors.text)
		expect(display.numberFg).toBe(colors.count)
	})

	test("merged → checkText 'merged' and passing color", () => {
		const display = pullRequestRowDisplay({ ...open, state: "merged" }, false)
		expect(display.checkText).toBe("merged")
		expect(display.checkFg).toBe(colors.status.passing)
		expect(display.indicatorFg).toBe(colors.status.passing)
		expect(display.rowFg).toBe(colors.muted)
	})

	test("closed → checkText 'closed' and muted", () => {
		const display = pullRequestRowDisplay({ ...open, state: "closed" }, false)
		expect(display.checkText).toBe("closed")
		expect(display.checkFg).toBe(colors.muted)
		expect(display.indicatorFg).toBe(colors.muted)
	})

	test("autoMergeEnabled overrides indicator to accent", () => {
		const display = pullRequestRowDisplay({ ...open, autoMergeEnabled: true }, false)
		expect(display.indicatorFg).toBe(colors.accent)
	})

	test("checkSummary 'checks N/M' prefix is stripped", () => {
		const display = pullRequestRowDisplay({ ...open, checkSummary: "checks 7/9" }, false)
		expect(display.checkText).toBe("7/9")
	})
})

describe("reviewIcon", () => {
	test("merged → ✓", () => {
		expect(reviewIcon({ ...open, state: "merged" })).toBe("✓")
	})

	test("closed → ×", () => {
		expect(reviewIcon({ ...open, state: "closed" })).toBe("×")
	})

	test("autoMergeEnabled → ↻", () => {
		expect(reviewIcon({ ...open, autoMergeEnabled: true })).toBe("↻")
	})

	test.each<[ReviewStatus, string]>([
		["draft", "◌"],
		["approved", "✓"],
		["changes", "!"],
		["review", "◐"],
		["none", "·"],
	])("review status %s → %s", (status, icon) => {
		expect(reviewIcon({ ...open, reviewStatus: status })).toBe(icon)
	})
})

describe("reviewLabel", () => {
	test.each<[ReviewStatus, string | null]>([
		["draft", "draft"],
		["approved", "approved"],
		["changes", "changes"],
		["review", "review"],
		["none", null],
	])("review status %s → %s", (status, label) => {
		expect(reviewLabel({ ...open, reviewStatus: status })).toBe(label)
	})
})

describe("pullRequestMetadataText", () => {
	test("includes named failing checks when copying metadata", () => {
		const metadata = pullRequestMetadataText({
			...open,
			checkStatus: "failing",
			checkSummary: "checks 2/4",
			checks: [
				{ name: "lint", status: "completed", conclusion: "success" },
				{ name: "test", status: "completed", conclusion: "failure" },
				{ name: "build", status: "completed", conclusion: "timed_out" },
				{ name: "docs", status: "completed", conclusion: "skipped" },
			],
		})

		expect(metadata).toContain("checks 2/4")
		expect(metadata).toContain("branch: feature/thing")
		expect(metadata).toContain("failing checks: test, build")
	})

	test("omits failing check line when checks are passing", () => {
		expect(pullRequestMetadataText(open)).not.toContain("failing checks:")
	})
})

describe("failingCheckNames", () => {
	test("treats failure, cancelled, and timed out conclusions as failing", () => {
		expect(
			failingCheckNames({
				...open,
				checks: [
					{ name: "fail", status: "completed", conclusion: "failure" },
					{ name: "cancelled", status: "completed", conclusion: "cancelled" },
					{ name: "timeout", status: "completed", conclusion: "timed_out" },
					{ name: "pending", status: "in_progress", conclusion: null },
				],
			}),
		).toEqual(["fail", "cancelled", "timeout"])
	})
})
