import { Schema } from "effect"
import {
	type CheckItem,
	type CreatePullRequestCommentInput,
	type IssueItem,
	type Mergeable,
	type PullRequestComment,
	type PullRequestItem,
	type PullRequestMergeInfo,
	type PullRequestReviewComment,
	type RepositoryDetails,
	type RepositoryMergeMethods,
	type ReviewStatus,
} from "../domain.js"
import { type ItemPage } from "../item.js"
import {
	type CommentsResponseSchema,
	type MergeInfoResponseSchema,
	type PullRequestConnection,
	type PullRequestFilesResponseSchema,
	type RawCheckContext,
	RawCheckContextSchema,
	type RawIssueSearchNode,
	type RawPullRequestComment,
	type RawPullRequestFile,
	type RawPullRequestNode,
	type RawPullRequestSummaryNode,
	type RepositoryDetailsResponseSchema,
	type RepositoryMergeMethodsResponseSchema,
} from "./githubSchemas.js"

// ---------------------------------------------------------------------------
// Scalar normalizers
// ---------------------------------------------------------------------------

export const normalizeDate = (value: string | null | undefined): Date | null => {
	if (!value || value.startsWith("0001-01-01")) return null
	return new Date(value)
}

export const getPullRequestState = (item: { readonly state: string; readonly merged: boolean }): PullRequestItem["state"] =>
	item.merged ? "merged" : item.state.toLowerCase() === "open" ? "open" : "closed"

const REVIEW_STATUS_BY_DECISION: Record<string, ReviewStatus> = {
	APPROVED: "approved",
	CHANGES_REQUESTED: "changes",
	REVIEW_REQUIRED: "review",
}

export const getReviewStatus = (item: { readonly isDraft: boolean; readonly reviewDecision: string | null }): ReviewStatus => {
	if (item.isDraft) return "draft"
	if (item.reviewDecision) return REVIEW_STATUS_BY_DECISION[item.reviewDecision] ?? "none"
	return "none"
}

const CHECK_STATUS_BY_RAW: Record<string, CheckItem["status"]> = {
	COMPLETED: "completed",
	IN_PROGRESS: "in_progress",
	QUEUED: "queued",
}

const CHECK_CONCLUSION_BY_RAW: Record<string, NonNullable<CheckItem["conclusion"]>> = {
	SUCCESS: "success",
	FAILURE: "failure",
	ERROR: "failure",
	NEUTRAL: "neutral",
	SKIPPED: "skipped",
	CANCELLED: "cancelled",
	TIMED_OUT: "timed_out",
}

export const normalizeCheckStatus = (raw: string | null | undefined): CheckItem["status"] => (raw ? (CHECK_STATUS_BY_RAW[raw] ?? "pending") : "pending")

export const normalizeCheckConclusion = (raw: string | null | undefined): CheckItem["conclusion"] => (raw ? (CHECK_CONCLUSION_BY_RAW[raw] ?? null) : null)

const MERGEABLE_BY_RAW: Record<string, Mergeable> = {
	MERGEABLE: "mergeable",
	CONFLICTING: "conflicting",
}

export const normalizeMergeable = (value: string): Mergeable => MERGEABLE_BY_RAW[value] ?? "unknown"

// ---------------------------------------------------------------------------
// Check rollup
// ---------------------------------------------------------------------------

const STATUS_CONTEXT_CONCLUSION: Record<string, NonNullable<CheckItem["conclusion"]>> = {
	SUCCESS: "success",
	FAILURE: "failure",
	ERROR: "failure",
}

const getContextStatus = (context: RawCheckContext): CheckItem["status"] =>
	RawCheckContextSchema.match(context, {
		CheckRun: (run) => normalizeCheckStatus(run.status),
		StatusContext: (status) => (status.state === "PENDING" ? "in_progress" : "completed"),
	})

const getContextConclusion = (context: RawCheckContext): CheckItem["conclusion"] =>
	RawCheckContextSchema.match(context, {
		CheckRun: (run) => normalizeCheckConclusion(run.conclusion),
		StatusContext: (status) => (status.state ? STATUS_CONTEXT_CONCLUSION[status.state] : null) ?? null,
	})

