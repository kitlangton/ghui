import { TextAttributes } from "@opentui/core"
import type { PullRequestItem } from "../domain.js"
import { daysOpen } from "../date.js"
import { colors } from "./colors.js"
import { fitCell, PlainLine, SectionTitle, TextLine } from "./primitives.js"
import { checkLabel, repoColor, reviewIcon, statusColor } from "./pullRequests.js"

export type LoadStatus = "loading" | "ready" | "error"
export type PullRequestGroups = Array<[string, PullRequestItem[]]>

const GROUP_ICON = "◆"

const getRowLayout = (contentWidth: number, numberWidth = 6) => {
	const reviewWidth = 1
	const checkWidth = 6
	const ageWidth = 4
	const fixedWidth = reviewWidth + 1 + numberWidth + 1 + checkWidth + ageWidth
	const titleWidth = Math.max(8, contentWidth - fixedWidth)
	return { reviewWidth, checkWidth, ageWidth, numberWidth, titleWidth }
}

const groupNumberWidth = (pullRequests: readonly PullRequestItem[]) => {
	if (pullRequests.length === 0) return 4
	const maxLen = Math.max(...pullRequests.map((pr) => String(pr.number).length))
	return maxLen + 1
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

const PullRequestRow = ({
	pullRequest,
	selected,
	contentWidth,
	numWidth,
	filterText,
	onSelect,
}: {
	pullRequest: PullRequestItem
	selected: boolean
	contentWidth: number
	numWidth: number
	filterText: string
	onSelect: () => void
}) => {
	const isClosed = pullRequest.state === "closed"
	const isMerged = pullRequest.state === "merged"
	const isFinal = isClosed || isMerged
	const checkText = isMerged ? "merged" : isClosed ? "closed" : checkLabel(pullRequest)?.replace(/^checks\s+/, "") ?? ""
	const ageText = `${daysOpen(pullRequest.createdAt)}d`
	const { reviewWidth, checkWidth, ageWidth, numberWidth, titleWidth } = getRowLayout(contentWidth, numWidth)
	const rowWidth = reviewWidth + 1 + numberWidth + 1 + titleWidth + checkWidth + ageWidth
	const fillerWidth = Math.max(0, contentWidth - rowWidth)
	const indicatorColor = isMerged ? colors.status.passing : isClosed ? colors.muted : pullRequest.autoMergeEnabled ? colors.accent : statusColor(pullRequest.reviewStatus)
	const rowTextColor = selected ? colors.selectedText : isFinal ? colors.muted : colors.text
	const numberColor = selected ? colors.accent : isFinal ? colors.muted : colors.count
	const checkColor = isMerged ? colors.status.passing : isClosed ? colors.muted : statusColor(pullRequest.checkStatus)

	return (
		<box width={contentWidth} height={1} onMouseDown={onSelect}>
			<TextLine width={contentWidth} fg={rowTextColor} bg={selected ? colors.selectedBg : undefined}>
				<span fg={indicatorColor}>{fitCell(reviewIcon(pullRequest), reviewWidth)}</span>
				<span> </span>
				<span fg={numberColor}><MatchedCell text={`#${pullRequest.number}`} width={numberWidth} query={filterText} align="right" /></span>
				<span> </span>
				<span><MatchedCell text={pullRequest.title} width={titleWidth} query={filterText} /></span>
				<span fg={checkColor}>{fitCell(checkText, checkWidth, "right")}</span>
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
	onSelectPullRequest: (url: string) => void
}) => {
	const itemCount = groups.reduce((count, [, pullRequests]) => count + pullRequests.length, 0)
	const emptyText = filterText.length > 0 ? "- No matching pull requests." : "- No open pull requests."

	return (
		<box width={contentWidth} flexDirection="column">
			<SectionTitle title="PULL REQUESTS" />
			{showFilterBar ? (
				<TextLine>
					<span fg={colors.count}>/</span>
					<span fg={colors.muted}> </span>
					<span fg={isFilterEditing ? colors.text : colors.count}>{filterText.length > 0 ? filterText : "type to filter..."}</span>
				</TextLine>
			) : null}
			{status === "loading" && itemCount === 0 ? <PlainLine text="- Loading pull requests..." fg={colors.muted} /> : null}
			{status === "error" ? <PlainLine text={`- ${error ?? "Could not load pull requests."}`} fg={colors.error} /> : null}
			{status === "ready" && itemCount === 0 ? <PlainLine text={emptyText} fg={colors.muted} /> : null}
			{groups.map(([repo, pullRequests]) => {
				const numWidth = groupNumberWidth(pullRequests)
				return (
					<box key={repo} flexDirection="column">
						<GroupTitle label={repo} color={repoColor(repo)} filterText={filterText} />
						{pullRequests.map((pullRequest) => (
							<PullRequestRow
								key={pullRequest.url}
								pullRequest={pullRequest}
								selected={pullRequest.url === selectedUrl}
								contentWidth={contentWidth}
								numWidth={numWidth}
								filterText={filterText}
								onSelect={() => onSelectPullRequest(pullRequest.url)}
							/>
						))}
					</box>
				)
			})}
		</box>
	)
}
