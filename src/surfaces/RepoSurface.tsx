import type { ScrollBoxRenderable } from "@opentui/core"
import type { ComponentProps, MutableRefObject } from "react"
import type { RepositoryDetails } from "../domain.js"
import { DETAIL_BODY_SCROLL_LIMIT } from "../ui/DetailsPane.js"
import { SplitPane } from "../ui/paneLayout.js"
import { Divider } from "../ui/primitives.js"
import { getRepoDetailJunctionRows, RepoDetailPane, RepoList, type RepositoryListItem } from "../ui/RepoList.js"

export interface RepoSurfaceProps {
	readonly isWideLayout: boolean
	readonly wideBodyHeight: number
	readonly contentWidth: number
	readonly leftPaneWidth: number
	readonly rightPaneWidth: number
	readonly leftContentWidth: number
	readonly fullscreenContentWidth: number
	readonly sectionPadding: number
	readonly narrowRepoListHeight: number
	readonly narrowRepoDetailHeight: number
	readonly repoListNeedsScroll: boolean
	readonly narrowRepoListNeedsScroll: boolean
	readonly repoListProps: Omit<ComponentProps<typeof RepoList>, "contentWidth">
	readonly selectedRepositoryItem: RepositoryListItem | null
	readonly selectedRepositoryDetails: RepositoryDetails | null
	readonly detailPreviewScrollRef: MutableRefObject<ScrollBoxRenderable | null>
}

export const RepoSurface = ({
	isWideLayout,
	wideBodyHeight,
	contentWidth,
	leftPaneWidth,
	rightPaneWidth,
	leftContentWidth,
	fullscreenContentWidth,
	sectionPadding,
	narrowRepoListHeight,
	narrowRepoDetailHeight,
	repoListNeedsScroll,
	narrowRepoListNeedsScroll,
	repoListProps,
	selectedRepositoryItem,
	selectedRepositoryDetails,
	detailPreviewScrollRef,
}: RepoSurfaceProps) => {
	if (isWideLayout) {
		return (
			<SplitPane
				key="wide-repos"
				height={wideBodyHeight}
				leftWidth={leftPaneWidth}
				rightWidth={rightPaneWidth}
				junctionRows={getRepoDetailJunctionRows(selectedRepositoryItem, selectedRepositoryDetails)}
				left={
					repoListNeedsScroll ? (
						<scrollbox focusable={false} height={wideBodyHeight} flexGrow={0}>
							<box flexDirection="column" paddingLeft={sectionPadding}>
								<RepoList {...repoListProps} contentWidth={leftContentWidth} />
							</box>
						</scrollbox>
					) : (
						<box height={wideBodyHeight} flexDirection="column" paddingLeft={sectionPadding}>
							<RepoList {...repoListProps} contentWidth={leftContentWidth} />
						</box>
					)
				}
				right={<RepoDetailPane repository={selectedRepositoryItem} details={selectedRepositoryDetails} width={rightPaneWidth} height={wideBodyHeight} />}
			/>
		)
	}

	return (
		<box key="narrow-repos" height={wideBodyHeight} flexDirection="column">
			{narrowRepoListNeedsScroll ? (
				<scrollbox focusable={false} height={narrowRepoListHeight} flexGrow={0}>
					<box flexDirection="column" paddingLeft={sectionPadding} paddingRight={sectionPadding}>
						<RepoList {...repoListProps} contentWidth={fullscreenContentWidth} />
					</box>
				</scrollbox>
			) : (
				<box height={narrowRepoListHeight} flexDirection="column" paddingLeft={sectionPadding} paddingRight={sectionPadding}>
					<RepoList {...repoListProps} contentWidth={fullscreenContentWidth} />
				</box>
			)}
			<Divider width={contentWidth} />
			<RepoDetailPane
				repository={selectedRepositoryItem}
				details={selectedRepositoryDetails}
				width={contentWidth}
				height={narrowRepoDetailHeight}
				descriptionLineLimit={DETAIL_BODY_SCROLL_LIMIT}
				descriptionScrollRef={detailPreviewScrollRef}
			/>
		</box>
	)
}