export const getCheckInfoFromContexts = (contexts: readonly RawCheckContext[]): Pick<PullRequestItem, "checkStatus" | "checkSummary" | "checks"> => {
	if (contexts.length === 0) {
		return { checkStatus: "none", checkSummary: null, checks: [] }
	}

	let completed = 0
	let successful = 0
	let pending = false
	let failing = false
	const checks: CheckItem[] = []

	for (const check of contexts) {
		const name = check.__typename === "CheckRun" ? (check.name ?? "check") : (check.context ?? "check")
		const status = getContextStatus(check)
		const conclusion = getContextConclusion(check)

		checks.push({ name, status, conclusion })

		if (status === "completed") {
			completed += 1
		} else {
			pending = true
		}

		if (conclusion === "success" || conclusion === "neutral" || conclusion === "skipped") {
			successful += 1
		} else if (conclusion) {
			failing = true
		}
	}

	if (pending) {
		return { checkStatus: "pending", checkSummary: `checks ${completed}/${contexts.length}`, checks }
	}

	if (failing) {
		return { checkStatus: "failing", checkSummary: `checks ${successful}/${contexts.length}`, checks }
	}

	return { checkStatus: "passing", checkSummary: `checks ${successful}/${contexts.length}`, checks }
}

// ---------------------------------------------------------------------------
// PR / Issue / Repository / MergeInfo parsing
// ---------------------------------------------------------------------------

export const parsePullRequestSummary = (item: RawPullRequestSummaryNode): PullRequestItem => {
	const checkInfo = getCheckInfoFromContexts(item.statusCheckRollup?.contexts.nodes ?? [])
	return {
		repository: item.repository.nameWithOwner,
		author: item.author?.login ?? "unknown",
		headRefOid: item.headRefOid,
		headRefName: item.headRefName,
		baseRefName: item.baseRefName,
		defaultBranchName: item.repository.defaultBranchRef?.name ?? item.baseRefName,
		number: item.number,
		title: item.title,
		body: "",
		labels: [],
		additions: 0,
		deletions: 0,
		changedFiles: 0,
		state: getPullRequestState(item),
		reviewStatus: getReviewStatus(item),
		checkStatus: checkInfo.checkStatus,
		checkSummary: checkInfo.checkSummary,
		checks: checkInfo.checks,
		autoMergeEnabled: item.autoMergeRequest !== null,
		detailLoaded: false,
		createdAt: new Date(item.createdAt),
		updatedAt: new Date(item.updatedAt),
		closedAt: normalizeDate(item.closedAt),
		url: item.url,
	}
}

export const parsePullRequest = (item: RawPullRequestNode): PullRequestItem => {
	const checkInfo = getCheckInfoFromContexts(item.statusCheckRollup?.contexts.nodes ?? [])
	return {
		...parsePullRequestSummary(item),
		body: item.body,
		labels: item.labels.nodes.map((label) => ({
			name: label.name,
			color: label.color ? `#${label.color}` : null,
		})),
		additions: item.additions,
		deletions: item.deletions,
		changedFiles: item.changedFiles,
		checkStatus: checkInfo.checkStatus,
		checkSummary: checkInfo.checkSummary,
		checks: checkInfo.checks,
		detailLoaded: true,
	}
}

export const parseIssueSearchNode = (item: RawIssueSearchNode): IssueItem => ({
	repository: item.repository.nameWithOwner,
	number: item.number,
	state: item.state.toLowerCase() === "closed" ? "closed" : "open",
	title: item.title,
	body: item.body,
	author: item.author?.login ?? "unknown",
	labels: item.labels.nodes.map((label) => ({
		name: label.name,
		color: label.color ? `#${label.color.replace(/^#/, "")}` : null,
	})),
	commentCount: item.comments.totalCount,
	createdAt: new Date(item.createdAt),
	updatedAt: new Date(item.updatedAt),
	url: item.url,
})

type RawRepositoryDetailsNode = NonNullable<Schema.Schema.Type<typeof RepositoryDetailsResponseSchema>["data"]["repository"]>

