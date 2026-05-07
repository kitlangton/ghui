import { TextAttributes } from "@opentui/core"
import { useState } from "react"
import type { LoadStatus, PullRequestItem, PullRequestStateFilter } from "../domain.js"
import { daysOpen } from "../date.js"
import { colors, rowHoverBackground } from "./colors.js"
import { fitCell, MatchedCell, PlainLine, SectionTitle, TextLine } from "./primitives.js"
import { pullRequestRowDisplay, repoColor, reviewIcon } from "./pullRequests.js"

export type PullRequestGroups = Array<[string, PullRequestItem[]]>

export type PullRequestListRow =
	| { readonly _tag: "title" }
	| { readonly _tag: "filter" }
	| { readonly _tag: "message"; readonly text: string; readonly color: string }
	| { readonly _tag: "group"; readonly repository: string; readonly pullRequests: readonly PullRequestItem[] }
	| { readonly _tag: "pull-request"; readonly pullRequest: PullRequestItem; readonly numberWidth: number; readonly ageWidth: number }
	| { readonly _tag: "load-more"; readonly text: string }

const GROUP_ICON = "◆"

const getRowLayout = (contentWidth: number, numberWidth: number, ageWidth: number) => {
	const reviewWidth = 1
	const checkWidth = 6
	const fixedWidth = reviewWidth + 1 + numberWidth + 1 + checkWidth + ageWidth
	const titleWidth = Math.max(8, contentWidth - fixedWidth)
	return { reviewWidth, checkWidth, ageWidth, numberWidth, titleWidth }
}

const groupNumberWidth = (pullRequests: readonly PullRequestItem[]) => {
	if (pullRequests.length === 0) return 4
	const maxLen = Math.max(...pullRequests.map((pr) => String(pr.number).length))
	return maxLen + 1
}

const groupAgeWidth = (pullRequests: readonly PullRequestItem[]) => {
	if (pullRequests.length === 0) return 4
	const maxLen = Math.max(...pullRequests.map((pr) => `${daysOpen(pr.createdAt)}d`.length))
	return Math.max(4, maxLen + 1)
}

const GroupTitle = ({ label, color, filterText }: { label: string; color: string; filterText: string }) => (
	<TextLine>
		<span fg={color}>{GROUP_ICON} </span>
		<span fg={color} attributes={TextAttributes.BOLD}>
			<MatchedCell text={label} width={label.length} query={filterText} />
		</span>
	</TextLine>
)

export const buildPullRequestListRows = ({
	groups,
	status,
	error,
	filterText,
	showFilterBar,
	stateFilter,
	loadedCount,
	hasMore,
	isLoadingMore,
	loadingIndicator = "-",
}: {
	readonly groups: PullRequestGroups
	readonly status: LoadStatus
	readonly error: string | null
	readonly filterText: string
	readonly showFilterBar: boolean
	readonly stateFilter: PullRequestStateFilter
	readonly loadedCount: number
	readonly hasMore: boolean
	readonly isLoadingMore: boolean
	readonly loadingIndicator?: string
}): readonly PullRequestListRow[] => {
	const itemCount = groups.reduce((count, [, pullRequests]) => count + pullRequests.length, 0)
	const rows: PullRequestListRow[] = [{ _tag: "title" }]
	if (showFilterBar) rows.push({ _tag: "filter" })
	if (status === "loading" && itemCount === 0) rows.push({ _tag: "message", text: "- Loading pull requests...", color: colors.muted })
	if (status === "error") rows.push({ _tag: "message", text: `- ${error ?? "Could not load pull requests."}`, color: colors.error })
	if (status === "ready" && itemCount === 0)
		rows.push({ _tag: "message", text: filterText.length > 0 ? "- No matching pull requests." : `- No ${stateFilter} pull requests.`, color: colors.muted })
	for (const [repository, pullRequests] of groups) {
		rows.push({ _tag: "group", repository, pullRequests })
		const numberWidth = groupNumberWidth(pullRequests)
		const ageWidth = groupAgeWidth(pullRequests)
		for (const pullRequest of pullRequests) rows.push({ _tag: "pull-request", pullRequest, numberWidth, ageWidth })
	}
	if (status === "ready" && itemCount > 0 && (hasMore || isLoadingMore)) {
		rows.push({ _tag: "load-more", text: isLoadingMore ? `${loadingIndicator} Loading more pull requests... (${loadedCount} loaded)` : `- ${loadedCount} loaded, more available` })
	}
	return rows
}

export const pullRequestListRowIndex = (rows: readonly PullRequestListRow[], url: string | null) => {
	if (!url) return null
	const index = rows.findIndex((row) => row._tag === "pull-request" && row.pullRequest.url === url)
	return index >= 0 ? index : null
}

