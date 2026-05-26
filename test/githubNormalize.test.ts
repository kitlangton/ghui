import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import {
	fallbackCreatedComment,
	fallbackEditedReviewComment,
	fallbackReplyComment,
	getCheckInfoFromContexts,
	getPullRequestState,
	getReviewStatus,
	itemPage,
	normalizeMergeable,
	parseIssueComment,
	parseIssueComments,
	parseIssueSearchNode,
	parsePullRequest,
	parsePullRequestComment,
	parsePullRequestComments,
	parsePullRequestMergeInfo,
	parsePullRequestSummary,
	parseRepositoryDetails,
	parseRepositoryMergeMethods,
	restCommentId,
	sortComments,
} from "../src/services/githubNormalize.ts"
import {
	type MergeInfoResponseSchema,
	type RawCheckContext,
	RawCheckContextSchema,
	type RawIssueSearchNode,
	type RawPullRequestComment,
	type RawPullRequestNode,
	type RawPullRequestSummaryNode,
	type RepositoryDetailsResponseSchema,
} from "../src/services/githubSchemas.ts"

const checkRun = (over: { status?: string; conclusion?: string; name?: string } = {}): RawCheckContext =>
	Schema.decodeUnknownSync(RawCheckContextSchema)({
		__typename: "CheckRun",
		name: over.name ?? "build",
		status: over.status ?? "COMPLETED",
		conclusion: over.conclusion ?? "SUCCESS",
	})

const statusContext = (over: { state?: string; context?: string } = {}): RawCheckContext =>
	Schema.decodeUnknownSync(RawCheckContextSchema)({
		__typename: "StatusContext",
		context: over.context ?? "ci/legacy",
		state: over.state ?? "SUCCESS",
	})

describe("getPullRequestState", () => {
	test("merged trumps everything", () => {
		expect(getPullRequestState({ state: "OPEN", merged: true })).toBe("merged")
		expect(getPullRequestState({ state: "CLOSED", merged: true })).toBe("merged")
	})

	test("open vs closed", () => {
		expect(getPullRequestState({ state: "OPEN", merged: false })).toBe("open")
		expect(getPullRequestState({ state: "CLOSED", merged: false })).toBe("closed")
		expect(getPullRequestState({ state: "DRAFT", merged: false })).toBe("closed")
	})
})

describe("getReviewStatus", () => {
	test("draft trumps decision", () => {
		expect(getReviewStatus({ isDraft: true, reviewDecision: "APPROVED" })).toBe("draft")
	})

	test("known decisions", () => {
		expect(getReviewStatus({ isDraft: false, reviewDecision: "APPROVED" })).toBe("approved")
		expect(getReviewStatus({ isDraft: false, reviewDecision: "CHANGES_REQUESTED" })).toBe("changes")
		expect(getReviewStatus({ isDraft: false, reviewDecision: "REVIEW_REQUIRED" })).toBe("review")
	})

	test("no decision and unknown decision both become none", () => {
		expect(getReviewStatus({ isDraft: false, reviewDecision: null })).toBe("none")
		expect(getReviewStatus({ isDraft: false, reviewDecision: "SOMETHING_NEW" })).toBe("none")
	})
})

describe("normalizeMergeable", () => {
	test("known values", () => {
		expect(normalizeMergeable("MERGEABLE")).toBe("mergeable")
		expect(normalizeMergeable("CONFLICTING")).toBe("conflicting")
	})

	test("unknown defaults to 'unknown'", () => {
		expect(normalizeMergeable("UNKNOWN")).toBe("unknown")
		expect(normalizeMergeable("")).toBe("unknown")
	})
})

