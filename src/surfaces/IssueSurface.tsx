import type { ScrollBoxRenderable } from "@opentui/core"
import type { ComponentProps, MutableRefObject } from "react"
import type { IssueItem } from "../domain.js"
import { ActiveFilterBar, ACTIVE_FILTER_BAR_HEIGHT } from "../ui/ActiveFilterBar.js"
import { DETAIL_BODY_SCROLL_LIMIT } from "../ui/DetailsPane.js"
import { getIssueDetailContentHeight, IssueDetailPane, IssueList } from "../ui/IssueList.js"
import { SplitPane } from "../ui/paneLayout.js"
import { Divider } from "../ui/primitives.js"

export interface IssueSurfaceProps {
	readonly isWideLayout: boolean
	readonly wideBodyHeight: number
	readonly contentWidth: number
	readonly leftPaneWidth: number
	readonly rightPaneWidth: number
	readonly leftContentWidth: number
	readonly fullscreenContentWidth: number
	readonly sectionPadding: number
	readonly narrowIssueListHeight: number
	readonly narrowIssueDetailHeight: number
	readonly issueListNeedsScroll: boolean
	readonly narrowIssueListNeedsScroll: boolean
	readonly activeFilterLabel: string | null
	readonly issueJunctions: readonly number[]
	readonly issueListProps: Omit<ComponentProps<typeof IssueList>, "contentWidth">
	readonly selectedIssue: IssueItem | null
	readonly issueListScrollRef: MutableRefObject<ScrollBoxRenderable | null>
	readonly detailPreviewScrollRef: MutableRefObject<ScrollBoxRenderable | null>
	readonly detailFullView: boolean
	readonly onLinkOpen?: (url: string) => void
}

export const IssueSurface = ({
	isWideLayout,
	wideBodyHeight,
	contentWidth,
	leftPaneWidth,
	rightPaneWidth,
	leftContentWidth,
	fullscreenContentWidth,
	sectionPadding,
	narrowIssueListHeight,
	narrowIssueDetailHeight,
	issueListNeedsScroll,
	narrowIssueListNeedsScroll,
	activeFilterLabel,
	issueJunctions,
	issueListProps,
	selectedIssue,
	issueListScrollRef,
	detailPreviewScrollRef,
	detailFullView,
	onLinkOpen,
}: IssueSurfaceProps) => {
	if (detailFullView) {
		return <IssueDetailPane issue={selectedIssue} width={contentWidth} height={wideBodyHeight} {...(onLinkOpen ? { onLinkOpen } : {})} />
	}
	const wideDetailNeedsScroll = selectedIssue !== null && getIssueDetailContentHeight(selectedIssue, rightPaneWidth, wideBodyHeight, DETAIL_BODY_SCROLL_LIMIT) > wideBodyHeight
	const narrowDetailNeedsScroll =
		selectedIssue !== null && getIssueDetailContentHeight(selectedIssue, contentWidth, narrowIssueDetailHeight, DETAIL_BODY_SCROLL_LIMIT) > narrowIssueDetailHeight
	const filterBarHeight = activeFilterLabel ? ACTIVE_FILTER_BAR_HEIGHT : 0
	const wideIssueRowsHeight = Math.max(1, wideBodyHeight - filterBarHeight)
	const narrowIssueRowsHeight = Math.max(1, narrowIssueListHeight - filterBarHeight)
	const wideFilterBar = activeFilterLabel ? (
		<box height={ACTIVE_FILTER_BAR_HEIGHT} flexDirection="column">
			<box paddingLeft={sectionPadding}>
				<ActiveFilterBar label={activeFilterLabel} width={leftContentWidth} />
			</box>
			<Divider width={leftPaneWidth} />
		</box>
	) : null
	const narrowFilterBar = activeFilterLabel ? (
		<box height={ACTIVE_FILTER_BAR_HEIGHT} flexDirection="column">
			<box paddingLeft={sectionPadding} paddingRight={sectionPadding}>
				<ActiveFilterBar label={activeFilterLabel} width={fullscreenContentWidth} />
			</box>
			<Divider width={contentWidth} />
		</box>
	) : null
	if (isWideLayout) {
		return (
			<SplitPane
				key="wide-issues"
				height={wideBodyHeight}
				leftWidth={leftPaneWidth}
				rightWidth={rightPaneWidth}
				junctionRows={issueJunctions}
				junctions={activeFilterLabel ? [{ row: 1, char: "┤" }] : []}
				left={
					<box height={wideBodyHeight} flexDirection="column">
						{wideFilterBar}
						{issueListNeedsScroll ? (
							<scrollbox ref={issueListScrollRef} focusable={false} height={wideIssueRowsHeight} flexGrow={0}>
								<box flexDirection="column" paddingLeft={sectionPadding}>
									<IssueList {...issueListProps} contentWidth={leftContentWidth} />
								</box>
							</scrollbox>
						) : (
							<box height={wideIssueRowsHeight} flexDirection="column" paddingLeft={sectionPadding}>
								<IssueList {...issueListProps} contentWidth={leftContentWidth} />
							</box>
						)}
					</box>
				}
				right={
					<scrollbox ref={detailPreviewScrollRef} focusable={false} height={wideBodyHeight} flexGrow={0} verticalScrollbarOptions={{ visible: wideDetailNeedsScroll }}>
						<IssueDetailPane
							issue={selectedIssue}
							width={rightPaneWidth}
							height={wideBodyHeight}
							bodyLineLimit={DETAIL_BODY_SCROLL_LIMIT}
							{...(onLinkOpen ? { onLinkOpen } : {})}
						/>
					</scrollbox>
				}
			/>
		)
	}

	return (
		<box key="narrow-issues" height={wideBodyHeight} flexDirection="column">
			<box height={narrowIssueListHeight} flexDirection="column">
				{narrowFilterBar}
				{narrowIssueListNeedsScroll ? (
					<scrollbox ref={issueListScrollRef} focusable={false} height={narrowIssueRowsHeight} flexGrow={0}>
						<box flexDirection="column" paddingLeft={sectionPadding} paddingRight={sectionPadding}>
							<IssueList {...issueListProps} contentWidth={fullscreenContentWidth} />
						</box>
					</scrollbox>
				) : (
					<box height={narrowIssueRowsHeight} flexDirection="column" paddingLeft={sectionPadding} paddingRight={sectionPadding}>
						<IssueList {...issueListProps} contentWidth={fullscreenContentWidth} />
					</box>
				)}
			</box>
			<Divider width={contentWidth} />
			<scrollbox ref={detailPreviewScrollRef} focusable={false} height={narrowIssueDetailHeight} flexGrow={0} verticalScrollbarOptions={{ visible: narrowDetailNeedsScroll }}>
				<IssueDetailPane
					issue={selectedIssue}
					width={contentWidth}
					height={narrowIssueDetailHeight}
					bodyLineLimit={DETAIL_BODY_SCROLL_LIMIT}
					{...(onLinkOpen ? { onLinkOpen } : {})}
				/>
			</scrollbox>
		</box>
	)
}
