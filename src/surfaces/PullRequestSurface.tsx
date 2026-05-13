import type { DiffRenderable, ScrollBoxRenderable } from "@opentui/core"
import type { ComponentProps, MutableRefObject } from "react"
import type { DiffCommentSide, IssueItem, PullRequestComment, PullRequestItem, PullRequestReviewComment } from "../domain.js"
import type { DiffView, DiffWhitespaceMode, DiffWrapMode, PullRequestDiffState, StackedDiffCommentAnchor, StackedDiffFilePatch } from "../ui/diff.js"
import type { ThemeId } from "../ui/colors.js"
import { colors } from "../ui/colors.js"
import { ActiveFilterBar, ACTIVE_FILTER_BAR_HEIGHT } from "../ui/ActiveFilterBar.js"
import { CommentsPane, type OrderedComment } from "../ui/CommentsPane.js"
import { DETAIL_BODY_SCROLL_LIMIT, DetailBody, DetailHeader, DetailPlaceholder, DetailsPane, type DetailCommentsStatus, type DetailPlaceholderContent } from "../ui/DetailsPane.js"
import { DiffFilePanel } from "../ui/diff/DiffFilePanel.js"
import { SplitPane } from "../ui/paneLayout.js"
import { Divider, Filler, PlainLine } from "../ui/primitives.js"
import { PullRequestDiffPane } from "../ui/PullRequestDiffPane.js"
import { PullRequestList } from "../ui/PullRequestList.js"
import type { DiffFilePanelBundle } from "./WorkspaceContent.js"

export interface PullRequestSurfaceProps {
	readonly isWideLayout: boolean
	readonly contentWidth: number
	readonly leftPaneWidth: number
	readonly rightPaneWidth: number
	readonly leftContentWidth: number
	readonly rightContentWidth: number
	readonly fullscreenContentWidth: number
	readonly sectionPadding: number
	readonly wideBodyHeight: number
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
	readonly activeFilterLabel: string | null
	readonly detailJunctions: readonly number[]
	readonly prListProps: Omit<ComponentProps<typeof PullRequestList>, "contentWidth">
	readonly selectedPullRequest: PullRequestItem | null
	readonly selectedComments: readonly PullRequestComment[]
	readonly selectedCommentsStatus: DetailCommentsStatus
	readonly detailPlaceholderContent: DetailPlaceholderContent
	readonly isSelectedPullRequestDetailLoading: boolean
	readonly isSelectedPullRequestDetailError: boolean
	readonly selectedPullRequestDetailError: string | null
	readonly commentsViewActive: boolean
	readonly commentsViewSelection: number
	readonly orderedComments: readonly OrderedComment[]
	readonly commentSubject: IssueItem | PullRequestItem | null
	readonly diffFullView: boolean
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
	readonly detailFullView: boolean
	readonly loadingIndicator: string
	readonly themeId: ThemeId
	readonly systemThemeGeneration: number
	readonly prListScrollRef: MutableRefObject<ScrollBoxRenderable | null>
	readonly detailScrollRef: MutableRefObject<ScrollBoxRenderable | null>
	readonly detailPreviewScrollRef: MutableRefObject<ScrollBoxRenderable | null>
	readonly diffScrollRef: MutableRefObject<ScrollBoxRenderable | null>
	readonly onLinkOpen?: (url: string) => void
	readonly diffFilePanel: DiffFilePanelBundle
}

