import type { ScrollBoxRenderable, DiffRenderable } from "@opentui/core"
import type { ComponentProps, MutableRefObject } from "react"
import type { DiffCommentSide, IssueItem, PullRequestComment, PullRequestItem, PullRequestReviewComment, RepositoryDetails } from "../domain.js"
import type { ThemeId } from "../ui/colors.js"
import type { DetailCommentsStatus, DetailPlaceholderContent } from "../ui/DetailsPane.js"
import type { DiffView, DiffWhitespaceMode, DiffWrapMode, PullRequestDiffState, StackedDiffCommentAnchor, StackedDiffFilePatch } from "../ui/diff.js"
import type { IssueList } from "../ui/IssueList.js"
import type { PullRequestList } from "../ui/PullRequestList.js"
import type { OrderedComment } from "../ui/CommentsPane.js"
import type { RepoList, RepositoryListItem } from "../ui/RepoList.js"
import type { WorkspaceSurface } from "../workspaceSurfaces.js"
import { IssueSurface } from "./IssueSurface.js"
import { PullRequestSurface } from "./PullRequestSurface.js"
import { RepoSurface } from "./RepoSurface.js"

export interface WorkspaceContentProps {
	readonly activeWorkspaceSurface: WorkspaceSurface
	readonly commentsViewActive: boolean
	readonly diffFullView: boolean
	readonly detailFullView: boolean

	// Layout
	readonly isWideLayout: boolean
	readonly wideBodyHeight: number
	readonly contentWidth: number
	readonly leftPaneWidth: number
	readonly rightPaneWidth: number
	readonly leftContentWidth: number
	readonly rightContentWidth: number
	readonly fullscreenContentWidth: number
	readonly sectionPadding: number
	readonly wideDetailHeaderHeight: number
	readonly wideDetailBodyScrollable: boolean
	readonly wideDetailLines: number
	readonly fullscreenDetailHeaderHeight: number
	readonly fullscreenDetailBodyScrollable: boolean
	readonly fullscreenBodyLines: number
	readonly widePullRequestListHeight: number
	readonly widePullRequestListNeedsScroll: boolean
	readonly narrowPullRequestListHeight: number
	readonly narrowPullRequestRowsHeight: number
	readonly narrowPullRequestListNeedsScroll: boolean
	readonly narrowDetailsPaneHeight: number
	readonly narrowPreviewBodyHeight: number
	readonly narrowPreviewBodyScrollable: boolean
	readonly narrowRepoListHeight: number
	readonly narrowRepoDetailHeight: number
	readonly narrowIssueListHeight: number
	readonly narrowIssueDetailHeight: number

	// Repo surface
	readonly repoListNeedsScroll: boolean
	readonly narrowRepoListNeedsScroll: boolean
	readonly repoListProps: Omit<ComponentProps<typeof RepoList>, "contentWidth">
	readonly selectedRepositoryItem: RepositoryListItem | null
	readonly selectedRepositoryDetails: RepositoryDetails | null

	// Issue surface
	readonly issueListNeedsScroll: boolean
	readonly narrowIssueListNeedsScroll: boolean
	readonly issueActiveFilterLabel: string | null
	readonly issueJunctions: readonly number[]
	readonly issueListProps: Omit<ComponentProps<typeof IssueList>, "contentWidth">
	readonly selectedIssue: IssueItem | null
	readonly issueListScrollRef: MutableRefObject<ScrollBoxRenderable | null>

