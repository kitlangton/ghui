import type { ScrollBoxRenderable } from "@opentui/core"
import type { MutableRefObject } from "react"
import type { PullRequestItem } from "../domain.js"
import { type CommentEditorValue } from "../ui/commentEditor.js"
import type { CommentModalState, SubmitReviewModalState } from "../ui/modals/types.js"

export interface UseImperativeActionsInput {
	readonly contentWidth: number
	readonly detailScrollRef: MutableRefObject<ScrollBoxRenderable | null>
	readonly detailPreviewScrollRef: MutableRefObject<ScrollBoxRenderable | null>
	readonly diffScrollRef: MutableRefObject<ScrollBoxRenderable | null>
	readonly setDetailScrollOffset: (next: number | ((current: number) => number)) => void
	readonly setCommentModal: (next: CommentModalState | ((prev: CommentModalState) => CommentModalState)) => void
	readonly setSubmitReviewModal: (next: SubmitReviewModalState | ((prev: SubmitReviewModalState) => SubmitReviewModalState)) => void
	readonly setDiffFullView: (next: boolean) => void
	readonly setDetailFullView: (next: boolean) => void
	readonly setCommentsViewActive: (next: boolean) => void
	readonly setDiffFileIndex: (next: number) => void
	readonly setDiffScrollTop: (next: number) => void
	readonly setDiffCommentAnchorIndex: (next: number) => void
	readonly setDiffPreferredSide: (next: null) => void
	readonly setDiffCommentRangeStartIndex: (next: number | null) => void
	readonly setDiffRenderView: (next: "split" | "unified") => void
	readonly selectedPullRequest: PullRequestItem | null
	readonly resetDiffLineColors: () => void
	readonly loadPullRequestDiff: (pr: PullRequestItem, options?: { readonly force?: boolean; readonly includeComments?: boolean }) => void
}

export interface ImperativeActions {
	readonly scrollDetailPreviewBy: (y: number) => void
	readonly scrollDetailPreviewTo: (y: number) => void
	readonly scrollDetailFullViewBy: (delta: number) => void
	readonly scrollDetailFullViewTo: (y: number) => void
	readonly setCommentEditorValue: (body: string, cursor: number) => void
	readonly editSubmitReview: (transform: (state: CommentEditorValue) => CommentEditorValue) => void
	readonly openDiffView: () => void
}

/**
 * Small imperative helpers for scroll, editor mutation, and full-screen
 * diff entry. None of them justify their own hook; together they're
 * the "App's miscellaneous action bag" — small enough that callers
 * usually want just one, large enough that inlining all eight in
 * App.tsx is noise.
 */
export const useImperativeActions = ({
	contentWidth,
	detailScrollRef,
	detailPreviewScrollRef,
	diffScrollRef,
	setDetailScrollOffset,
	setCommentModal,
	setSubmitReviewModal,
	setDiffFullView,
	setDetailFullView,
	setCommentsViewActive,
	setDiffFileIndex,
	setDiffScrollTop,
	setDiffCommentAnchorIndex,
	setDiffPreferredSide,
	setDiffCommentRangeStartIndex,
	setDiffRenderView,
	selectedPullRequest,
	resetDiffLineColors,
	loadPullRequestDiff,
}: UseImperativeActionsInput): ImperativeActions => ({
	scrollDetailPreviewBy: (y) => {
		detailPreviewScrollRef.current?.scrollBy({ x: 0, y })
	},
	scrollDetailPreviewTo: (y) => {
		detailPreviewScrollRef.current?.scrollTo({ x: 0, y })
	},
	scrollDetailFullViewBy: (delta) => {
		detailScrollRef.current?.scrollBy({ x: 0, y: delta })
		setDetailScrollOffset((current) => Math.max(0, current + delta))
	},
	scrollDetailFullViewTo: (y) => {
		detailScrollRef.current?.scrollTo({ x: 0, y })
		setDetailScrollOffset(y)
	},
	setCommentEditorValue: (body, cursor) => {
		setCommentModal((current) => (current.body === body && current.cursor === cursor && current.error === null ? current : { ...current, body, cursor, error: null }))
	},
	editSubmitReview: (transform) => {
		setSubmitReviewModal((current) => {
			const next = transform({ body: current.body, cursor: current.cursor })
			if (next.body === current.body && next.cursor === current.cursor && current.error === null) return current
			return { ...current, body: next.body, cursor: next.cursor, error: null }
		})
	},
	openDiffView: () => {
		if (!selectedPullRequest) return
		resetDiffLineColors()
		setDiffFullView(true)
		setDetailFullView(false)
		setCommentsViewActive(false)
		setDiffFileIndex(0)
		setDiffScrollTop(0)
		setDiffCommentAnchorIndex(0)
		setDiffPreferredSide(null)
		setDiffCommentRangeStartIndex(null)
		setDiffRenderView(contentWidth >= 100 ? "split" : "unified")
		diffScrollRef.current?.scrollTo({ x: 0, y: 0 })
		loadPullRequestDiff(selectedPullRequest, { includeComments: true })
	},
})