describe("getCheckInfoFromContexts", () => {
	test("empty contexts → status 'none'", () => {
		const info = getCheckInfoFromContexts([])
		expect(info.checkStatus).toBe("none")
		expect(info.checkSummary).toBeNull()
		expect(info.checks).toEqual([])
	})

	test("all successful check runs → status 'passing'", () => {
		const info = getCheckInfoFromContexts([checkRun(), checkRun({ name: "lint" })])
		expect(info.checkStatus).toBe("passing")
		expect(info.checkSummary).toBe("checks 2/2")
		expect(info.checks).toHaveLength(2)
		expect(info.checks[0]).toEqual({ name: "build", status: "completed", conclusion: "success" })
	})

	test("any in-progress check → status 'pending'", () => {
		const info = getCheckInfoFromContexts([checkRun(), checkRun({ status: "IN_PROGRESS", conclusion: "" })])
		expect(info.checkStatus).toBe("pending")
		expect(info.checkSummary).toBe("checks 1/2")
	})

	test("failure outweighs success when nothing pending", () => {
		const info = getCheckInfoFromContexts([checkRun(), checkRun({ name: "tests", conclusion: "FAILURE" })])
		expect(info.checkStatus).toBe("failing")
		expect(info.checkSummary).toBe("checks 1/2")
	})

	test("StatusContext PENDING is treated as in_progress; SUCCESS as completed/success", () => {
		const info = getCheckInfoFromContexts([statusContext({ state: "PENDING" }), statusContext({ state: "SUCCESS" })])
		expect(info.checkStatus).toBe("pending")
		expect(info.checks[0]?.status).toBe("in_progress")
		expect(info.checks[0]?.conclusion).toBeNull()
		expect(info.checks[1]?.status).toBe("completed")
		expect(info.checks[1]?.conclusion).toBe("success")
	})

	test("skipped/neutral conclusions count as successful and don't trip 'failing'", () => {
		const info = getCheckInfoFromContexts([checkRun({ conclusion: "NEUTRAL" }), checkRun({ name: "skip", conclusion: "SKIPPED" })])
		expect(info.checkStatus).toBe("passing")
		expect(info.checkSummary).toBe("checks 2/2")
	})
})

const baseSummary: RawPullRequestSummaryNode = {
	number: 42,
	title: "Add foo",
	state: "OPEN",
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-02T00:00:00Z",
	closedAt: null,
	url: "https://github.com/owner/repo/pull/42",
	author: { login: "kit" },
	repository: { nameWithOwner: "owner/repo", defaultBranchRef: { name: "main" } },
	isDraft: false,
	reviewDecision: null,
	autoMergeRequest: null,
	merged: false,
	headRefOid: "abc",
	headRefName: "feat/foo",
	baseRefName: "main",
}

describe("parsePullRequestSummary", () => {
	test("populates derived fields and zeroes detail-only fields", () => {
		const pr = parsePullRequestSummary(baseSummary)
		expect(pr.repository).toBe("owner/repo")
		expect(pr.state).toBe("open")
		expect(pr.reviewStatus).toBe("none")
		expect(pr.checkStatus).toBe("none")
		expect(pr.checks).toEqual([])
		expect(pr.body).toBe("")
		expect(pr.labels).toEqual([])
		expect(pr.additions).toBe(0)
		expect(pr.detailLoaded).toBe(false)
		expect(pr.defaultBranchName).toBe("main")
		expect(pr.closedAt).toBeNull()
	})

	test("falls back to baseRef when defaultBranchRef is missing", () => {
		const pr = parsePullRequestSummary({
			...baseSummary,
			repository: { nameWithOwner: "owner/repo" },
		})
		expect(pr.defaultBranchName).toBe("main")
	})

	test("normalizes the 0001 closed sentinel to null", () => {
		const pr = parsePullRequestSummary({ ...baseSummary, closedAt: "0001-01-01T00:00:00Z" })
		expect(pr.closedAt).toBeNull()
	})

	test("keeps pull requests from deleted authors displayable", () => {
		expect(parsePullRequestSummary({ ...baseSummary, author: null }).author).toBe("unknown")
	})
})

