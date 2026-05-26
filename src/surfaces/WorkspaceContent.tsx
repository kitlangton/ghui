import type { ScrollBoxRenderable, DiffRenderable } from "@opentui/core"
import type { MutableRefObject } from "react"
import type { DiffCommentSide, IssueItem, PullRequestComment, PullRequestItem, PullRequestReviewComment, RepositoryDetails } from "../domain.js"
import type { ThemeId } from "../ui/colors.js"
import type { DetailCommentsStatus, DetailPlaceholderContent } from "../ui/DetailsPane.js"
import type { DiffFilePatch, DiffView, DiffWhitespaceMode, DiffWrapMode, PullRequestDiffState, StackedDiffCommentAnchor, StackedDiffFilePatch } from "../ui/diff.js"
import type { ChangedFileSearchResult } from "../ui/modals/shared.js"
import type { OrderedComment } from "../ui/CommentsPane.js"
import type { RepositoryListItem } from "../ui/RepoList.js"
import type { WorkspaceSurface } from "../workspaceSurfaces.js"
import type { WorkspaceLayout } from "../workspace/layout.js"
import type { WorkspaceDerivations } from "../workspace/derivations.js"
import { IssueSurface } from "./IssueSurface.js"
import { PullRequestSurface } from "./PullRequestSurface.js"
import { RepoSurface } from "./RepoSurface.js"

export interface WorkspaceContentProps {
	readonly showScrollbars: boolean
	readonly activeWorkspaceSurface: WorkspaceSurface
	readonly commentsViewActive: boolean
	readonly diffFullView: boolean
	readonly detailFullView: boolean
	readonly layout: WorkspaceLayout
	readonly derivations: WorkspaceDerivations
	readonly issueActiveFilterLabel: string | null
	readonly pullRequestActiveFilterLabel: string | null
	readonly selectedRepositoryItem: RepositoryListItem | null
	readonly selectedRepositoryDetails: RepositoryDetails | null
	readonly selectedIssue: IssueItem | null
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
	readonly scrollRefs: {
		readonly prListScrollRef: MutableRefObject<ScrollBoxRenderable | null>
		readonly detailScrollRef: MutableRefObject<ScrollBoxRenderable | null>
		readonly detailPreviewScrollRef: MutableRefObject<ScrollBoxRenderable | null>
		readonly diffScrollRef: MutableRefObject<ScrollBoxRenderable | null>
		readonly issueListScrollRef: MutableRefObject<ScrollBoxRenderable | null>
	}
	readonly openInlineLink: (url: string) => void
	readonly diffFilePanel: DiffFilePanelBundle
}

export interface DiffFilePanelBundle {
	readonly visible: boolean
	readonly width: number
	readonly diffPaneWidth: number
	readonly files: readonly DiffFilePatch[]
	readonly currentFileIndex: number
	readonly pickerActive: boolean
	readonly pickerQuery: string
	readonly pickerSelectedIndex: number
	readonly pickerResults: readonly ChangedFileSearchResult[]
	readonly onSelectFile: (index: number) => void
}