const PullRequestRow = ({
	pullRequest,
	selected,
	hovered,
	contentWidth,
	numWidth,
	ageColWidth,
	filterText,
	onSelect,
	onHoverChange,
}: {
	pullRequest: PullRequestItem
	selected: boolean
	hovered: boolean
	contentWidth: number
	numWidth: number
	ageColWidth: number
	filterText: string
	onSelect: () => void
	onHoverChange: (hovered: boolean) => void
}) => {
	const ageText = `${daysOpen(pullRequest.createdAt)}d`
	const { reviewWidth, checkWidth, ageWidth, numberWidth, titleWidth } = getRowLayout(contentWidth, numWidth, ageColWidth)
	const rowWidth = reviewWidth + 1 + numberWidth + 1 + titleWidth + checkWidth + ageWidth
	const fillerWidth = Math.max(0, contentWidth - rowWidth)
	const display = pullRequestRowDisplay(pullRequest, selected)
	const rowBg = selected ? colors.selectedBg : hovered ? rowHoverBackground() : undefined

	return (
		<TextLine width={contentWidth} fg={display.rowFg} bg={rowBg} onMouseDown={onSelect} onMouseOver={() => onHoverChange(true)} onMouseOut={() => onHoverChange(false)}>
			<span fg={display.indicatorFg}>{fitCell(reviewIcon(pullRequest), reviewWidth)}</span>
			<span> </span>
			<span fg={display.numberFg}>
				<MatchedCell text={`#${pullRequest.number}`} width={numberWidth} query={filterText} align="right" />
			</span>
			<span> </span>
			<span>
				<MatchedCell text={pullRequest.title} width={titleWidth} query={filterText} />
			</span>
			<span fg={display.checkFg}>{fitCell(display.checkText, checkWidth, "right")}</span>
			<span fg={colors.muted}>{fitCell(ageText, ageWidth, "right")}</span>
			{fillerWidth > 0 ? <span>{" ".repeat(fillerWidth)}</span> : null}
		</TextLine>
	)
}

export const PullRequestList = ({
	groups,
	selectedUrl,
	status,
	error,
	contentWidth,
	filterText,
	showFilterBar,
	isFilterEditing,
	stateFilter,
	loadedCount,
	hasMore,
	isLoadingMore,
	loadingIndicator,
	onSelectPullRequest,
}: {
	groups: PullRequestGroups
	selectedUrl: string | null
	status: LoadStatus
	error: string | null
	contentWidth: number
	filterText: string
	showFilterBar: boolean
	isFilterEditing: boolean
	stateFilter: PullRequestStateFilter
	loadedCount: number
	hasMore: boolean
	isLoadingMore: boolean
	loadingIndicator: string
	onSelectPullRequest: (url: string) => void
}) => {
	const rows = buildPullRequestListRows({ groups, status, error, filterText, showFilterBar, stateFilter, loadedCount, hasMore, isLoadingMore, loadingIndicator })
	const [hoveredUrl, setHoveredUrl] = useState<string | null>(null)

	return (
		<box width={contentWidth} flexDirection="column">
			{rows.map((row, index) => {
				if (row._tag === "title") return <SectionTitle key="title" title="PULL REQUESTS" />
				if (row._tag === "filter") {
					return (
						<TextLine key="filter">
							<span fg={colors.count}>/</span>
							<span fg={colors.muted}> </span>
							<span fg={isFilterEditing ? colors.text : colors.count}>{filterText.length > 0 ? filterText : "type to filter..."}</span>
						</TextLine>
					)
				}
				if (row._tag === "message") return <PlainLine key={`message-${index}`} text={row.text} fg={row.color} />
				if (row._tag === "load-more") return <PlainLine key="load-more" text={row.text} fg={colors.muted} />
				if (row._tag === "group") return <GroupTitle key={`group-${row.repository}`} label={row.repository} color={repoColor(row.repository)} filterText={filterText} />

				const pullRequestUrl = row.pullRequest.url
				return (
					<PullRequestRow
						key={pullRequestUrl}
						pullRequest={row.pullRequest}
						selected={pullRequestUrl === selectedUrl}
						hovered={pullRequestUrl === hoveredUrl}
						contentWidth={contentWidth}
						numWidth={row.numberWidth}
						ageColWidth={row.ageWidth}
						filterText={filterText}
						onSelect={() => onSelectPullRequest(pullRequestUrl)}
						onHoverChange={(hovered) =>
							setHoveredUrl((current) => (hovered ? (current === pullRequestUrl ? current : pullRequestUrl) : current === pullRequestUrl ? null : current))
						}
					/>
				)
			})}
		</box>
	)
}