export const parseRepositoryDetails = (repository: string, node: RawRepositoryDetailsNode): RepositoryDetails => ({
	repository,
	description: node.description,
	url: node.url,
	stargazerCount: node.stargazerCount,
	forkCount: node.forkCount,
	openIssueCount: node.openIssues.totalCount,
	openPullRequestCount: node.openPRs.totalCount,
	defaultBranch: node.defaultBranchRef?.name ?? null,
	pushedAt: normalizeDate(node.pushedAt),
	isArchived: node.isArchived,
	isPrivate: node.isPrivate,
})

type RawMergeInfo = Schema.Schema.Type<typeof MergeInfoResponseSchema>

export const parsePullRequestMergeInfo = (repository: string, info: RawMergeInfo, viewerCanMergeAsAdmin: boolean): PullRequestMergeInfo => {
	const checkInfo = getCheckInfoFromContexts(info.statusCheckRollup)
	return {
		repository,
		number: info.number,
		title: info.title,
		state: info.state.toLowerCase() === "open" ? "open" : "closed",
		isDraft: info.isDraft,
		mergeable: normalizeMergeable(info.mergeable),
		reviewStatus: getReviewStatus(info),
		checkStatus: checkInfo.checkStatus,
		checkSummary: checkInfo.checkSummary,
		autoMergeEnabled: info.autoMergeRequest !== null,
		viewerCanMergeAsAdmin,
	}
}

type RawRepositoryMergeMethods = Schema.Schema.Type<typeof RepositoryMergeMethodsResponseSchema>

export const parseRepositoryMergeMethods = (response: RawRepositoryMergeMethods): RepositoryMergeMethods => ({
	squash: response.squashMergeAllowed,
	merge: response.mergeCommitAllowed,
	rebase: response.rebaseMergeAllowed,
})

// ---------------------------------------------------------------------------
// Page wrapping
// ---------------------------------------------------------------------------

export const itemPage = <Raw, Item>(connection: PullRequestConnection<Raw>, parse: (node: Raw) => Item): ItemPage<Item> => ({
	items: connection.nodes.flatMap((node) => (node ? [parse(node)] : [])),
	endCursor: connection.pageInfo.endCursor,
	hasNextPage: connection.pageInfo.hasNextPage && connection.pageInfo.endCursor !== null,
})

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

