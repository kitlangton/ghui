import type { CreatePullRequestCommentInput, IssueItem, PullRequestComment, PullRequestReviewComment } from "../../domain.js"
import { errorMessage } from "../../errors.js"
import { quotedReplyBody } from "../comments.js"
import {
	createPullRequestCommentAtom,
	createPullRequestIssueCommentAtom,
	deletePullRequestIssueCommentAtom,
	deleteReviewCommentAtom,
	editPullRequestIssueCommentAtom,
	editReviewCommentAtom,
	replyToReviewCommentAtom,
} from "./atoms.js"
import { useAtomSet } from "@effect/atom-react"
import type { CommentModalState, DeleteCommentModalState, FrozenCommentSubject } from "../modals.js"
import { initialCommentModalState } from "../modals.js"

const reviewCommentAsPullRequestComment = (comment: PullRequestReviewComment): PullRequestComment => ({ _tag: "review-comment", ...comment })

/** Selected comment must belong to the viewer and have a server id (not the
 * optimistic `local:` prefix) before edit/delete affordances are offered. */
export const canEditComment = (comment: PullRequestComment | null, username: string | null): comment is PullRequestComment =>
	comment !== null && username !== null && comment.author === username && !comment.id.startsWith("local:")

// Walk the inReplyTo chain to find the thread root id. The /replies endpoint
// rejects ids that aren't roots with "parent comment not found".
const findReviewThreadRootId = (comments: readonly PullRequestComment[], commentId: string): string => {
	const reviewById = new Map<string, PullRequestComment & { readonly _tag: "review-comment" }>()
	for (const entry of comments) if (entry._tag === "review-comment") reviewById.set(entry.id, entry)
	let cursor = reviewById.get(commentId)
	const seen = new Set<string>()
	while (cursor && cursor.inReplyTo && !seen.has(cursor.id)) {
		seen.add(cursor.id)
		const parent = reviewById.get(cursor.inReplyTo)
		if (!parent) break
		cursor = parent
	}
	return cursor?.id ?? commentId
}

export interface UseCommentMutationsInput {
	// Selection / context
	readonly selectedCommentSubject: { readonly repository: string; readonly number: number } | null
	readonly selectedCommentKey: string | null
	readonly selectedOrderedComment: PullRequestComment | null
	readonly selectedComments: readonly PullRequestComment[]
	readonly username: string | null
	readonly activeWorkspaceSurface: string
	readonly selectedIssue: IssueItem | null
	readonly pullRequestComments: Record<string, readonly PullRequestComment[]>
	readonly diffCommentThreads: Record<string, readonly PullRequestReviewComment[]>

	// Modal state
	readonly commentModal: CommentModalState
	readonly deleteCommentModal: DeleteCommentModalState

	// Setters
	readonly setCommentModal: (next: CommentModalState | ((prev: CommentModalState) => CommentModalState)) => void
	readonly setDeleteCommentModal: (next: DeleteCommentModalState | ((prev: DeleteCommentModalState) => DeleteCommentModalState)) => void
	readonly setPullRequestComments: (next: (prev: Record<string, readonly PullRequestComment[]>) => Record<string, readonly PullRequestComment[]>) => void
	readonly setDiffCommentThreads: (next: (prev: Record<string, readonly PullRequestReviewComment[]>) => Record<string, readonly PullRequestReviewComment[]>) => void
	readonly setDiffCommentRangeStartIndex: (next: number | null) => void

	// App-level helpers
	readonly closeActiveModal: () => void
	readonly flashNotice: (message: string) => void
	readonly updateIssue: (url: string, transform: (issue: IssueItem) => IssueItem) => void

	// Diff-comment thread key encoding (reused by App for color/anchor work)
	readonly diffCommentThreadMapKey: (diffKey: string, location: Pick<PullRequestReviewComment, "path" | "side" | "line">) => string
}

export interface UseCommentMutationsResult {
	readonly canEditSelectedComment: boolean
	readonly hasSelectedComment: boolean
	readonly submitDiffComment: () => void
	readonly submitIssueComment: () => void
	readonly submitReplyComment: () => void
	readonly submitEditComment: () => void
	readonly submitCommentModal: () => void
	readonly openNewIssueCommentModal: () => void
	readonly openReplyToSelectedComment: () => void
	readonly openEditSelectedComment: () => void
	readonly openDeleteSelectedComment: () => void
	readonly confirmDeleteComment: () => void
}

