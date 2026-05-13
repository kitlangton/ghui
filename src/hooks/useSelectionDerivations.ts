import { useMemo } from "react"
import type { IssueItem, PullRequestComment, PullRequestItem, PullRequestLabel } from "../domain.js"
import type { DetailCommentsStatus } from "../ui/DetailsPane.js"
import type { DiffFilePatch, DiffView, DiffWhitespaceMode, PullRequestDiffState } from "../ui/diff.js"
import { minimizeWhitespaceDiffFiles, pullRequestDiffKey } from "../ui/diff.js"
import { filterChangedFiles } from "../ui/modals/shared.js"
import { pullRequestListRowIndex, type PullRequestListRow } from "../ui/PullRequestList.js"

export interface UseSelectionDerivationsInput {
	readonly activeWorkspaceSurface: "repos" | "pullRequests" | "issues"
	readonly selectedPullRequest: PullRequestItem | null
	readonly selectedIssue: IssueItem | null
	readonly pullRequestComments: Readonly<Record<string, readonly PullRequestComment[]>>
	readonly pullRequestCommentsLoaded: Readonly<Record<string, "loading" | "ready">>
	readonly selectedDiffState: PullRequestDiffState | undefined
	readonly diffWhitespaceMode: DiffWhitespaceMode
	readonly diffRenderView: DiffView
	readonly contentWidth: number
	readonly changedFilesModalActive: boolean
	readonly changedFilesQuery: string
	readonly pullRequestListRows: readonly PullRequestListRow[]
}

export interface SelectionDerivations {
	readonly selectedCommentSubject: IssueItem | PullRequestItem | null
	readonly selectedCommentKey: string | null
	readonly selectedItemLabels: readonly PullRequestLabel[]
	readonly selectedComments: readonly PullRequestComment[]
	readonly selectedCommentsStatus: DetailCommentsStatus
	readonly selectedCommentCount: number
	readonly effectiveDiffRenderView: DiffView
	readonly readyDiffFiles: readonly DiffFilePatch[]
	readonly changedFileResults: ReturnType<typeof filterChangedFiles>
	readonly selectedPullRequestRowIndex: number | null
}

/**
 * Memo cluster tying selection state to the loaded comments and diff
 * files. `selectedComments` is stabilised via useMemo so the threaded-
 * order pass downstream only refires when the underlying comment array
 * actually changes — not every App re-render.
 */
export const useSelectionDerivations = ({
	activeWorkspaceSurface,
	selectedPullRequest,
	selectedIssue,
	pullRequestComments,
	pullRequestCommentsLoaded,
	selectedDiffState,
	diffWhitespaceMode,
	diffRenderView,
	contentWidth,
	changedFilesModalActive,
	changedFilesQuery,
	pullRequestListRows,
}: UseSelectionDerivationsInput): SelectionDerivations => {
	const selectedCommentSubject = activeWorkspaceSurface === "issues" ? selectedIssue : activeWorkspaceSurface === "pullRequests" ? selectedPullRequest : null
	const selectedCommentKey =
		activeWorkspaceSurface === "issues"
			? selectedIssue
				? `issue:${selectedIssue.repository}#${selectedIssue.number}`
				: null
			: activeWorkspaceSurface === "pullRequests" && selectedPullRequest
				? pullRequestDiffKey(selectedPullRequest)
				: null
	const selectedItemLabels = selectedCommentSubject?.labels ?? []
	const selectedComments = useMemo(() => (selectedCommentKey ? (pullRequestComments[selectedCommentKey] ?? []) : []), [selectedCommentKey, pullRequestComments])
	const selectedCommentsStatus: DetailCommentsStatus = selectedCommentKey ? (pullRequestCommentsLoaded[selectedCommentKey] ?? "idle") : "idle"
	const selectedCommentCount = activeWorkspaceSurface === "issues" ? Math.max(selectedIssue?.commentCount ?? 0, selectedComments.length) : selectedComments.length
	const effectiveDiffRenderView: DiffView = contentWidth >= 100 ? diffRenderView : "unified"
	const readyDiffFiles = useMemo(
		() => (selectedDiffState?._tag === "Ready" ? (diffWhitespaceMode === "ignore" ? minimizeWhitespaceDiffFiles(selectedDiffState.files) : selectedDiffState.files) : []),
		[selectedDiffState, diffWhitespaceMode],
	)
	const changedFileResults = useMemo(
		() => (changedFilesModalActive ? filterChangedFiles(readyDiffFiles, changedFilesQuery) : []),
		[changedFilesModalActive, readyDiffFiles, changedFilesQuery],
	)
	const selectedPullRequestRowIndex = pullRequestListRowIndex(pullRequestListRows, selectedPullRequest?.url ?? null)

	return {
		selectedCommentSubject,
		selectedCommentKey,
		selectedItemLabels,
		selectedComments,
		selectedCommentsStatus,
		selectedCommentCount,
		effectiveDiffRenderView,
		readyDiffFiles,
		changedFileResults,
		selectedPullRequestRowIndex,
	}
}
