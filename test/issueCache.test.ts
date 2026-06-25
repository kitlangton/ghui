import { describe, expect, test } from "bun:test"
import type { IssueItem } from "../src/domain.ts"
import { freshIssueLoad, nextIssueLoadAfterPage } from "../src/issueCache.ts"

const issue = (number: number): IssueItem => ({
	repository: "owner/repo",
	number,
	state: "open",
	title: `Issue ${number}`,
	body: "",
	author: "author",
	labels: [],
	commentCount: 0,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	updatedAt: new Date("2026-01-01T00:00:00Z"),
	url: `https://github.com/owner/repo/issues/${number}`,
})

describe("freshIssueLoad", () => {
	test("represents an authoritative empty refresh", () => {
		const view = { _tag: "Repository", repository: "owner/repo" } as const
		const next = freshIssueLoad(view, { items: [], endCursor: null, hasNextPage: false }, 100)

		expect(next.data).toEqual([])
	})

	test("keeps pagination alive across a duplicate-only page when the cursor advances", () => {
		const view = { _tag: "Repository", repository: "owner/repo" } as const
		const current = freshIssueLoad(view, { items: [issue(1)], endCursor: "first", hasNextPage: true }, 100)
		const next = nextIssueLoadAfterPage(current, { items: [issue(1)], endCursor: "second", hasNextPage: true }, 100)

		expect(next.data.map((item) => item.number)).toEqual([1])
		expect(next.hasNextPage).toBe(true)
	})

	test("stops first-page pagination at the configured Item limit", () => {
		const view = { _tag: "Repository", repository: "owner/repo" } as const
		const next = freshIssueLoad(view, { items: [issue(1), issue(2)], endCursor: "next", hasNextPage: true }, 2)

		expect(next.hasNextPage).toBe(false)
	})
})
