import type { IssueItem, PullRequestComment, PullRequestItem } from "../domain.js"
import { canEditComment } from "../ui/comments/useCommentMutations.js"
import type { LoadStatus } from "../domain.js"
import type { RetryProgress } from "../ui/FooterHints.js"
import type { CloseModalState, MergeModalState, PullRequestStateModalState, SubmitReviewModalState } from "../ui/modals/types.js"
import type { RepositoryListItem } from "../ui/RepoList.js"
import type { WorkspaceFooterProps } from "../surfaces/WorkspaceFooter.js"
import type { WorkspaceSurface } from "../workspaceSurfaces.js"

export interface ComputeFooterPropsInput {
	readonly footerNotice: string | null
	readonly filterMode: boolean
	readonly visibleFilterText: string
	readonly filterPlaceholder: string
	readonly filterQuery: string
	readonly detailFullView: boolean
	readonly diffFullView: boolean
	readonly diffCommentRangeActive: boolean
	readonly commentsViewActive: boolean
	readonly selectedCommentsStatus: "idle" | "loading" | "ready"
	readonly selectedOrderedComment: PullRequestComment | null
	readonly username: string | null
	readonly selectedCommentsLength: number
	readonly selectedCommentSubject: IssueItem | PullRequestItem | null
	readonly activeWorkspaceSurface: WorkspaceSurface
	readonly selectedRepositoryItem: RepositoryListItem | null
	readonly selectedRepository: string | null
	readonly selectedPullRequest: PullRequestItem | null
	readonly pullRequestStatus: LoadStatus
	readonly issuesStatus: LoadStatus
	readonly isActiveSurfaceLoading: boolean
	readonly closeModal: CloseModalState
	readonly pullRequestStateModal: PullRequestStateModalState
	readonly mergeModal: MergeModalState
	readonly submitReviewModal: SubmitReviewModalState
	readonly loadingIndicator: string
	readonly retryProgress: RetryProgress
}

/**
 * Collapses 20 inline boolean computations the footer needs into one
 * derivation step. Means App.tsx renders `<WorkspaceFooter {...footerProps} />`
 * instead of a 26-line attribute list with embedded expressions.
 */
export const computeFooterProps = (input: ComputeFooterPropsInput): WorkspaceFooterProps => ({
	footerNotice: input.footerNotice,
	filterMode: input.filterMode,
	visibleFilterText: input.visibleFilterText,
	filterPlaceholder: input.filterPlaceholder,
	showFilterClear: input.filterMode || input.filterQuery.length > 0,
	detailFullView: input.detailFullView,
	diffFullView: input.diffFullView,
	diffRangeActive: input.diffCommentRangeActive,
	commentsViewActive: input.commentsViewActive,
	commentsViewOnRealComment: input.commentsViewActive && input.selectedCommentsStatus === "ready" && input.selectedOrderedComment !== null,
	commentsViewCanEditSelected: canEditComment(input.selectedOrderedComment, input.username),
	commentsViewCount: input.selectedCommentsLength,
	hasSelection: input.selectedCommentSubject !== null,
	canOpenDetails: input.selectedCommentSubject !== null,
	canOpenRepository: input.activeWorkspaceSurface === "repos" && input.selectedRepositoryItem !== null,
	canAddRepository: input.activeWorkspaceSurface === "repos",
	canRemoveRepository: input.activeWorkspaceSurface === "repos" && input.selectedRepositoryItem !== null,
	canCycleScopeFilter: input.selectedRepository !== null && (input.activeWorkspaceSurface === "pullRequests" || input.activeWorkspaceSurface === "issues"),
	canOpenDiff: input.activeWorkspaceSurface === "pullRequests" && input.selectedPullRequest !== null,
	canOpenComments: input.selectedCommentSubject !== null,
	hasError:
		(input.activeWorkspaceSurface === "pullRequests" && input.pullRequestStatus === "error") || (input.activeWorkspaceSurface === "issues" && input.issuesStatus === "error"),
	isLoading: input.isActiveSurfaceLoading || input.closeModal.running || input.pullRequestStateModal.running || input.mergeModal.running || input.submitReviewModal.running,
	loadingIndicator: input.loadingIndicator,
	retryProgress: input.retryProgress,
})