	// PR surface
	readonly pullRequestActiveFilterLabel: string | null
	readonly detailJunctions: readonly number[]
	readonly prListProps: Omit<ComponentProps<typeof PullRequestList>, "contentWidth">
	readonly selectedPullRequest: PullRequestItem | null
	readonly selectedComments: readonly PullRequestComment[]
	readonly selectedCommentsStatus: DetailCommentsStatus
	readonly detailPlaceholderContent: DetailPlaceholderContent
	readonly isSelectedPullRequestDetailLoading: boolean
	readonly isSelectedPullRequestDetailError: boolean
	readonly selectedPullRequestDetailError: string | null
	readonly commentsViewSelection: number
	readonly orderedComments: readonly OrderedComment[]
	readonly selectedCommentSubject: IssueItem | PullRequestItem | null
	readonly displayedDiffState: PullRequestDiffState | undefined
	readonly stackedDiffFiles: readonly StackedDiffFilePatch[]
	readonly diffScrollTop: number
	readonly effectiveDiffRenderView: DiffView
	readonly diffWhitespaceMode: DiffWhitespaceMode
	readonly diffWrapMode: DiffWrapMode
	readonly selectedDiffCommentAnchor: StackedDiffCommentAnchor | null
	readonly selectedDiffCommentLabel: string | null
	readonly selectedDiffCommentThread: readonly PullRequestReviewComment[]
	readonly selectDiffCommentLine: (renderLine: number, side: DiffCommentSide | null) => void
	readonly setDiffRenderableRef: (index: number, diff: DiffRenderable | null) => void
	readonly loadingIndicator: string
	readonly themeId: ThemeId
	readonly systemThemeGeneration: number

	// Refs
	readonly prListScrollRef: MutableRefObject<ScrollBoxRenderable | null>
	readonly detailScrollRef: MutableRefObject<ScrollBoxRenderable | null>
	readonly detailPreviewScrollRef: MutableRefObject<ScrollBoxRenderable | null>
	readonly diffScrollRef: MutableRefObject<ScrollBoxRenderable | null>

	readonly openInlineLink: (url: string) => void
}