const baseDetail: RawPullRequestNode = {
	...baseSummary,
	body: "Long description",
	labels: { nodes: [{ name: "bug", color: "ff0000" }, { name: "no-color" }] },
	additions: 12,
	deletions: 3,
	changedFiles: 4,
}

describe("parsePullRequest", () => {
	test("includes body/labels/diff stats and prefixes hex colors with #", () => {
		const pr = parsePullRequest(baseDetail)
		expect(pr.body).toBe("Long description")
		expect(pr.detailLoaded).toBe(true)
		expect(pr.labels).toEqual([
			{ name: "bug", color: "#ff0000" },
			{ name: "no-color", color: null },
		])
		expect(pr.additions).toBe(12)
		expect(pr.deletions).toBe(3)
		expect(pr.changedFiles).toBe(4)
	})
})

describe("parseIssueSearchNode", () => {
	const issue: RawIssueSearchNode = {
		number: 7,
		title: "Bug",
		state: "OPEN",
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-02T00:00:00Z",
		closedAt: null,
		url: "https://github.com/owner/repo/issues/7",
		author: { login: "kit" },
		repository: { nameWithOwner: "owner/repo" },
		body: "details",
		labels: { nodes: [{ name: "ui", color: "#00ff00" }] },
		comments: { totalCount: 3 },
	}

	test("strips a leading # from label colors and re-adds one", () => {
		const parsed = parseIssueSearchNode(issue)
		expect(parsed.labels[0]).toEqual({ name: "ui", color: "#00ff00" })
	})

	test("state defaults to open when not 'closed'", () => {
		expect(parseIssueSearchNode(issue).state).toBe("open")
		expect(parseIssueSearchNode({ ...issue, state: "CLOSED" }).state).toBe("closed")
	})

	test("keeps issues from deleted authors displayable", () => {
		expect(parseIssueSearchNode({ ...issue, author: null }).author).toBe("unknown")
	})
})

describe("restCommentId", () => {
	const blank: RawPullRequestComment = {}

	test("numeric id", () => {
		expect(restCommentId({ ...blank, id: 9001 })).toBe("9001")
	})

	test("numeric-string id", () => {
		expect(restCommentId({ ...blank, id: "12345" })).toBe("12345")
	})

	test("falls back to API url", () => {
		expect(restCommentId({ ...blank, url: "https://api.github.com/repos/owner/repo/pulls/comments/7777" })).toBe("7777")
	})

	test("falls back to html_url discussion_r", () => {
		expect(restCommentId({ ...blank, html_url: "https://github.com/owner/repo/pull/1#discussion_r4242" })).toBe("4242")
	})

	test("falls back to html_url issuecomment", () => {
		expect(restCommentId({ ...blank, html_url: "https://github.com/owner/repo/issues/1#issuecomment-9001" })).toBe("9001")
	})

	test("returns null when nothing matches and id is a non-numeric string", () => {
		expect(restCommentId({ ...blank, id: "PRRC_abc" })).toBeNull()
	})
})

describe("parsePullRequestComment", () => {
	test("returns null when path/line/side are missing", () => {
		expect(parsePullRequestComment({})).toBeNull()
		expect(parsePullRequestComment({ path: "src/foo.ts", line: 1 })).toBeNull()
		expect(parsePullRequestComment({ path: "src/foo.ts", line: 1, side: "RIGHT" })).not.toBeNull()
	})

	test("uses original_line when line is missing", () => {
		const comment = parsePullRequestComment({ path: "src/foo.ts", original_line: 7, side: "LEFT", id: 1 })
		expect(comment?.line).toBe(7)
		expect(comment?.side).toBe("LEFT")
	})

	test("stringifies in_reply_to_id", () => {
		const comment = parsePullRequestComment({ path: "x", line: 1, side: "RIGHT", in_reply_to_id: 555, id: 1 })
		expect(comment?.inReplyTo).toBe("555")
	})
})

