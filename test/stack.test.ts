import { describe, expect, test } from "bun:test"
import type { PullRequestItem } from "../src/domain.js"
import { buildStackForests, flattenStackForest, isStacked, stackParentBranch } from "../src/stack.js"

const pr = (number: number, headRefName: string, baseRefName: string, repository = "acme/app"): PullRequestItem => ({
	repository,
	author: "alice",
	headRefOid: `oid-${number}`,
	headRefName,
	baseRefName,
	number,
	title: `PR ${number}`,
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
	createdAt: new Date(),
	closedAt: null,
	url: `https://github.com/${repository}/pull/${number}`,
})

describe("buildStackForests", () => {
	test("PRs targeting main are roots", () => {
		const forests = buildStackForests([pr(1, "feat-a", "main"), pr(2, "feat-b", "main")])
		expect(forests).toHaveLength(1)
		expect(forests[0]!.repository).toBe("acme/app")
		expect(forests[0]!.roots.map((r) => r.pullRequest.number)).toEqual([1, 2])
		expect(isStacked(forests[0]!)).toBe(false)
	})

	test("child PR whose base matches another PR's head becomes a child", () => {
		const items = [pr(1, "feat-a", "main"), pr(2, "feat-b", "feat-a"), pr(3, "feat-c", "feat-b")]
		const forests = buildStackForests(items)
		const repo = forests[0]!
		expect(repo.roots).toHaveLength(1)
		const root = repo.roots[0]!
		expect(root.pullRequest.number).toBe(1)
		expect(root.children.map((c) => c.pullRequest.number)).toEqual([2])
		expect(root.children[0]!.children.map((c) => c.pullRequest.number)).toEqual([3])
		expect(isStacked(repo)).toBe(true)
	})

	test("depth is assigned correctly", () => {
		const items = [pr(1, "a", "main"), pr(2, "b", "a"), pr(3, "c", "b")]
		const flat = flattenStackForest(buildStackForests(items)[0]!)
		expect(flat.map((n) => [n.pullRequest.number, n.depth])).toEqual([
			[1, 0],
			[2, 1],
			[3, 2],
		])
	})

	test("PRs from different repos do not stack on each other", () => {
		const items = [pr(1, "feat-a", "main", "acme/app"), pr(2, "feat-b", "feat-a", "other/repo")]
		const forests = buildStackForests(items)
		expect(forests.map((f) => f.repository)).toEqual(["acme/app", "other/repo"])
		expect(forests[0]!.roots.map((r) => r.pullRequest.number)).toEqual([1])
		expect(forests[1]!.roots.map((r) => r.pullRequest.number)).toEqual([2])
		expect(forests[1]!.roots[0]!.children).toHaveLength(0)
	})

	test("orphan PR whose base branch is not in the open set is treated as a root", () => {
		const items = [pr(1, "feat-a", "deleted-branch")]
		const forests = buildStackForests(items)
		const repo = forests[0]!
		expect(repo.roots).toHaveLength(1)
		expect(repo.roots[0]!.pullRequest.number).toBe(1)
		expect(repo.roots[0]!.children).toHaveLength(0)
	})

	test("self-referencing PR (head == base) is treated as a root, not its own child", () => {
		const items = [pr(1, "loop", "loop")]
		const forests = buildStackForests(items)
		const repo = forests[0]!
		expect(repo.roots).toHaveLength(1)
		expect(repo.roots[0]!.children).toHaveLength(0)
	})

	test("repos are listed alphabetically", () => {
		const items = [pr(1, "a", "main", "z/z"), pr(2, "b", "main", "a/a")]
		const forests = buildStackForests(items)
		expect(forests.map((f) => f.repository)).toEqual(["a/a", "z/z"])
	})
})

describe("stackParentBranch", () => {
	const items = [pr(1, "feat-a", "main"), pr(2, "feat-b", "feat-a"), pr(3, "feat-c", "main", "other/repo")]

	test("returns parent PR when base matches another PR's head", () => {
		expect(stackParentBranch(items, items[1]!)?.number).toBe(1)
	})

	test("returns null when base is the default branch", () => {
		expect(stackParentBranch(items, items[0]!)).toBeNull()
	})

	test("does not cross repository boundaries", () => {
		const cross = pr(4, "feat-d", "feat-a", "other/repo")
		expect(stackParentBranch([...items, cross], cross)).toBeNull()
	})
})
