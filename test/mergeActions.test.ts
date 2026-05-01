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
	viewerCanMergeAsAdmin: false,
	allowedMethods: ["merge", "squash", "rebase"],
}

describe("mergeActions ordering", () => {
	test("source-of-truth order reflects all method-specific actions", () => {
		expect(mergeActions.map((action) => action.action)).toEqual([
			"merge",
			"squash",
			"rebase",
			"auto-merge",
			"auto-squash",
			"auto-rebase",
			"disable-auto",
			"admin-merge",
			"admin-squash",
			"admin-rebase",
		])
	})

	test("source-of-truth optimistic UI effects match action behavior", () => {
		expect(Object.fromEntries(mergeActions.map((action) => [action.action, action.optimisticState ?? action.optimisticAutoMergeEnabled ?? null]))).toEqual({
			merge: null,
			squash: "merged",
			rebase: null,
			"auto-merge": true,
			"auto-squash": true,
			"auto-rebase": true,
			"disable-auto": false,
			"admin-merge": null,
			"admin-squash": "merged",
			"admin-rebase": null,
		})
	})
})

describe("availableMergeActions", () => {
	test("returns empty when info is null", () => {
		expect(availableMergeActions(null)).toEqual([])
	})

	test("clean PR offers all allowed manual and auto methods", () => {
		expect(availableMergeActions(cleanInfo).map((a) => a.action)).toEqual([
			"merge",
			"squash",
			"rebase",
			"auto-merge",
			"auto-squash",
			"auto-rebase",
		])
	})

	test("clean PR includes admin actions only when viewer can merge as admin", () => {
		expect(availableMergeActions({ ...cleanInfo, viewerCanMergeAsAdmin: true }).map((a) => a.action)).toEqual([
			"merge",
			"squash",
			"rebase",
			"auto-merge",
			"auto-squash",
			"auto-rebase",
			"admin-merge",
			"admin-squash",
			"admin-rebase",
		])
	})

	test("allowedMethods filters manual, auto, and admin actions", () => {
		expect(availableMergeActions({
			...cleanInfo,
			viewerCanMergeAsAdmin: true,
			allowedMethods: ["merge", "rebase"],
		}).map((a) => a.action)).toEqual([
			"merge",
			"rebase",
			"auto-merge",
			"auto-rebase",
			"admin-merge",
			"admin-rebase",
		])
	})

	test("auto-merge enabled swaps auto actions for disable-auto", () => {
		expect(availableMergeActions({ ...cleanInfo, autoMergeEnabled: true }).map((a) => a.action)).toEqual([
			"merge",
			"squash",
			"rebase",
			"disable-auto",
		])
	})

	test("conflicting branch offers nothing", () => {
		expect(availableMergeActions({ ...cleanInfo, mergeable: "conflicting" }).map((a) => a.action)).toEqual([])
	})

	test("draft offers nothing", () => {
		expect(availableMergeActions({ ...cleanInfo, isDraft: true }).map((a) => a.action)).toEqual([])
	})

	test("changes-requested hides clean merges but still allows auto and admin when eligible", () => {
		expect(availableMergeActions({ ...cleanInfo, reviewStatus: "changes", viewerCanMergeAsAdmin: true }).map((a) => a.action)).toEqual([
			"auto-merge",
			"auto-squash",
			"auto-rebase",
			"admin-merge",
			"admin-squash",
			"admin-rebase",
		])
	})

	test("pending checks hides clean merges but still allows auto and admin when eligible", () => {
		expect(availableMergeActions({ ...cleanInfo, checkStatus: "pending", viewerCanMergeAsAdmin: true }).map((a) => a.action)).toEqual([
			"auto-merge",
			"auto-squash",
			"auto-rebase",
			"admin-merge",
			"admin-squash",
			"admin-rebase",
		])
	})

	test("failing checks hides clean merges but still allows auto and admin when eligible", () => {
		expect(availableMergeActions({ ...cleanInfo, checkStatus: "failing", viewerCanMergeAsAdmin: true }).map((a) => a.action)).toEqual([
			"auto-merge",
			"auto-squash",
			"auto-rebase",
			"admin-merge",
			"admin-squash",
			"admin-rebase",
		])
	})

	test("closed PR offers nothing", () => {
		expect(availableMergeActions({ ...cleanInfo, state: "closed" }).map((a) => a.action)).toEqual([])
	})
})