export const WorkspaceContent = (props: WorkspaceContentProps) => {
	const { activeWorkspaceSurface, commentsViewActive, diffFullView, detailFullView, layout, derivations } = props
	if (activeWorkspaceSurface === "repos" && !commentsViewActive && !diffFullView && !detailFullView) {
		return (
			<RepoSurface
				showScrollbars={props.showScrollbars}
				isWideLayout={layout.isWideLayout}
				wideBodyHeight={layout.wideBodyHeight}
				contentWidth={layout.contentWidth}
				leftPaneWidth={layout.leftPaneWidth}
				rightPaneWidth={layout.rightPaneWidth}
				leftContentWidth={layout.leftContentWidth}
				fullscreenContentWidth={layout.fullscreenContentWidth}
				sectionPadding={layout.sectionPadding}
				narrowRepoListHeight={derivations.narrowRepoListHeight}
				narrowRepoDetailHeight={derivations.narrowRepoDetailHeight}
				repoListNeedsScroll={derivations.repoListNeedsScroll}
				narrowRepoListNeedsScroll={derivations.narrowRepoListNeedsScroll}
				repoListProps={derivations.repoListProps}
				selectedRepositoryItem={props.selectedRepositoryItem}
				selectedRepositoryDetails={props.selectedRepositoryDetails}
				detailPreviewScrollRef={props.scrollRefs.detailPreviewScrollRef}
			/>
		)
	}
	if (activeWorkspaceSurface === "issues" && !commentsViewActive && !diffFullView) {
		return (
			<IssueSurface
				showScrollbars={props.showScrollbars}
				isWideLayout={layout.isWideLayout}
				wideBodyHeight={layout.wideBodyHeight}
				contentWidth={layout.contentWidth}
				leftPaneWidth={layout.leftPaneWidth}
				rightPaneWidth={layout.rightPaneWidth}
				leftContentWidth={layout.leftContentWidth}
				fullscreenContentWidth={layout.fullscreenContentWidth}
				sectionPadding={layout.sectionPadding}
				narrowIssueListHeight={derivations.narrowIssueListHeight}
				narrowIssueDetailHeight={derivations.narrowIssueDetailHeight}
				issueListNeedsScroll={derivations.issueListNeedsScroll}
				narrowIssueListNeedsScroll={derivations.narrowIssueListNeedsScroll}
				activeFilterLabel={props.issueActiveFilterLabel}
				issueJunctions={derivations.issueJunctions}
				issueListProps={derivations.issueListProps}
				selectedIssue={props.selectedIssue}
				issueListScrollRef={props.scrollRefs.issueListScrollRef}
				detailScrollRef={props.scrollRefs.detailScrollRef}
				detailPreviewScrollRef={props.scrollRefs.detailPreviewScrollRef}
				detailFullView={detailFullView}
				onLinkOpen={props.openInlineLink}
			/>
		)
	}
	return (
		<PullRequestSurface
			showScrollbars={props.showScrollbars}
			isWideLayout={layout.isWideLayout}
			contentWidth={layout.contentWidth}
			leftPaneWidth={layout.leftPaneWidth}
			rightPaneWidth={layout.rightPaneWidth}
			leftContentWidth={layout.leftContentWidth}
			rightContentWidth={layout.rightContentWidth}
			fullscreenContentWidth={layout.fullscreenContentWidth}
			sectionPadding={layout.sectionPadding}
			wideBodyHeight={layout.wideBodyHeight}
			wideDetailHeaderHeight={derivations.wideDetailHeaderHeight}
			wideDetailBodyScrollable={derivations.wideDetailBodyScrollable}
			wideDetailLines={layout.wideDetailLines}
			fullscreenDetailHeaderHeight={derivations.fullscreenDetailHeaderHeight}
			fullscreenDetailBodyScrollable={derivations.fullscreenDetailBodyScrollable}
			fullscreenBodyLines={layout.fullscreenBodyLines}
			widePullRequestListHeight={derivations.widePullRequestListHeight}
			widePullRequestListNeedsScroll={derivations.widePullRequestListNeedsScroll}
			narrowPullRequestListHeight={derivations.narrowPullRequestListHeight}
			narrowPullRequestRowsHeight={derivations.narrowPullRequestRowsHeight}
			narrowPullRequestListNeedsScroll={derivations.narrowPullRequestListNeedsScroll}
			narrowDetailsPaneHeight={derivations.narrowDetailsPaneHeight}
			narrowPreviewBodyHeight={derivations.narrowPreviewBodyHeight}
			narrowPreviewBodyScrollable={derivations.narrowPreviewBodyScrollable}
			activeFilterLabel={props.pullRequestActiveFilterLabel}
			detailJunctions={derivations.detailJunctions}
			prListProps={derivations.prListProps}
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
			prListScrollRef={props.scrollRefs.prListScrollRef}
			detailScrollRef={props.scrollRefs.detailScrollRef}
			detailPreviewScrollRef={props.scrollRefs.detailPreviewScrollRef}
			diffScrollRef={props.scrollRefs.diffScrollRef}
			onLinkOpen={props.openInlineLink}
			diffFilePanel={props.diffFilePanel}
		/>
	)
}