export const PullRequestSurface = (props: PullRequestSurfaceProps) => {
	const {
		isWideLayout,
		contentWidth,
		leftPaneWidth,
		rightPaneWidth,
		leftContentWidth,
		rightContentWidth,
		fullscreenContentWidth,
		sectionPadding,
		wideBodyHeight,
		wideDetailHeaderHeight,
		wideDetailBodyScrollable,
		wideDetailLines,
		fullscreenDetailHeaderHeight,
		fullscreenDetailBodyScrollable,
		fullscreenBodyLines,
		widePullRequestListHeight,
		widePullRequestListNeedsScroll,
		narrowPullRequestListHeight,
		narrowPullRequestRowsHeight,
		narrowPullRequestListNeedsScroll,
		narrowDetailsPaneHeight,
		narrowPreviewBodyHeight,
		narrowPreviewBodyScrollable,
		activeFilterLabel,
		detailJunctions,
		prListProps,
		selectedPullRequest,
		selectedComments,
		selectedCommentsStatus,
		detailPlaceholderContent,
		isSelectedPullRequestDetailLoading,
		isSelectedPullRequestDetailError,
		selectedPullRequestDetailError,
		commentsViewActive,
		commentsViewSelection,
		orderedComments,
		commentSubject,
		diffFullView,
		displayedDiffState,
		stackedDiffFiles,
		diffScrollTop,
		effectiveDiffRenderView,
		diffWhitespaceMode,
		diffWrapMode,
		selectedDiffCommentAnchor,
		selectedDiffCommentLabel,
		selectedDiffCommentThread,
		selectDiffCommentLine,
		setDiffRenderableRef,
		detailFullView,
		loadingIndicator,
		themeId,
		systemThemeGeneration,
		prListScrollRef,
		detailScrollRef,
		detailPreviewScrollRef,
		diffScrollRef,
		onLinkOpen,
	} = props

	if (commentsViewActive && commentSubject) {
		return (
			<CommentsPane
				item={commentSubject}
				comments={selectedComments}
				orderedComments={orderedComments}
				status={selectedCommentsStatus}
				selectedIndex={commentsViewSelection}
				contentWidth={fullscreenContentWidth}
				paneWidth={contentWidth}
				height={wideBodyHeight}
				loadingIndicator={loadingIndicator}
				themeGeneration={systemThemeGeneration}
			/>
		)
	}

	if (diffFullView) {
		const panel = props.diffFilePanel
		const diffPaneWidth = panel.visible ? panel.diffPaneWidth : contentWidth
		const diffPane = (
			<PullRequestDiffPane
				pullRequest={selectedPullRequest}
				diffState={displayedDiffState}
				stackedFiles={stackedDiffFiles}
				scrollTop={diffScrollTop}
				view={effectiveDiffRenderView}
				whitespaceMode={diffWhitespaceMode}
				wrapMode={diffWrapMode}
				paneWidth={diffPaneWidth}
				height={wideBodyHeight}
				loadingIndicator={loadingIndicator}
				scrollRef={diffScrollRef}
				setDiffRef={setDiffRenderableRef}
				selectedCommentAnchor={selectedDiffCommentAnchor}
				selectedCommentLabel={selectedDiffCommentLabel}
				selectedCommentThread={selectedDiffCommentThread}
				onSelectCommentLine={selectDiffCommentLine}
				themeId={themeId}
				themeGeneration={systemThemeGeneration}
			/>
		)
		if (!panel.visible) return diffPane
		return (
			<box flexDirection="row" height={wideBodyHeight} width={contentWidth}>
				<DiffFilePanel
					files={panel.files}
					currentFileIndex={panel.currentFileIndex}
					width={panel.width}
					height={wideBodyHeight}
					pickerActive={panel.pickerActive}
					pickerQuery={panel.pickerQuery}
					pickerSelectedIndex={panel.pickerSelectedIndex}
					pickerResults={panel.pickerResults}
				/>
				<box width={1} height={wideBodyHeight} flexDirection="column">
					{Array.from({ length: wideBodyHeight }, (_, index) => (
						<PlainLine key={`diff-file-panel-sep-${index}`} text="│" fg={colors.separator} />
					))}
				</box>
				{diffPane}
			</box>
		)
	}

	if (detailFullView && isSelectedPullRequestDetailError && selectedPullRequest) {
		return (
			<box flexGrow={1} flexDirection="column">
				<DetailHeader
					pullRequest={selectedPullRequest}
					contentWidth={fullscreenContentWidth}
					paneWidth={contentWidth}
					showChecks={false}
					comments={selectedComments}
					commentsStatus={selectedCommentsStatus}
				/>
				<PlainLine text="- Could not load pull request details." fg={colors.error} />
				<PlainLine text={`- ${selectedPullRequestDetailError ?? ""}`} fg={colors.muted} />
				<Filler rows={Math.max(0, wideBodyHeight - fullscreenDetailHeaderHeight - 2)} prefix="detail-error-full" />
			</box>
		)
	}

	if (detailFullView && isSelectedPullRequestDetailLoading && selectedPullRequest) {
		return (
			<box flexGrow={1} flexDirection="column">
				<DetailHeader
					pullRequest={selectedPullRequest}
					contentWidth={fullscreenContentWidth}
					paneWidth={contentWidth}
					showChecks={isWideLayout}
					comments={selectedComments}
					commentsStatus={selectedCommentsStatus}
				/>
				<Filler rows={Math.max(1, wideBodyHeight - fullscreenDetailHeaderHeight)} prefix="detail-loading-full" />
			</box>
		)
	}

	if (isWideLayout && detailFullView) {
		return (
			<box flexGrow={1} flexDirection="column">
				{selectedPullRequest ? (
					<>
						<DetailHeader
							pullRequest={selectedPullRequest}
							contentWidth={fullscreenContentWidth}
							paneWidth={contentWidth}
							showChecks
							comments={selectedComments}
							commentsStatus={selectedCommentsStatus}
						/>
						<scrollbox ref={detailScrollRef} focusable={false} flexGrow={1} verticalScrollbarOptions={{ visible: fullscreenDetailBodyScrollable }}>
							<DetailBody
								pullRequest={selectedPullRequest}
								contentWidth={fullscreenContentWidth}
								bodyLines={fullscreenBodyLines}
								bodyLineLimit={DETAIL_BODY_SCROLL_LIMIT}
								loadingIndicator={loadingIndicator}
								themeId={themeId}
								themeGeneration={systemThemeGeneration}
								{...(onLinkOpen ? { onLinkOpen } : {})}
							/>
						</scrollbox>
					</>
				) : (
					<DetailsPane
						pullRequest={null}
						contentWidth={fullscreenContentWidth}
						paneWidth={contentWidth}
						placeholderContent={detailPlaceholderContent}
						loadingIndicator={loadingIndicator}
						themeId={themeId}
						themeGeneration={systemThemeGeneration}
						{...(onLinkOpen ? { onLinkOpen } : {})}
					/>
				)}
			</box>
		)
	}

	const widePullRequestFilterBar = activeFilterLabel ? (
		<box height={ACTIVE_FILTER_BAR_HEIGHT} flexDirection="column">
			<box paddingLeft={sectionPadding}>
				<ActiveFilterBar label={activeFilterLabel} width={leftContentWidth} />
			</box>
			<Divider width={leftPaneWidth} />
		</box>
	) : null
	const narrowPullRequestFilterBar = activeFilterLabel ? (
		<box height={ACTIVE_FILTER_BAR_HEIGHT} flexDirection="column">
			<box paddingLeft={sectionPadding} paddingRight={sectionPadding}>
				<ActiveFilterBar label={activeFilterLabel} width={fullscreenContentWidth} />
			</box>
			<Divider width={contentWidth} />
		</box>
	) : null
	const widePullRequestList = (
		<box paddingLeft={sectionPadding} paddingRight={0}>
			<PullRequestList key={`wide-${leftContentWidth}`} {...prListProps} contentWidth={leftContentWidth} />
		</box>
	)
	const narrowPullRequestList = (
		<box paddingLeft={sectionPadding} paddingRight={sectionPadding}>
			<PullRequestList key={`narrow-${fullscreenContentWidth}`} {...prListProps} contentWidth={fullscreenContentWidth} />
		</box>
	)

	if (isWideLayout) {
		return (
			<SplitPane
				height={wideBodyHeight}
				leftWidth={leftPaneWidth}
				rightWidth={rightPaneWidth}
				junctionRows={detailJunctions}
				left={
					<box height={wideBodyHeight} flexDirection="column">
						{widePullRequestFilterBar}
						{widePullRequestListNeedsScroll ? (
							<scrollbox ref={prListScrollRef} focusable={false} height={widePullRequestListHeight} flexGrow={0}>
								{widePullRequestList}
							</scrollbox>
						) : (
							<box height={widePullRequestListHeight} flexDirection="column">
								{widePullRequestList}
							</box>
						)}
					</box>
				}
				right={
					isSelectedPullRequestDetailError && selectedPullRequest ? (
						<>
							<DetailHeader
								pullRequest={selectedPullRequest}
								contentWidth={rightContentWidth}
								paneWidth={rightPaneWidth}
								showChecks={false}
								comments={selectedComments}
								commentsStatus={selectedCommentsStatus}
							/>
							<PlainLine text="- Could not load pull request details." fg={colors.error} />
							<PlainLine text={`- ${selectedPullRequestDetailError ?? ""}`} fg={colors.muted} />
							<Filler rows={Math.max(0, wideBodyHeight - wideDetailHeaderHeight - 2)} prefix="detail-error-preview" />
						</>
					) : isSelectedPullRequestDetailLoading && selectedPullRequest ? (
						<>
							<DetailHeader
								pullRequest={selectedPullRequest}
								contentWidth={rightContentWidth}
								paneWidth={rightPaneWidth}
								showChecks
								comments={selectedComments}
								commentsStatus={selectedCommentsStatus}
							/>
							<Filler rows={Math.max(1, wideBodyHeight - wideDetailHeaderHeight)} prefix="detail-loading-preview" />
						</>
					) : selectedPullRequest ? (
						<>
							<DetailHeader
								pullRequest={selectedPullRequest}
								contentWidth={rightContentWidth}
								paneWidth={rightPaneWidth}
								showChecks
								comments={selectedComments}
								commentsStatus={selectedCommentsStatus}
							/>
							<scrollbox ref={detailPreviewScrollRef} flexGrow={1} verticalScrollbarOptions={{ visible: wideDetailBodyScrollable }}>
								<DetailBody
									pullRequest={selectedPullRequest}
									contentWidth={rightContentWidth}
									bodyLines={wideDetailLines}
									bodyLineLimit={DETAIL_BODY_SCROLL_LIMIT}
									loadingIndicator={loadingIndicator}
									themeId={themeId}
									themeGeneration={systemThemeGeneration}
									{...(onLinkOpen ? { onLinkOpen } : {})}
								/>
							</scrollbox>
						</>
					) : (
						<DetailPlaceholder content={detailPlaceholderContent} paneWidth={rightPaneWidth} />
					)
				}
			/>
		)
	}

	if (detailFullView) {
		return (
			<box flexGrow={1} flexDirection="column">
				{isSelectedPullRequestDetailError && selectedPullRequest ? (
					<>
						<DetailHeader
							pullRequest={selectedPullRequest}
							contentWidth={fullscreenContentWidth}
							paneWidth={contentWidth}
							showChecks={false}
							comments={selectedComments}
							commentsStatus={selectedCommentsStatus}
						/>
						<PlainLine text="- Could not load pull request details." fg={colors.error} />
						<PlainLine text={`- ${selectedPullRequestDetailError ?? ""}`} fg={colors.muted} />
						<Filler rows={Math.max(0, wideBodyHeight - fullscreenDetailHeaderHeight - 2)} prefix="detail-error-full-narrow" />
					</>
				) : selectedPullRequest ? (
					<>
						<DetailHeader
							pullRequest={selectedPullRequest}
							contentWidth={fullscreenContentWidth}
							paneWidth={contentWidth}
							comments={selectedComments}
							commentsStatus={selectedCommentsStatus}
						/>
						<scrollbox ref={detailScrollRef} focusable={false} flexGrow={1} verticalScrollbarOptions={{ visible: fullscreenDetailBodyScrollable }}>
							<DetailBody
								pullRequest={selectedPullRequest}
								contentWidth={fullscreenContentWidth}
								bodyLines={fullscreenBodyLines}
								bodyLineLimit={DETAIL_BODY_SCROLL_LIMIT}
								loadingIndicator={loadingIndicator}
								themeId={themeId}
								themeGeneration={systemThemeGeneration}
								{...(onLinkOpen ? { onLinkOpen } : {})}
							/>
						</scrollbox>
					</>
				) : (
					<DetailsPane
						pullRequest={null}
						contentWidth={fullscreenContentWidth}
						paneWidth={contentWidth}
						placeholderContent={detailPlaceholderContent}
						loadingIndicator={loadingIndicator}
						themeId={themeId}
						themeGeneration={systemThemeGeneration}
						{...(onLinkOpen ? { onLinkOpen } : {})}
					/>
				)}
			</box>
		)
	}

	return (
		<box key="narrow-main" height={wideBodyHeight} flexDirection="column">
			<box height={narrowPullRequestListHeight} flexDirection="column">
				{narrowPullRequestFilterBar}
				{narrowPullRequestListNeedsScroll ? (
					<scrollbox ref={prListScrollRef} focusable={false} height={narrowPullRequestRowsHeight} flexGrow={0}>
						{narrowPullRequestList}
					</scrollbox>
				) : (
					<box height={narrowPullRequestRowsHeight} flexDirection="column">
						{narrowPullRequestList}
					</box>
				)}
			</box>
			<Divider width={contentWidth} />
			<box height={narrowDetailsPaneHeight} flexDirection="column">
				{isSelectedPullRequestDetailError && selectedPullRequest ? (
					<box flexDirection="column">
						<DetailHeader
							pullRequest={selectedPullRequest}
							contentWidth={fullscreenContentWidth}
							paneWidth={contentWidth}
							showChecks={false}
							comments={selectedComments}
							commentsStatus={selectedCommentsStatus}
						/>
						<PlainLine text="- Could not load pull request details." fg={colors.error} />
						<PlainLine text={`- ${selectedPullRequestDetailError ?? ""}`} fg={colors.muted} />
					</box>
				) : selectedPullRequest ? (
					<>
						<DetailHeader
							pullRequest={selectedPullRequest}
							contentWidth={fullscreenContentWidth}
							paneWidth={contentWidth}
							comments={selectedComments}
							commentsStatus={selectedCommentsStatus}
						/>
						<scrollbox
							ref={detailPreviewScrollRef}
							focusable={false}
							height={narrowPreviewBodyHeight}
							flexGrow={0}
							verticalScrollbarOptions={{ visible: narrowPreviewBodyScrollable }}
						>
							<DetailBody
								pullRequest={selectedPullRequest}
								contentWidth={fullscreenContentWidth}
								bodyLines={narrowPreviewBodyHeight}
								bodyLineLimit={DETAIL_BODY_SCROLL_LIMIT}
								loadingIndicator={loadingIndicator}
								themeId={themeId}
								themeGeneration={systemThemeGeneration}
								{...(onLinkOpen ? { onLinkOpen } : {})}
							/>
						</scrollbox>
					</>
				) : (
					<DetailsPane
						pullRequest={null}
						contentWidth={fullscreenContentWidth}
						paneWidth={contentWidth}
						placeholderContent={detailPlaceholderContent}
						loadingIndicator={loadingIndicator}
						themeId={themeId}
						themeGeneration={systemThemeGeneration}
						{...(onLinkOpen ? { onLinkOpen } : {})}
					/>
				)}
			</box>
		</box>
	)
}