export const WorkspaceContent = (props: WorkspaceContentProps) => {
	const { activeWorkspaceSurface, commentsViewActive, diffFullView, detailFullView } = props
	if (activeWorkspaceSurface === "repos" && !commentsViewActive && !diffFullView && !detailFullView) {
		return (
			<RepoSurface
				isWideLayout={props.isWideLayout}
				wideBodyHeight={props.wideBodyHeight}
				contentWidth={props.contentWidth}
				leftPaneWidth={props.leftPaneWidth}
				rightPaneWidth={props.rightPaneWidth}
				leftContentWidth={props.leftContentWidth}
				fullscreenContentWidth={props.fullscreenContentWidth}
				sectionPadding={props.sectionPadding}
				narrowRepoListHeight={props.narrowRepoListHeight}
				narrowRepoDetailHeight={props.narrowRepoDetailHeight}
				repoListNeedsScroll={props.repoListNeedsScroll}
				narrowRepoListNeedsScroll={props.narrowRepoListNeedsScroll}
				repoListProps={props.repoListProps}
				selectedRepositoryItem={props.selectedRepositoryItem}
				selectedRepositoryDetails={props.selectedRepositoryDetails}
				detailPreviewScrollRef={props.detailPreviewScrollRef}
			/>
		)
	}
	if (activeWorkspaceSurface === "issues" && !commentsViewActive && !diffFullView) {
		return (
			<IssueSurface
				isWideLayout={props.isWideLayout}
				wideBodyHeight={props.wideBodyHeight}
				contentWidth={props.contentWidth}
				leftPaneWidth={props.leftPaneWidth}
				rightPaneWidth={props.rightPaneWidth}
				leftContentWidth={props.leftContentWidth}
				fullscreenContentWidth={props.fullscreenContentWidth}
				sectionPadding={props.sectionPadding}
				narrowIssueListHeight={props.narrowIssueListHeight}
				narrowIssueDetailHeight={props.narrowIssueDetailHeight}
				issueListNeedsScroll={props.issueListNeedsScroll}
				narrowIssueListNeedsScroll={props.narrowIssueListNeedsScroll}
				activeFilterLabel={props.issueActiveFilterLabel}
				issueJunctions={props.issueJunctions}
				issueListProps={props.issueListProps}
				selectedIssue={props.selectedIssue}
				issueListScrollRef={props.issueListScrollRef}
				detailPreviewScrollRef={props.detailPreviewScrollRef}
				detailFullView={detailFullView}
				onLinkOpen={props.openInlineLink}
			/>
		)
	}
	return (
		<PullRequestSurface
			isWideLayout={props.isWideLayout}
			contentWidth={props.contentWidth}
			leftPaneWidth={props.leftPaneWidth}
			rightPaneWidth={props.rightPaneWidth}
			leftContentWidth={props.leftContentWidth}
			rightContentWidth={props.rightContentWidth}
			fullscreenContentWidth={props.fullscreenContentWidth}
			sectionPadding={props.sectionPadding}
			wideBodyHeight={props.wideBodyHeight}
			wideDetailHeaderHeight={props.wideDetailHeaderHeight}
			wideDetailBodyScrollable={props.wideDetailBodyScrollable}
			wideDetailLines={props.wideDetailLines}
			fullscreenDetailHeaderHeight={props.fullscreenDetailHeaderHeight}
			fullscreenDetailBodyScrollable={props.fullscreenDetailBodyScrollable}
			fullscreenBodyLines={props.fullscreenBodyLines}
			widePullRequestListHeight={props.widePullRequestListHeight}
			widePullRequestListNeedsScroll={props.widePullRequestListNeedsScroll}
			narrowPullRequestListHeight={props.narrowPullRequestListHeight}
			narrowPullRequestRowsHeight={props.narrowPullRequestRowsHeight}
			narrowPullRequestListNeedsScroll={props.narrowPullRequestListNeedsScroll}
			narrowDetailsPaneHeight={props.narrowDetailsPaneHeight}
			narrowPreviewBodyHeight={props.narrowPreviewBodyHeight}
			narrowPreviewBodyScrollable={props.narrowPreviewBodyScrollable}
			activeFilterLabel={props.pullRequestActiveFilterLabel}
			detailJunctions={props.detailJunctions}
			prListProps={props.prListProps}
			selectedPullRequest={props.selectedPullRequest}
			selectedComments={props.selectedComments}
			selectedCommentsStatus={props.selectedCommentsStatus}
			detailPlaceholderContent={props.detailPlaceholderContent}
			isSelectedPullRequestDetailLoading={props.isSelectedPullRequestDetailLoading}
			isSelectedPullRequestDetailError={props.isSelectedPullRequestDetailError}
			selectedPullRequestDetailError={props.selectedPullRequestDetailError}
			commentsViewActive={commentsViewActive}
			commentsViewSelection={props.commentsViewSelection}
			orderedComments={props.orderedComments}
			commentSubject={props.selectedCommentSubject}
			diffFullView={diffFullView}
			displayedDiffState={props.displayedDiffState}
			stackedDiffFiles={props.stackedDiffFiles}
			diffScrollTop={props.diffScrollTop}
			effectiveDiffRenderView={props.effectiveDiffRenderView}
			diffWhitespaceMode={props.diffWhitespaceMode}
			diffWrapMode={props.diffWrapMode}
			selectedDiffCommentAnchor={props.selectedDiffCommentAnchor}
			selectedDiffCommentLabel={props.selectedDiffCommentLabel}
			selectedDiffCommentThread={props.selectedDiffCommentThread}
			selectDiffCommentLine={props.selectDiffCommentLine}
			setDiffRenderableRef={props.setDiffRenderableRef}
			detailFullView={detailFullView}
			loadingIndicator={props.loadingIndicator}
			themeId={props.themeId}
			systemThemeGeneration={props.systemThemeGeneration}
			prListScrollRef={props.prListScrollRef}
			detailScrollRef={props.detailScrollRef}
			detailPreviewScrollRef={props.detailPreviewScrollRef}
			diffScrollRef={props.diffScrollRef}
			onLinkOpen={props.openInlineLink}
		/>
	)
}
