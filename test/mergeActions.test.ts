import { describe, expect, test } from "bun:test"
import type { PullRequestMergeInfo } from "../src/domain.js"
import { availableMergeActions, mergeActions } from "../src/mergeActions.js"

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
}

describe("mergeActions ordering", () => {
	test("source-of-truth order is squash, auto, disable-auto, admin", () => {
		expect(mergeActions.map((action) => action.action)).toEqual(["squash", "auto", "disable-auto", "admin"])
	})
})

describe("availableMergeActions", () => {
	test("returns empty when info is null", () => {
		expect(availableMergeActions(null)).toEqual([])
	})

	test("clean PR offers squash, auto, admin (not disable-auto)", () => {
		expect(availableMergeActions(cleanInfo).map((a) => a.action)).toEqual(["squash", "auto", "admin"])
	})

	test("auto-merge enabled offers squash, disable-auto, admin (not auto)", () => {
		expect(availableMergeActions({ ...cleanInfo, autoMergeEnabled: true }).map((a) => a.action)).toEqual(["squash", "disable-auto", "admin"])
	})

	test("conflicting branch offers nothing", () => {
		expect(availableMergeActions({ ...cleanInfo, mergeable: "conflicting" }).map((a) => a.action)).toEqual([])
	})

	test("draft offers nothing", () => {
		expect(availableMergeActions({ ...cleanInfo, isDraft: true }).map((a) => a.action)).toEqual([])
	})

	test("changes-requested hides squash but admin still works", () => {
		expect(availableMergeActions({ ...cleanInfo, reviewStatus: "changes" }).map((a) => a.action)).toEqual(["auto", "admin"])
	})

	test("pending checks hide squash but admin still works", () => {
		expect(availableMergeActions({ ...cleanInfo, checkStatus: "pending" }).map((a) => a.action)).toEqual(["auto", "admin"])
	})

	test("failing checks hide squash but admin still works", () => {
		expect(availableMergeActions({ ...cleanInfo, checkStatus: "failing" }).map((a) => a.action)).toEqual(["auto", "admin"])
	})

	test("closed PR offers nothing", () => {
		expect(availableMergeActions({ ...cleanInfo, state: "closed" }).map((a) => a.action)).toEqual([])
	})
})
