import { describe, expect, test } from "bun:test"
import type { IssueItem } from "../src/domain.ts"
import { issueActivityAgeText } from "../src/ui/IssueList.tsx"

const issue = (overrides: Partial<IssueItem> = {}): IssueItem => ({
	repository: "anomalyco/opencode",
	author: "author",
	number: 1,
	state: "open",
	title: "Recent activity on an old issue",
	body: "",
	labels: [],
	commentCount: 0,
	createdAt: new Date(Date.now() - 62 * 24 * 60 * 60 * 1000),
	updatedAt: new Date(),
	url: "https://github.com/anomalyco/opencode/issues/1",
	...overrides,
})

describe("issueActivityAgeText", () => {
	test("shows update recency instead of the original issue age", () => {
		expect(issueActivityAgeText(issue())).toBe("0d")
	})
})
