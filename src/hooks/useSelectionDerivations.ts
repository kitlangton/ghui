import { useAtomValue } from "@effect/atom-react"
import { useMemo } from "react"
import type { IssueItem, PullRequestComment, PullRequestItem, PullRequestLabel } from "../domain.js"
import type { DetailCommentsStatus } from "../ui/DetailsPane.js"
import {
	commentsRowCountAtom,
	selectedCommentCountAtom,
	selectedCommentKeyAtom,
	selectedCommentsAtom,
	selectedCommentsStatusAtom,
	selectedCommentSubjectAtom,
	selectedItemLabelsAtom,
} from "../ui/comments/atoms.js"
import type { DiffFilePatch, DiffView } from "../ui/diff.js"
import { readyDiffFilesAtom } from "../ui/diff/atoms.js"
import { filterChangedFiles } from "../ui/modals/shared.js"

export interface UseSelectionDerivationsInput {
	readonly diffRenderView: DiffView
	readonly contentWidth: number
	readonly changedFilesModalActive: boolean
	readonly changedFilesQuery: string
}

export interface SelectionDerivations {
	readonly selectedCommentSubject: IssueItem | PullRequestItem | null
	readonly selectedCommentKey: string | null
	readonly selectedItemLabels: readonly PullRequestLabel[]
	readonly selectedComments: readonly PullRequestComment[]
	readonly selectedCommentsStatus: DetailCommentsStatus
	readonly selectedCommentCount: number
	readonly commentsRowCount: number
	readonly effectiveDiffRenderView: DiffView
	readonly readyDiffFiles: readonly DiffFilePatch[]
	readonly changedFileResults: ReturnType<typeof filterChangedFiles>
}

// Thin React-side wrapper over the selection-derived atoms. Items that can
// be computed entirely from atoms (selectedComments, readyDiffFiles, …) live
// in their respective atom modules — see `ui/comments/atoms.ts` and
// `ui/diff/atoms.ts`. The hook still owns the few derivations that depend on
// React-only state (terminal width, modal flags, the row-index lookup).
export const useSelectionDerivations = ({ diffRenderView, contentWidth, changedFilesModalActive, changedFilesQuery }: UseSelectionDerivationsInput): SelectionDerivations => {
	const selectedCommentSubject = useAtomValue(selectedCommentSubjectAtom)
	const selectedCommentKey = useAtomValue(selectedCommentKeyAtom)
	const selectedItemLabels = useAtomValue(selectedItemLabelsAtom)
	const selectedComments = useAtomValue(selectedCommentsAtom)
	const selectedCommentsStatus = useAtomValue(selectedCommentsStatusAtom)
	const selectedCommentCount = useAtomValue(selectedCommentCountAtom)
	const commentsRowCount = useAtomValue(commentsRowCountAtom)
	const readyDiffFiles = useAtomValue(readyDiffFilesAtom)

	const effectiveDiffRenderView: DiffView = contentWidth >= 100 ? diffRenderView : "unified"
	const changedFileResults = useMemo(
		() => (changedFilesModalActive ? filterChangedFiles(readyDiffFiles, changedFilesQuery) : []),
		[changedFilesModalActive, readyDiffFiles, changedFilesQuery],
	)
	return {
		selectedCommentSubject,
		selectedCommentKey,
		selectedItemLabels,
		selectedComments,
		selectedCommentsStatus,
		selectedCommentCount,
		commentsRowCount,
		effectiveDiffRenderView,
		readyDiffFiles,
		changedFileResults,
	}
}