describe("parsePullRequestComments and parseIssueComments handle slurped pages", () => {
	const review: RawPullRequestComment = { id: 1, path: "src/a.ts", line: 1, side: "RIGHT", user: { login: "kit" }, body: "lgtm", created_at: "2026-01-01T00:00:00Z" }

	test("flat array", () => {
		const parsed = parsePullRequestComments([review])
		expect(parsed).toHaveLength(1)
		expect(parsed[0]?.body).toBe("lgtm")
	})

	test("nested (slurped) pages", () => {
		const parsed = parsePullRequestComments([[review], [{ ...review, id: 2 }]])
		expect(parsed).toHaveLength(2)
	})

	test("skips review comments that don't have a path/line/side", () => {
		const broken: RawPullRequestComment = { id: 3, user: { login: "kit" }, body: "stray", created_at: "2026-01-01T00:00:00Z" }
		expect(parsePullRequestComments([review, broken])).toHaveLength(1)
	})

	test("issue comments are tagged 'comment' and keep all rows", () => {
		const issue: RawPullRequestComment = { id: 9, user: { login: "kit" }, body: "thoughts", created_at: "2026-01-01T00:00:00Z" }
		const parsed = parseIssueComments([issue])
		expect(parsed).toHaveLength(1)
		expect(parsed[0]?._tag).toBe("comment")
	})
})

describe("parseIssueComment", () => {
	test("emits required fields with fallbacks", () => {
		const comment = parseIssueComment({})
		expect(comment._tag).toBe("comment")
		expect(comment.author).toBe("unknown")
		expect(comment.body).toBe("")
		expect(comment.createdAt).toBeNull()
		expect(comment.url).toBeNull()
		// fallback id derived from created_at + body
		expect(comment.id).toBe(":")
	})
})

describe("sortComments", () => {
	test("orders by createdAt and breaks ties by id", () => {
		const sorted = sortComments([
			{ _tag: "comment", id: "b", author: "x", body: "", createdAt: new Date("2026-01-02"), url: null },
			{ _tag: "comment", id: "a", author: "x", body: "", createdAt: new Date("2026-01-01"), url: null },
			{ _tag: "comment", id: "c", author: "x", body: "", createdAt: new Date("2026-01-01"), url: null },
		])
		expect(sorted.map((c) => c.id)).toEqual(["a", "c", "b"])
	})

	test("null createdAt sorts last", () => {
		const sorted = sortComments([
			{ _tag: "comment", id: "no-date", author: "x", body: "", createdAt: null, url: null },
			{ _tag: "comment", id: "dated", author: "x", body: "", createdAt: new Date("2026-01-01"), url: null },
		])
		expect(sorted.map((c) => c.id)).toEqual(["dated", "no-date"])
	})
})

describe("parseRepositoryDetails", () => {
	type Node = NonNullable<Schema.Schema.Type<typeof RepositoryDetailsResponseSchema>["data"]["repository"]>

	const node: Node = {
		description: "A repo",
		url: "https://github.com/owner/repo",
		stargazerCount: 1,
		forkCount: 2,
		openIssues: { totalCount: 3 },
		openPRs: { totalCount: 4 },
		defaultBranchRef: { name: "main" },
		pushedAt: "2026-01-01T00:00:00Z",
		isArchived: false,
		isPrivate: true,
	}

	test("copies fields and projects nested totals", () => {
		const details = parseRepositoryDetails("owner/repo", node)
		expect(details.repository).toBe("owner/repo")
		expect(details.openIssueCount).toBe(3)
		expect(details.openPullRequestCount).toBe(4)
		expect(details.defaultBranch).toBe("main")
		expect(details.pushedAt).toEqual(new Date("2026-01-01T00:00:00Z"))
	})

	test("null defaultBranchRef → null defaultBranch", () => {
		const details = parseRepositoryDetails("owner/repo", { ...node, defaultBranchRef: null })
		expect(details.defaultBranch).toBeNull()
	})

	test("0001 sentinel pushedAt → null", () => {
		const details = parseRepositoryDetails("owner/repo", { ...node, pushedAt: "0001-01-01T00:00:00Z" })
		expect(details.pushedAt).toBeNull()
	})
})

