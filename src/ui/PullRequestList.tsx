import { TextAttributes } from "@opentui/core"
import type { LoadStatus, PullRequestItem } from "../domain.js"
import { daysOpen } from "../date.js"
import { colors } from "./colors.js"
import { fitCell, PlainLine, SectionTitle, TextLine } from "./primitives.js"
import { pullRequestRowDisplay, repoColor, reviewIcon } from "./pullRequests.js"

export type PullRequestGroups = Array<[string, PullRequestItem[]]>

export type PullRequestListRow =
	| { readonly _tag: "title" }
	| { readonly _tag: "filter" }
	| { readonly _tag: "message"; readonly text: string; readonly color: string }
	| { readonly _tag: "group"; readonly repository: string; readonly pullRequests: readonly PullRequestItem[] }
	| { readonly _tag: "pull-request"; readonly pullRequest: PullRequestItem; readonly groupPullRequests: readonly PullRequestItem[] }
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

const MatchedCell = ({ text, width, query, align = "left" }: { text: string; width: number; query: string; align?: "left" | "right" }) => {
	const fitted = fitCell(text, width, align)
	const needle = query.trim().toLowerCase()
	const index = needle.length > 0 ? fitted.toLowerCase().indexOf(needle) : -1
	if (index < 0) return <span>{fitted}</span>

	const end = Math.min(fitted.length, index + needle.length)
	return (
		<>
			{index > 0 ? <span>{fitted.slice(0, index)}</span> : null}
			<span fg={colors.accent} attributes={TextAttributes.BOLD}>{fitted.slice(index, end)}</span>
			{end < fitted.length ? <span>{fitted.slice(end)}</span> : null}
		</>
	)
}

const GroupTitle = ({ label, color, filterText }: { label: string; color: string; filterText: string }) => (
	<TextLine>
		<span fg={color}>{GROUP_ICON} </span>
		<span fg={color} attributes={TextAttributes.BOLD}><MatchedCell text={label} width={label.length} query={filterText} /></span>
	</TextLine>
)

export const buildPullRequestListRows = ({
	groups,
	status,
	error,
	filterText,
	showFilterBar,
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
	if (status === "ready" && itemCount === 0) rows.push({ _tag: "message", text: filterText.length > 0 ? "- No matching pull requests." : "- No open pull requests.", color: colors.muted })
	for (const [repository, pullRequests] of groups) {
		rows.push({ _tag: "group", repository, pullRequests })
		for (const pullRequest of pullRequests) rows.push({ _tag: "pull-request", pullRequest, groupPullRequests: pullRequests })
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
	contentWidth,
	numWidth,
	ageColWidth,
	filterText,
	onSelect,
}: {
	pullRequest: PullRequestItem
	selected: boolean
	contentWidth: number
	numWidth: number
	ageColWidth: number
	filterText: string
	onSelect: () => void
}) => {
	const ageText = `${daysOpen(pullRequest.createdAt)}d`
	const { reviewWidth, checkWidth, ageWidth, numberWidth, titleWidth } = getRowLayout(contentWidth, numWidth, ageColWidth)
	const rowWidth = reviewWidth + 1 + numberWidth + 1 + titleWidth + checkWidth + ageWidth
	const fillerWidth = Math.max(0, contentWidth - rowWidth)
	const display = pullRequestRowDisplay(pullRequest, selected)

	return (
		<box width={contentWidth} height={1} onMouseDown={onSelect}>
			<TextLine width={contentWidth} fg={display.rowFg} bg={selected ? colors.selectedBg : undefined}>
				<span fg={display.indicatorFg}>{fitCell(reviewIcon(pullRequest), reviewWidth)}</span>
				<span> </span>
				<span fg={display.numberFg}><MatchedCell text={`#${pullRequest.number}`} width={numberWidth} query={filterText} align="right" /></span>
				<span> </span>
				<span><MatchedCell text={pullRequest.title} width={titleWidth} query={filterText} /></span>
				<span fg={display.checkFg}>{fitCell(display.checkText, checkWidth, "right")}</span>
				<span fg={colors.muted}>{fitCell(ageText, ageWidth, "right")}</span>
				{fillerWidth > 0 ? <span>{" ".repeat(fillerWidth)}</span> : null}
			</TextLine>
		</box>
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
	loadedCount: number
	hasMore: boolean
	isLoadingMore: boolean
	loadingIndicator: string
	onSelectPullRequest: (url: string) => void
}) => {
	const rows = buildPullRequestListRows({ groups, status, error, filterText, showFilterBar, loadedCount, hasMore, isLoadingMore, loadingIndicator })

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

				const numWidth = groupNumberWidth(row.groupPullRequests)
				const ageColWidth = groupAgeWidth(row.groupPullRequests)
				return (
					<PullRequestRow
						key={row.pullRequest.url}
						pullRequest={row.pullRequest}
						selected={row.pullRequest.url === selectedUrl}
						contentWidth={contentWidth}
						numWidth={numWidth}
						ageColWidth={ageColWidth}
						filterText={filterText}
						onSelect={() => onSelectPullRequest(row.pullRequest.url)}
					/>
				)
			})}
		</box>
	)
}