// Pull the numeric REST comment id out of the raw payload, falling back to the
// URL (e.g. `/pulls/comments/123456789` or `#discussion_r123456789`) when the
// `id` field itself is missing. The /replies endpoint only accepts the REST
// integer id — node_id (`PRRC_…`) is a 404.
export const restCommentId = (comment: RawPullRequestComment): string | null => {
	if (typeof comment.id === "number") return String(comment.id)
	if (typeof comment.id === "string" && /^\d+$/.test(comment.id)) return comment.id
	const fromApiUrl = comment.url?.match(/\/comments\/(\d+)/)?.[1]
	if (fromApiUrl) return fromApiUrl
	const fromHtmlUrl = comment.html_url?.match(/#(?:discussion_r|issuecomment-)(\d+)/)?.[1]
	if (fromHtmlUrl) return fromHtmlUrl
	return null
}

const rawCommentFields = (comment: RawPullRequestComment, fallbackId: string) => ({
	id: restCommentId(comment) ?? comment.node_id ?? fallbackId,
	author: comment.user?.login ?? "unknown",
	body: comment.body ?? "",
	createdAt: comment.created_at ? new Date(comment.created_at) : null,
	url: comment.html_url ?? comment.url ?? null,
})

export const parsePullRequestComment = (comment: RawPullRequestComment): PullRequestReviewComment | null => {
	const line = comment.line ?? comment.original_line
	if (!comment.path || !line || (comment.side !== "LEFT" && comment.side !== "RIGHT")) return null
	const inReplyTo = comment.in_reply_to_id != null ? String(comment.in_reply_to_id) : null
	return {
		...rawCommentFields(comment, `${comment.path}:${comment.side}:${line}:${comment.created_at ?? ""}:${comment.body ?? ""}`),
		path: comment.path,
		line,
		side: comment.side,
		inReplyTo,
	}
}

const flattenSlurpedPages = <Item>(response: readonly Item[] | readonly (readonly Item[])[]): readonly Item[] =>
	Array.isArray(response[0]) ? (response as readonly (readonly Item[])[]).flat() : (response as readonly Item[])

export const parsePullRequestComments = (response: Schema.Schema.Type<typeof CommentsResponseSchema>): readonly PullRequestReviewComment[] => {
	return flattenSlurpedPages(response).flatMap((comment) => {
		const parsed = parsePullRequestComment(comment)
		return parsed ? [parsed] : []
	})
}

export const parseIssueComment = (comment: RawPullRequestComment): PullRequestComment => ({
	_tag: "comment",
	...rawCommentFields(comment, `${comment.created_at ?? ""}:${comment.body ?? ""}`),
})

export const parseIssueComments = (response: Schema.Schema.Type<typeof CommentsResponseSchema>): readonly PullRequestComment[] =>
	flattenSlurpedPages(response).map(parseIssueComment)

export const reviewCommentAsComment = (comment: PullRequestReviewComment): PullRequestComment => ({
	_tag: "review-comment",
	...comment,
})

const commentTime = (item: PullRequestComment) => item.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER

export const sortComments = (items: readonly PullRequestComment[]): readonly PullRequestComment[] =>
	[...items].sort((left, right) => commentTime(left) - commentTime(right) || left.id.localeCompare(right.id))

// ---------------------------------------------------------------------------
// Comment fallbacks — used when GitHub responses lack the line/path fields
// needed to build a full review comment.
// ---------------------------------------------------------------------------

export const fallbackCreatedComment = (input: CreatePullRequestCommentInput): PullRequestReviewComment => ({
	id: `created:${input.repository}:${input.number}:${input.path}:${input.side}:${input.line}:${Date.now()}`,
	path: input.path,
	line: input.line,
	side: input.side,
	author: "you",
	body: input.body,
	createdAt: new Date(),
	url: null,
	inReplyTo: null,
})

export const fallbackReplyComment = (inReplyTo: string, body: string): PullRequestComment => ({
	_tag: "review-comment",
	id: `reply:${inReplyTo}:${Date.now()}`,
	path: "",
	line: 0,
	side: "RIGHT",
	author: "you",
	body,
	createdAt: new Date(),
	url: null,
	inReplyTo,
})

// PATCH on a non-line review comment (e.g. file-level) can return a payload
// that lacks `path`/`line` — keep the cached id and side stable so the caller
// can still swap the body in place.
export const fallbackEditedReviewComment = (commentId: string, body: string): PullRequestComment => ({
	_tag: "review-comment",
	id: commentId,
	path: "",
	line: 0,
	side: "RIGHT",
	author: "you",
	body,
	createdAt: new Date(),
	url: null,
	inReplyTo: null,
})

// ---------------------------------------------------------------------------
// Files → unified patch
// ---------------------------------------------------------------------------

export const parsePullRequestFiles = (response: Schema.Schema.Type<typeof PullRequestFilesResponseSchema>): readonly RawPullRequestFile[] => flattenSlurpedPages(response)

const diffPath = (path: string) => (/\s|"/.test(path) ? JSON.stringify(path) : path)

const prefixedDiffPath = (prefix: "a" | "b", path: string) => diffPath(`${prefix}/${path}`)

const fileHeaderPatch = (file: RawPullRequestFile) => {
	const oldPath = file.previous_filename ?? file.filename
	const newPath = file.filename
	const oldRef = file.status === "added" ? "/dev/null" : prefixedDiffPath("a", oldPath)
	const newRef = file.status === "removed" ? "/dev/null" : prefixedDiffPath("b", newPath)
	const lines = [
		`diff --git ${prefixedDiffPath("a", oldPath)} ${prefixedDiffPath("b", newPath)}`,
		...(file.status === "renamed" && file.previous_filename ? [`rename from ${oldPath}`, `rename to ${newPath}`] : []),
		`--- ${oldRef}`,
		`+++ ${newRef}`,
	]
	if (file.patch) lines.push(file.patch.trimEnd())
	return lines.join("\n")
}

export const pullRequestFilesToPatch = (files: readonly RawPullRequestFile[]): string => files.map(fileHeaderPatch).join("\n")
