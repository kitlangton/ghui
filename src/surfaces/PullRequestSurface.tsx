import type { DiffRenderable, ScrollBoxRenderable } from "@opentui/core"
import type { ComponentProps, MutableRefObject } from "react"
import type { DiffCommentSide, IssueItem, PullRequestComment, PullRequestItem, PullRequestReviewComment } from "../domain.js"
import {
	stackedDiffFileIndexAtLine,
	type DiffView,
	type DiffWhitespaceMode,
	type DiffWrapMode,
	type PullRequestDiffState,
	type StackedDiffCommentAnchor,
	type StackedDiffFilePatch,
} from "../ui/diff.js"
import type { ThemeId } from "../ui/colors.js"
import { colors } from "../ui/colors.js"
import { ActiveFilterBar, ACTIVE_FILTER_BAR_HEIGHT } from "../ui/ActiveFilterBar.js"
import { CommentsPane, type OrderedComment } from "../ui/CommentsPane.js"
import { DETAIL_BODY_SCROLL_LIMIT, DetailBody, DetailHeader, DetailPlaceholder, DetailsPane, type DetailCommentsStatus, type DetailPlaceholderContent } from "../ui/DetailsPane.js"
import { DiffFilePanel, diffFilePanelDividerRows } from "../ui/diff/DiffFilePanel.js"
import { SplitPane } from "../ui/paneLayout.js"
import { Divider, Filler, PlainLine, SeparatorColumn } from "../ui/primitives.js"
import { PullRequestDiffPane } from "../ui/PullRequestDiffPane.js"
import { PullRequestList } from "../ui/PullRequestList.js"
import type { DiffFilePanelBundle } from "./WorkspaceContent.js"

export interface PullRequestSurfaceProps {
	readonly showScrollbars: boolean
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
		showScrollbars,
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
				showScrollbar={showScrollbars}
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
				showScrollbar={showScrollbars}
			/>
		)
		if (!panel.visible) return diffPane
		// The vertical rail's junctions come from three sources: the panel's
		// internal dividers (rows 1 and, in picker mode, 3), the diff pane's
		// chrome divider (row 1, below its header), and the dynamic file-
		// separator dividers inside the diff's scrollbox (which scroll with
		// the user's position). At each row we combine: `┼` for both sides,
		// `┤` panel-only, `├` diff-only.
		const panelRows = diffFilePanelDividerRows(panel.pickerActive)
		const diffChromeRows = [1] as const
		// Two chrome rows above the scrollbox: header + divider. Content line 0
		// of the scrollbox sits at viewport row 2.
		const diffChromeOffset = 2
		const scrollLine = Math.floor(diffScrollTop)
		const fileDividerRailRows: number[] = []
		for (const file of stackedDiffFiles) {
			// Separator above the file header (only for files after the first).
			if (file.index > 0) {
				const railRow = diffChromeOffset + (file.headerLine - 1) - scrollLine
				if (railRow >= diffChromeOffset && railRow < wideBodyHeight) fileDividerRailRows.push(railRow)
			}
			// Divider below the file header (always rendered, just before the diff body).
			const railRowBelow = diffChromeOffset + (file.headerLine + 1) - scrollLine
			if (railRowBelow >= diffChromeOffset && railRowBelow < wideBodyHeight) fileDividerRailRows.push(railRowBelow)
		}
		// The diff pane overlays a "sticky" file header at viewport rows 2-3
		// once any content has scrolled. The sticky always paints one divider
		// — at row 3 normally (header above), or at row 2 when the next file
		// is exactly one line below the scroll (divider above the incoming
		// header). Mirror that here so the rail joins it even after the
		// non-sticky divider for the current file has scrolled off-screen.
		const stickyRailRow =
			stackedDiffFiles.length > 0
				? (() => {
						const idx = stackedDiffFileIndexAtLine(stackedDiffFiles, scrollLine)
						const safe = idx >= 0 ? idx : 0
						const incoming = stackedDiffFiles[safe + 1]
						const incomingDistance = incoming ? incoming.headerLine - scrollLine : Number.POSITIVE_INFINITY
						return incomingDistance === 1 ? 2 : 3
					})()
				: null
		if (stickyRailRow !== null && stickyRailRow >= diffChromeOffset && stickyRailRow < wideBodyHeight) fileDividerRailRows.push(stickyRailRow)
		const rightSideRows = new Set<number>([...diffChromeRows, ...fileDividerRailRows])
		const allRailRows = new Set<number>([...panelRows, ...rightSideRows])
		const railJunctions = Array.from(allRailRows).map((row) => {
			const fromPanel = panelRows.includes(row)
			const fromRight = rightSideRows.has(row)
			return { row, char: fromPanel && fromRight ? "┼" : fromPanel ? "┤" : "├" }
		})
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
					onSelectFile={panel.onSelectFile}
				/>
				<SeparatorColumn height={wideBodyHeight} junctions={railJunctions} />
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
						<scrollbox ref={detailScrollRef} focusable={false} flexGrow={1} verticalScrollbarOptions={{ visible: showScrollbars && fullscreenDetailBodyScrollable }}>
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
							<scrollbox ref={prListScrollRef} focusable={false} height={widePullRequestListHeight} flexGrow={0} verticalScrollbarOptions={{ visible: showScrollbars }}>
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
							<scrollbox ref={detailPreviewScrollRef} flexGrow={1} verticalScrollbarOptions={{ visible: showScrollbars && wideDetailBodyScrollable }}>
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
						<scrollbox ref={detailScrollRef} focusable={false} flexGrow={1} verticalScrollbarOptions={{ visible: showScrollbars && fullscreenDetailBodyScrollable }}>
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
					<scrollbox ref={prListScrollRef} focusable={false} height={narrowPullRequestRowsHeight} flexGrow={0} verticalScrollbarOptions={{ visible: showScrollbars }}>
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
							verticalScrollbarOptions={{ visible: showScrollbars && narrowPreviewBodyScrollable }}
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