/**
 * Owns the comment mutation lifecycle: optimistic insert → server call →
 * swap-or-revert. The optimistic-rollback protocol is the load-bearing
 * invariant — every mutation (issue comment, diff review comment, reply,
 * edit, delete) flows through the same `submitOptimisticComment` helper
 * with onOptimistic/onCreated/onRevert callbacks for the mutation-specific
 * cache touches (diff thread map, issue commentCount).
 */
export const useCommentMutations = (input: UseCommentMutationsInput): UseCommentMutationsResult => {
	const createPullRequestComment = useAtomSet(createPullRequestCommentAtom, { mode: "promise" })
	const createPullRequestIssueComment = useAtomSet(createPullRequestIssueCommentAtom, { mode: "promise" })
	const replyToReviewComment = useAtomSet(replyToReviewCommentAtom, { mode: "promise" })
	const editPullRequestIssueComment = useAtomSet(editPullRequestIssueCommentAtom, { mode: "promise" })
	const editReviewComment = useAtomSet(editReviewCommentAtom, { mode: "promise" })
	const deletePullRequestIssueComment = useAtomSet(deletePullRequestIssueCommentAtom, { mode: "promise" })
	const deleteReviewComment = useAtomSet(deleteReviewCommentAtom, { mode: "promise" })

	const {
		selectedCommentSubject,
		selectedCommentKey,
		selectedOrderedComment,
		selectedComments,
		username,
		activeWorkspaceSurface,
		selectedIssue,
		pullRequestComments,
		diffCommentThreads,
		commentModal,
		deleteCommentModal,
		setCommentModal,
		setDeleteCommentModal,
		setPullRequestComments,
		setDiffCommentThreads,
		setDiffCommentRangeStartIndex,
		closeActiveModal,
		flashNotice,
		updateIssue,
		diffCommentThreadMapKey,
	} = input

	const submitOptimisticComment = (factory: {
		readonly key: string
		readonly optimistic: PullRequestComment
		readonly postingMessage: string
		readonly successMessage: string
		readonly request: () => Promise<PullRequestComment>
		readonly onOptimistic?: (comment: PullRequestComment) => void
		readonly onCreated?: (optimistic: PullRequestComment, created: PullRequestComment) => void
		readonly onRevert?: (comment: PullRequestComment) => void
	}) => {
		const { key, optimistic, postingMessage, successMessage, request, onOptimistic, onCreated, onRevert } = factory
		setPullRequestComments((current) => ({ ...current, [key]: [...(current[key] ?? []), optimistic] }))
		onOptimistic?.(optimistic)
		closeActiveModal()
		flashNotice(postingMessage)
		void request()
			.then((created) => {
				setPullRequestComments((current) => ({ ...current, [key]: (current[key] ?? []).map((entry) => (entry.id === optimistic.id ? created : entry)) }))
				onCreated?.(optimistic, created)
				flashNotice(successMessage)
			})
			.catch((error) => {
				setPullRequestComments((current) => ({ ...current, [key]: (current[key] ?? []).filter((entry) => entry.id !== optimistic.id) }))
				onRevert?.(optimistic)
				flashNotice(errorMessage(error))
			})
	}

	const requireCommentBody = (): string | null => {
		const body = commentModal.body.trim()
		if (body.length === 0) {
			setCommentModal((current) => ({ ...current, error: "Write a comment before saving." }))
			return null
		}
		return body
	}

	const frozenCommentSubject = (): FrozenCommentSubject | null =>
		selectedCommentSubject && selectedCommentKey
			? {
					repository: selectedCommentSubject.repository,
					number: selectedCommentSubject.number,
					key: selectedCommentKey,
					issueUrl: activeWorkspaceSurface === "issues" ? (selectedIssue?.url ?? null) : null,
				}
			: null

	const openNewIssueCommentModal = () => {
		const subject = frozenCommentSubject()
		if (!subject) return
		setCommentModal({ ...initialCommentModalState, target: { kind: "issue", subject } })
	}

	const openReplyToSelectedComment = () => {
		const subject = frozenCommentSubject()
		if (!subject) return
		const comment = selectedOrderedComment
		if (!comment) {
			flashNotice("No comment selected")
			return
		}
		if (comment._tag !== "review-comment") {
			// Issue comments don't thread on GitHub; pre-fill a quote so the reply
			// reads as a response in the chronological list.
			const quote = quotedReplyBody(comment.author, comment.body)
			setCommentModal({ ...initialCommentModalState, body: quote, cursor: quote.length, target: { kind: "issue", subject } })
			return
		}
		// GitHub /comments/{id}/replies wants the *thread root* id; replying via a
		// reply id can return "parent comment not found".
		const rootId = findReviewThreadRootId(selectedComments, comment.id)
		const anchor = `${comment.path}:${comment.line}`
		setCommentModal({ ...initialCommentModalState, target: { kind: "reply", subject, inReplyTo: rootId, anchorLabel: anchor } })
	}

	const submitDiffComment = () => {
		if (commentModal.target.kind !== "diff" || !commentModal.target.target) return
		const body = requireCommentBody()
		if (body === null) return

		const frozen = commentModal.target.target
		const targetRange = frozen.range
		const target = frozen.anchor
		const key = frozen.diffKey
		const threadKey = diffCommentThreadMapKey(frozen.diffKey, target)
		const optimisticReview = {
			id: `local:${Date.now()}`,
			path: target.path,
			line: target.line,
			side: target.side,
			author: username ?? "you",
			body,
			createdAt: new Date(),
			url: null,
			inReplyTo: null,
		} satisfies PullRequestReviewComment
		const rangeInput = targetRange && targetRange.start.line !== targetRange.end.line ? { startLine: targetRange.start.line, startSide: targetRange.start.side } : {}
		const apiInput = {
			repository: frozen.repository,
			number: frozen.number,
			commitId: frozen.commitId,
			path: target.path,
			line: target.line,
			side: target.side,
			body,
			...rangeInput,
		} satisfies CreatePullRequestCommentInput

		submitOptimisticComment({
			key,
			optimistic: reviewCommentAsPullRequestComment(optimisticReview),
			postingMessage: `Commenting on ${target.path}:${target.line}`,
			successMessage: `Commented on ${target.path}:${target.line}`,
			request: () => createPullRequestComment(apiInput).then(reviewCommentAsPullRequestComment),
			onOptimistic: () => {
				if (threadKey) {
					setDiffCommentThreads((current) => ({
						...current,
						[threadKey]: [...(current[threadKey] ?? []), optimisticReview],
					}))
				}
				setDiffCommentRangeStartIndex(null)
			},
			onCreated: (_optimistic, created) => {
				if (!threadKey || created._tag !== "review-comment") return
				setDiffCommentThreads((current) => ({
					...current,
					[threadKey]: (current[threadKey] ?? []).map((existing) => (existing.id === optimisticReview.id ? created : existing)),
				}))
			},
			onRevert: () => {
				if (!threadKey) return
				setDiffCommentThreads((current) => {
					const next = { ...current }
					const comments = (next[threadKey] ?? []).filter((comment) => comment.id !== optimisticReview.id)
					if (comments.length > 0) next[threadKey] = comments
					else delete next[threadKey]
					return next
				})
			},
		})
	}

	const submitIssueComment = () => {
		if (commentModal.target.kind !== "issue" || !commentModal.target.subject) return
		const body = requireCommentBody()
		if (body === null) return
		const { repository, number, key, issueUrl } = commentModal.target.subject
		submitOptimisticComment({
			key,
			optimistic: { _tag: "comment", id: `local:issue:${Date.now()}`, author: username ?? "you", body, createdAt: new Date(), url: null },
			postingMessage: `Posting comment on #${number}`,
			successMessage: `Commented on #${number}`,
			request: () => createPullRequestIssueComment({ repository, number, body }),
			onOptimistic: () => {
				if (issueUrl) updateIssue(issueUrl, (issue) => ({ ...issue, commentCount: issue.commentCount + 1 }))
			},
			onRevert: () => {
				if (issueUrl) updateIssue(issueUrl, (issue) => ({ ...issue, commentCount: Math.max(0, issue.commentCount - 1) }))
			},
		})
	}

	const submitReplyComment = () => {
		if (commentModal.target.kind !== "reply") return
		const body = requireCommentBody()
		if (body === null) return
		const { repository, number, key } = commentModal.target.subject
		const target = commentModal.target
		const parent = selectedComments.find((entry) => entry._tag === "review-comment" && entry.id === target.inReplyTo)
		const reviewParent = parent?._tag === "review-comment" ? parent : null
		const threadKey = reviewParent ? diffCommentThreadMapKey(key, reviewParent) : null
		submitOptimisticComment({
			key,
			optimistic: {
				_tag: "review-comment",
				id: `local:reply:${Date.now()}`,
				path: reviewParent?.path ?? "",
				line: reviewParent?.line ?? 0,
				side: reviewParent?.side ?? "RIGHT",
				author: username ?? "you",
				body,
				createdAt: new Date(),
				url: null,
				inReplyTo: target.inReplyTo,
			},
			postingMessage: `Replying on ${target.anchorLabel}`,
			successMessage: `Replied on ${target.anchorLabel}`,
			request: () => replyToReviewComment({ repository, number, inReplyTo: target.inReplyTo, body }),
			onOptimistic: (comment) => {
				if (!threadKey || comment._tag !== "review-comment") return
				setDiffCommentThreads((current) => ({ ...current, [threadKey]: [...(current[threadKey] ?? []), comment] }))
			},
			onCreated: (optimistic, created) => {
				if (!threadKey || created._tag !== "review-comment") return
				setDiffCommentThreads((current) => ({
					...current,
					[threadKey]: (current[threadKey] ?? []).map((comment) => (comment.id === optimistic.id ? created : comment)),
				}))
			},
			onRevert: (comment) => {
				if (!threadKey) return
				setDiffCommentThreads((current) => {
					const next = { ...current }
					const comments = (next[threadKey] ?? []).filter((entry) => entry.id !== comment.id)
					if (comments.length > 0) next[threadKey] = comments
					else delete next[threadKey]
					return next
				})
			},
		})
	}

	const openEditSelectedComment = () => {
		const subject = frozenCommentSubject()
		if (!subject) return
		const comment = selectedOrderedComment
		if (!canEditComment(comment, username)) {
			flashNotice(comment ? "Can't edit this comment" : "No comment selected")
			return
		}
		const anchorLabel = comment._tag === "review-comment" ? `Editing ${comment.path}:${comment.line}` : `Editing comment on #${subject.number}`
		setCommentModal({
			body: comment.body,
			cursor: comment.body.length,
			error: null,
			target: { kind: "edit", subject, commentId: comment.id, commentTag: comment._tag, anchorLabel },
		})
	}

	const submitEditComment = () => {
		if (commentModal.target.kind !== "edit") return
		const body = requireCommentBody()
		if (body === null) return
		const target = commentModal.target
		const key = target.subject.key
		const previous = (pullRequestComments[key] ?? []).find((entry) => entry.id === target.commentId)
		if (!previous) {
			setCommentModal((current) => ({ ...current, error: "Comment not found in cache." }))
			return
		}
		const repository = target.subject.repository

		const previousReview = previous._tag === "review-comment" ? previous : null
		const threadKey = previousReview ? diffCommentThreadMapKey(key, previousReview) : null
		const replaceInList = <T extends { readonly id: string }>(list: readonly T[], next: T) => list.map((entry) => (entry.id === target.commentId ? next : entry))

		setPullRequestComments((current) => ({ ...current, [key]: replaceInList(current[key] ?? [], { ...previous, body }) }))
		if (threadKey && previousReview) {
			setDiffCommentThreads((current) => ({
				...current,
				[threadKey]: replaceInList(current[threadKey] ?? [], { ...previousReview, body }),
			}))
		}
		closeActiveModal()
		flashNotice("Saving comment edit")

		const request =
			target.commentTag === "comment"
				? () => editPullRequestIssueComment({ repository, commentId: target.commentId, body })
				: () => editReviewComment({ repository, commentId: target.commentId, body })

		void request()
			.then((updated) => {
				setPullRequestComments((current) => ({ ...current, [key]: replaceInList(current[key] ?? [], updated) }))
				if (threadKey && updated._tag === "review-comment") {
					setDiffCommentThreads((current) => ({
						...current,
						[threadKey]: replaceInList(current[threadKey] ?? [], updated),
					}))
				}
				flashNotice("Comment updated")
			})
			.catch((error) => {
				setPullRequestComments((current) => ({ ...current, [key]: replaceInList(current[key] ?? [], previous) }))
				if (threadKey && previousReview) {
					setDiffCommentThreads((current) => ({
						...current,
						[threadKey]: replaceInList(current[threadKey] ?? [], previousReview),
					}))
				}
				flashNotice(errorMessage(error))
			})
	}

	const submitCommentModal = () => {
		switch (commentModal.target.kind) {
			case "diff":
				submitDiffComment()
				return
			case "issue":
				submitIssueComment()
				return
			case "reply":
				submitReplyComment()
				return
			case "edit":
				submitEditComment()
				return
		}
	}

	const openDeleteSelectedComment = () => {
		const subject = frozenCommentSubject()
		if (!subject) return
		const comment = selectedOrderedComment
		if (!canEditComment(comment, username)) {
			flashNotice(comment ? "Can't delete this comment" : "No comment selected")
			return
		}
		const firstLine = comment.body.split("\n").find((line) => line.trim().length > 0) ?? ""
		const preview = firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine
		setDeleteCommentModal({
			subject,
			commentId: comment.id,
			commentTag: comment._tag,
			author: comment.author,
			preview,
			running: false,
			error: null,
		})
	}

	const confirmDeleteComment = () => {
		if (!deleteCommentModal.subject || deleteCommentModal.running) return
		const target = { commentId: deleteCommentModal.commentId, commentTag: deleteCommentModal.commentTag }
		const key = deleteCommentModal.subject.key
		const list = pullRequestComments[key] ?? []
		const previousIndex = list.findIndex((entry) => entry.id === target.commentId)
		const previous = previousIndex >= 0 ? list[previousIndex] : undefined
		if (!previous) {
			setDeleteCommentModal((current) => ({ ...current, error: "Comment not found in cache." }))
			return
		}
		const previousReview = previous._tag === "review-comment" ? previous : null
		const threadKey = previousReview ? diffCommentThreadMapKey(key, previousReview) : null
		const previousThread = threadKey ? (diffCommentThreads[threadKey] ?? []) : []
		const previousThreadIndex = previousReview ? previousThread.findIndex((entry) => entry.id === previous.id) : -1
		const repository = deleteCommentModal.subject.repository
		const selectedIssueUrl = deleteCommentModal.subject.issueUrl

		setPullRequestComments((current) => ({
			...current,
			[key]: (current[key] ?? []).filter((entry) => entry.id !== target.commentId),
		}))
		if (threadKey) {
			setDiffCommentThreads((current) => {
				const next = { ...current }
				const filtered = (next[threadKey] ?? []).filter((entry) => entry.id !== target.commentId)
				if (filtered.length > 0) next[threadKey] = filtered
				else delete next[threadKey]
				return next
			})
		}
		closeActiveModal()
		flashNotice("Deleting comment")

		const request =
			target.commentTag === "comment"
				? () => deletePullRequestIssueComment({ repository, commentId: target.commentId })
				: () => deleteReviewComment({ repository, commentId: target.commentId })

		if (selectedIssueUrl && target.commentTag === "comment") updateIssue(selectedIssueUrl, (issue) => ({ ...issue, commentCount: Math.max(0, issue.commentCount - 1) }))

		void request()
			.then(() => flashNotice("Comment deleted"))
			.catch((error) => {
				// Splice the previous entry back at its original index in both caches.
				setPullRequestComments((current) => {
					const arr = current[key] ?? []
					if (arr.some((entry) => entry.id === previous.id)) return current
					const restored = [...arr]
					restored.splice(Math.min(previousIndex, restored.length), 0, previous)
					return { ...current, [key]: restored }
				})
				if (threadKey && previousReview) {
					setDiffCommentThreads((current) => {
						const arr = current[threadKey] ?? []
						if (arr.some((entry) => entry.id === previousReview.id)) return current
						const restored = [...arr]
						const insertIndex = previousThreadIndex >= 0 ? previousThreadIndex : restored.length
						restored.splice(Math.min(insertIndex, restored.length), 0, previousReview)
						return { ...current, [threadKey]: restored }
					})
				}
				if (selectedIssueUrl && target.commentTag === "comment") updateIssue(selectedIssueUrl, (issue) => ({ ...issue, commentCount: issue.commentCount + 1 }))
				flashNotice(errorMessage(error))
			})
	}

	return {
		canEditSelectedComment: canEditComment(selectedOrderedComment, username),
		hasSelectedComment: selectedOrderedComment !== null,
		submitDiffComment,
		submitIssueComment,
		submitReplyComment,
		submitEditComment,
		submitCommentModal,
		openNewIssueCommentModal,
		openReplyToSelectedComment,
		openEditSelectedComment,
		openDeleteSelectedComment,
		confirmDeleteComment,
	}
}