describe("parsePullRequestMergeInfo", () => {
	const info: Schema.Schema.Type<typeof MergeInfoResponseSchema> = {
		number: 42,
		title: "Fix",
		state: "OPEN",
		isDraft: false,
		mergeable: "MERGEABLE",
		reviewDecision: "APPROVED",
		autoMergeRequest: null,
		statusCheckRollup: [],
	}

	test("derives state/mergeable/reviewStatus and threads admin boolean", () => {
		const merge = parsePullRequestMergeInfo("owner/repo", info, true)
		expect(merge.repository).toBe("owner/repo")
		expect(merge.state).toBe("open")
		expect(merge.mergeable).toBe("mergeable")
		expect(merge.reviewStatus).toBe("approved")
		expect(merge.viewerCanMergeAsAdmin).toBe(true)
		expect(merge.autoMergeEnabled).toBe(false)
	})

	test("auto-merge enabled when request is non-null", () => {
		const merge = parsePullRequestMergeInfo("owner/repo", { ...info, autoMergeRequest: { something: true } }, false)
		expect(merge.autoMergeEnabled).toBe(true)
	})

	test("closed state for anything but OPEN", () => {
		expect(parsePullRequestMergeInfo("owner/repo", { ...info, state: "CLOSED" }, false).state).toBe("closed")
		expect(parsePullRequestMergeInfo("owner/repo", { ...info, state: "MERGED" }, false).state).toBe("closed")
	})
})

describe("parseRepositoryMergeMethods", () => {
	test("maps the three booleans", () => {
		expect(parseRepositoryMergeMethods({ squashMergeAllowed: true, mergeCommitAllowed: false, rebaseMergeAllowed: true })).toEqual({
			squash: true,
			merge: false,
			rebase: true,
		})
	})
})

describe("itemPage", () => {
	test("skips nullish nodes and respects hasNextPage + endCursor", () => {
		const page = itemPage({ nodes: [{ value: 1 }, null, { value: 2 }], pageInfo: { hasNextPage: true, endCursor: "abc" } }, (n: { value: number }) => n.value * 10)
		expect(page.items).toEqual([10, 20])
		expect(page.hasNextPage).toBe(true)
		expect(page.endCursor).toBe("abc")
	})

	test("hasNextPage requires both a true flag and a non-null cursor", () => {
		const page = itemPage({ nodes: [{ value: 1 }], pageInfo: { hasNextPage: true, endCursor: null } }, (n: { value: number }) => n.value)
		expect(page.hasNextPage).toBe(false)
	})
})

describe("comment fallbacks", () => {
	test("fallbackCreatedComment preserves user input", () => {
		const fallback = fallbackCreatedComment({
			repository: "owner/repo",
			number: 1,
			commitId: "abc",
			path: "src/foo.ts",
			line: 5,
			side: "RIGHT",
			body: "hi",
		})
		expect(fallback.path).toBe("src/foo.ts")
		expect(fallback.line).toBe(5)
		expect(fallback.side).toBe("RIGHT")
		expect(fallback.body).toBe("hi")
		expect(fallback.author).toBe("you")
		expect(fallback.inReplyTo).toBeNull()
	})

	test("fallbackReplyComment carries the in-reply-to id", () => {
		const reply = fallbackReplyComment("7777", "body")
		expect(reply._tag).toBe("review-comment")
		expect(reply._tag === "review-comment" && reply.inReplyTo).toBe("7777")
	})

	test("fallbackEditedReviewComment keeps the original comment id", () => {
		const edit = fallbackEditedReviewComment("9999", "new body")
		expect(edit._tag).toBe("review-comment")
		expect(edit.id).toBe("9999")
		expect(edit.body).toBe("new body")
	})
})
