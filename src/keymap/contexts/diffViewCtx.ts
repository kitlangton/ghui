import type { DiffCommentSide } from "../../domain.ts"
import type { DiffViewCtx } from "../diffView.ts"

export interface BuildDiffViewCtxInput {
	readonly halfPage: number
	readonly diffCommentRangeActive: boolean
	readonly setDiffCommentRangeStartIndex: (index: number | null) => void
	readonly runCommandById: (id: string) => void
	readonly openSelectedDiffComment: () => void
	readonly moveDiffCommentAnchor: (delta: number, options?: { readonly preserveViewportRow?: boolean }) => void
	readonly moveDiffCommentToBoundary: (boundary: "first" | "last") => void
	readonly alignSelectedDiffCommentAnchor: (position: "top" | "center" | "bottom") => void
	readonly selectDiffCommentSide: (side: DiffCommentSide) => void
}

export const buildDiffViewCtx = ({
	halfPage,
	diffCommentRangeActive,
	setDiffCommentRangeStartIndex,
	runCommandById,
	openSelectedDiffComment,
	moveDiffCommentAnchor,
	moveDiffCommentToBoundary,
	alignSelectedDiffCommentAnchor,
	selectDiffCommentSide,
}: BuildDiffViewCtxInput): DiffViewCtx => ({
	halfPage,
	handleEscape: () => {
		if (diffCommentRangeActive) setDiffCommentRangeStartIndex(null)
		else runCommandById("diff.close")
	},
	openSelectedComment: openSelectedDiffComment,
	toggleRange: () => runCommandById("diff.toggle-range"),
	toggleView: () => runCommandById("diff.toggle-view"),
	toggleWrap: () => runCommandById("diff.toggle-wrap"),
	reload: () => runCommandById("diff.reload"),
	nextThread: () => runCommandById("diff.next-thread"),
	previousThread: () => runCommandById("diff.previous-thread"),
	moveAnchor: moveDiffCommentAnchor,
	moveAnchorToBoundary: moveDiffCommentToBoundary,
	alignAnchor: alignSelectedDiffCommentAnchor,
	selectSide: selectDiffCommentSide,
	openChangedFiles: () => runCommandById("diff.changed-files"),
	toggleFilePanel: () => runCommandById("diff.toggle-file-panel"),
	openSubmitReview: () => runCommandById("pull.submit-review"),
	nextFile: () => runCommandById("diff.next-file"),
	previousFile: () => runCommandById("diff.previous-file"),
	openInBrowser: () => runCommandById("pull.open-browser"),
})
