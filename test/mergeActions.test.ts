import { describe, expect, test } from "bun:test"
import type { PullRequestMergeAction, PullRequestMergeInfo } from "../src/domain.js"
import { availableMergeKinds, mergeActionCliArgs, mergeKinds, visibleMergeKinds } from "../src/mergeActions.js"

const cleanInfo: PullRequestMergeInfo = {
	repository: "owner/repo",
	number: 1,
	title: "Test PR",
	state: "open",
	isDraft: false,
	mergeable: "mergeable",
	reviewStatus: "approved",
	checkStatus: "passing",
	checkSummary: "checks 5/5",
	autoMergeEnabled: false,
	viewerCanMergeAsAdmin: false,
	mergeQueueEnabled: false,
}

describe("mergeKinds ordering", () => {
	test("source-of-truth order is now, auto, disable-auto, admin", () => {
		expect(mergeKinds.map((kind) => kind.kind)).toEqual(["now", "auto", "disable-auto", "admin"])
	})

	test("source-of-truth optimistic UI effects match kind behavior", () => {
		expect(Object.fromEntries(mergeKinds.map((kind) => [kind.kind, kind.optimisticState ?? kind.optimisticAutoMergeEnabled ?? null]))).toEqual({
			now: "merged",
			auto: true,
			"disable-auto": false,
			admin: "merged",
		})
	})
})

describe("availableMergeKinds", () => {
	test("returns empty when info is null", () => {
		expect(availableMergeKinds(null)).toEqual([])
	})

	test("clean PR offers now and auto, not admin or disable-auto", () => {
		expect(availableMergeKinds(cleanInfo).map((k) => k.kind)).toEqual(["now", "auto"])
	})

	test("clean PR offers admin only when viewer can merge as admin", () => {
		expect(availableMergeKinds({ ...cleanInfo, viewerCanMergeAsAdmin: true }).map((k) => k.kind)).toEqual(["now", "auto", "admin"])
	})

	test("auto-merge enabled offers now and disable-auto, not auto", () => {
		expect(availableMergeKinds({ ...cleanInfo, autoMergeEnabled: true }).map((k) => k.kind)).toEqual(["now", "disable-auto"])
	})

	test("conflicting branch offers nothing", () => {
		expect(availableMergeKinds({ ...cleanInfo, mergeable: "conflicting" }).map((k) => k.kind)).toEqual([])
	})

	test("draft offers nothing", () => {
		expect(availableMergeKinds({ ...cleanInfo, isDraft: true }).map((k) => k.kind)).toEqual([])
	})

	test("changes-requested hides now but auto still works", () => {
		expect(availableMergeKinds({ ...cleanInfo, reviewStatus: "changes" }).map((k) => k.kind)).toEqual(["auto"])
	})

	test("pending checks hide now but auto still works", () => {
		expect(availableMergeKinds({ ...cleanInfo, checkStatus: "pending" }).map((k) => k.kind)).toEqual(["auto"])
	})

	test("failing checks hide now but auto still works", () => {
		expect(availableMergeKinds({ ...cleanInfo, checkStatus: "failing" }).map((k) => k.kind)).toEqual(["auto"])
	})

	test("admin can bypass changes and checks", () => {
		expect(availableMergeKinds({ ...cleanInfo, viewerCanMergeAsAdmin: true, reviewStatus: "changes" }).map((k) => k.kind)).toEqual(["auto", "admin"])
		expect(availableMergeKinds({ ...cleanInfo, viewerCanMergeAsAdmin: true, checkStatus: "pending" }).map((k) => k.kind)).toEqual(["auto", "admin"])
	})

	test("closed PR offers nothing", () => {
		expect(availableMergeKinds({ ...cleanInfo, state: "closed" }).map((k) => k.kind)).toEqual([])
	})
})

describe("visibleMergeKinds", () => {
	const allMethods = { squash: true, merge: true, rebase: true }

	test("returns no actions until repository merge methods load", () => {
		expect(visibleMergeKinds(cleanInfo, null, "squash")).toEqual([])
	})

	test("returns no actions when info is null", () => {
		expect(visibleMergeKinds(null, allMethods, "squash")).toEqual([])
	})

	test("hides method-specific actions when the selected method is not allowed", () => {
		expect(visibleMergeKinds({ ...cleanInfo, autoMergeEnabled: true }, { squash: false, merge: true, rebase: false }, "squash").map((kind) => kind.kind)).toEqual(["disable-auto"])
	})

	test("draft PR offers the same kinds as a ready PR (mark-ready handled at action time)", () => {
		expect(visibleMergeKinds({ ...cleanInfo, isDraft: true }, allMethods, "squash").map((kind) => kind.kind)).toEqual(["now", "auto"])
	})

	test("draft PR with auto-merge already on still shows disable-auto and now", () => {
		expect(visibleMergeKinds({ ...cleanInfo, isDraft: true, autoMergeEnabled: true }, allMethods, "squash").map((kind) => kind.kind)).toEqual(["now", "disable-auto"])
	})
})

describe("mergeActionCliArgs", () => {
	const action = (a: PullRequestMergeAction) => mergeActionCliArgs(a)

	test("squash + now uses --squash --delete-branch", () => {
		expect(action({ kind: "now", method: "squash", mergeQueueEnabled: false })).toEqual(["--squash", "--delete-branch"])
	})

	test("merge + now uses --merge --delete-branch", () => {
		expect(action({ kind: "now", method: "merge", mergeQueueEnabled: false })).toEqual(["--merge", "--delete-branch"])
	})

	test("rebase + now uses --rebase --delete-branch", () => {
		expect(action({ kind: "now", method: "rebase", mergeQueueEnabled: false })).toEqual(["--rebase", "--delete-branch"])
	})

	test("auto + rebase uses --rebase --auto --delete-branch", () => {
		expect(action({ kind: "auto", method: "rebase", mergeQueueEnabled: false })).toEqual(["--rebase", "--auto", "--delete-branch"])
	})

	test("admin + merge uses --merge --admin --delete-branch", () => {
		expect(action({ kind: "admin", method: "merge", mergeQueueEnabled: false })).toEqual(["--merge", "--admin", "--delete-branch"])
	})

	test("disable-auto ignores method and uses --disable-auto", () => {
		expect(action({ kind: "disable-auto" })).toEqual(["--disable-auto"])
	})
})
