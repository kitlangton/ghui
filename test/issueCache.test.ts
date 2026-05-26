import { describe, expect, test } from "bun:test"
import { freshIssueLoad } from "../src/issueCache.ts"

describe("freshIssueLoad", () => {
	test("represents an authoritative empty refresh", () => {
		const view = { _tag: "Repository", repository: "owner/repo" } as const
		const next = freshIssueLoad(view, { items: [], endCursor: null, hasNextPage: false })

		expect(next.data).toEqual([])
	})
})
