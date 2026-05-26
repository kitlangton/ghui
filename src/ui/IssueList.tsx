import { TextAttributes, type BoxRenderable, type MouseEvent } from "@opentui/core"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useRenderer } from "@opentui/react"
import { daysOpen, formatRelativeDate } from "../date.js"
import type { IssueItem, LoadStatus } from "../domain.js"
import { colors } from "./colors.js"
import { CommentSegments } from "./comments.js"
import { bodyPreview, wrapText } from "./DetailsPane.js"
import { LabelChips, labelChipRows } from "./LabelChips.js"
import { SelectableRow, useHoverState } from "./listSelection/SelectableRow.js"
import { PaneDivider, PaneInsetLine, paneContentWidth } from "./paneLayout.js"
import { Filler, fitCell, MatchedCell, PlainLine, TextLine } from "./primitives.js"
import { groupBy, repoColor } from "./pullRequests.js"
import { SubjectMetaLine } from "./SubjectMetaLine.js"
import { collectUrlPositions, findUrlAt } from "./inlineSegments.js"

const ISSUE_ICON = "⊙"
const ISSUE_CLOSED_ICON = "×"

// Title width is computed per-row from the actual number width, not from a
// list-wide max. Padding every short `#7` to align with a stray `#12723` from
// another repo pushed titles inward and looked broken.
const issueRowTitleWidth = (contentWidth: number, numberText: string, ageWidth: number) => {
	const fixedWidth = 1 + 1 + numberText.length + 1 + ageWidth
	return Math.max(8, contentWidth - fixedWidth)
}

const GROUP_ICON = "◆"

export const issueActivityAgeText = (issue: IssueItem) => `${daysOpen(issue.updatedAt)}d`

const IssueDetailLine = ({ children, width }: { children: ReactNode; width: number }) => <PaneInsetLine width={width}>{children}</PaneInsetLine>

const issueGroups = (issues: readonly IssueItem[], showRepositoryGroups: boolean) => {
	const indexed = issues.map((issue, index) => ({ issue, index }))
	return showRepositoryGroups ? groupBy(indexed, ({ issue }) => issue.repository) : ([[null, indexed]] as const)
}

// Reorder issues so that the array order matches the order rendered by
// IssueList (grouped by repository when grouping is shown). Without this,
// j/k navigation steps by raw-array index and jumps across repository
// groups, since groupBy reorders alphabetically.
export const orderIssuesForDisplay = (issues: readonly IssueItem[], showRepositoryGroups: boolean): readonly IssueItem[] => {
	if (!showRepositoryGroups) return issues
	return groupBy(issues, (issue) => issue.repository).flatMap(([, groupIssues]) => groupIssues)
}

export const issueListVisualLineCount = (issues: readonly IssueItem[], showRepositoryGroups: boolean, hasLoadMoreRow = false) => {
	const issueLines = issueGroups(issues, showRepositoryGroups).reduce((count, [repository, groupIssues]) => count + (repository ? 1 : 0) + groupIssues.length * 2, 0)
	return issueLines + (hasLoadMoreRow ? 1 : 0)
}

export const issueListRowIndex = (issues: readonly IssueItem[], selectedIndex: number, showRepositoryGroups: boolean, loadMoreSelected = false) => {
	let line = 0
	for (const [repository, groupIssues] of issueGroups(issues, showRepositoryGroups)) {
		if (repository) line += 1
		for (const { index } of groupIssues) {
			if (index === selectedIndex) return line
			line += 2
		}
	}
	if (loadMoreSelected) return line
	return null
}

export const IssueList = ({
	issues,
	selectedIndex,
	status,
	error,
	repository,
	contentWidth,
	filterText = "",
	showFilterBar = false,
	isFilterEditing = false,
	onSelectIssue,
	hasMore = false,
	isLoadingMore = false,
	loadedCount = 0,
	loadingIndicator = "-",
	loadMoreSelected = false,
	onSelectLoadMore,
}: {
	issues: readonly IssueItem[]
	selectedIndex: number
	status: LoadStatus
	error: string | null
	repository: string | null
	contentWidth: number
	filterText?: string
	showFilterBar?: boolean
	isFilterEditing?: boolean
	onSelectIssue: (index: number) => void
	hasMore?: boolean
	isLoadingMore?: boolean
	loadedCount?: number
	loadingIndicator?: string
	loadMoreSelected?: boolean
	onSelectLoadMore?: () => void
}) => {
	const { isHovered, onHoverChange } = useHoverState<number>()
	const ageWidth = Math.max(4, ...issues.map((issue) => issueActivityAgeText(issue).length + 1))
	const groups = issueGroups(issues, repository === null)

	return (
		<box width={contentWidth} flexDirection="column">
			{showFilterBar ? (
				<TextLine>
					<span fg={colors.count}>/</span>
					<span fg={colors.muted}> </span>
					<span fg={isFilterEditing ? colors.text : colors.count}>{filterText.length > 0 ? filterText : "type to filter..."}</span>
				</TextLine>
			) : null}
			{status === "ready" && repository === null && issues.length === 0 ? (
				<PlainLine text={filterText.length > 0 ? "- No matching issues." : "- No issues in your repositories."} fg={colors.muted} />
			) : null}
			{status === "loading" && issues.length === 0 ? <PlainLine text="- Loading issues..." fg={colors.muted} /> : null}
			{status === "error" ? <PlainLine text={`- ${error ?? "Could not load issues."}`} fg={colors.error} /> : null}
			{status === "ready" && repository && issues.length === 0 ? (
				<PlainLine text={filterText.length > 0 ? "- No matching issues." : "- No open issues."} fg={colors.muted} />
			) : null}
			{groups.flatMap(([groupRepository, groupIssues]) => {
				const rows: ReactNode[] = []
				if (groupRepository) {
					rows.push(
						<TextLine key={`group-${groupRepository}`} width={contentWidth}>
							<span fg={repoColor(groupRepository)}>{GROUP_ICON} </span>
							<span fg={repoColor(groupRepository)} attributes={TextAttributes.BOLD}>
								<MatchedCell text={groupRepository} width={contentWidth - 2} query={filterText} />
							</span>
						</TextLine>,
					)
				}
				for (const { issue, index } of groupIssues) {
					const selected = index === selectedIndex
					const closed = issue.state === "closed"
					const ageText = issueActivityAgeText(issue)
					const numberText = `#${issue.number}`
					const titleWidth = issueRowTitleWidth(contentWidth, numberText, ageWidth)
					const iconFg = selected ? colors.accent : colors.muted
					const numberFg = selected ? colors.accent : closed ? colors.muted : colors.count
					const titleFg = selected ? colors.selectedText : closed ? colors.muted : colors.text
					rows.push(
						<SelectableRow
							key={issue.url}
							width={contentWidth}
							selected={selected}
							hovered={isHovered(index)}
							onSelect={() => onSelectIssue(index)}
							onHoverChange={onHoverChange(index)}
						>
							{(rowBg) => (
								<>
									<TextLine width={contentWidth} fg={titleFg} bg={rowBg}>
										<span fg={iconFg}>{closed ? ISSUE_CLOSED_ICON : ISSUE_ICON}</span>
										<span> </span>
										<span fg={numberFg} attributes={selected ? TextAttributes.BOLD : 0}>
											{numberText}
										</span>
										<span> </span>
										<MatchedCell text={issue.title} width={titleWidth} query={filterText} />
										<span fg={colors.muted}>{fitCell(ageText, ageWidth, "right")}</span>
									</TextLine>
									<TextLine width={contentWidth} fg={colors.muted} bg={rowBg}>
										<span>{"  "}</span>
										<MatchedCell text={`@${issue.author}`} width={Math.max(1, contentWidth - 2)} query={filterText} />
									</TextLine>
								</>
							)}
						</SelectableRow>,
					)
				}
				return rows
			})}
			{status === "ready" && issues.length > 0 && (hasMore || isLoadingMore) ? (
				<SelectableRow key="load-more" width={contentWidth} selected={loadMoreSelected} hovered={false} onSelect={() => onSelectLoadMore?.()} onHoverChange={() => {}}>
					{(rowBg) => (
						<TextLine width={contentWidth} fg={colors.muted} bg={rowBg}>
							<span>{isLoadingMore ? `${loadingIndicator} Loading more issues... (${loadedCount} loaded)` : `↓ Press enter to load more  ·  ${loadedCount} loaded`}</span>
						</TextLine>
					)}
				</SelectableRow>
			) : null}
		</box>
	)
}

export const getIssueDetailJunctionRows = (issue: IssueItem | null, paneWidth: number): readonly number[] => {
	if (!issue) return []
	const contentWidth = paneContentWidth(paneWidth)
	const titleLines = wrapText(issue.title, Math.max(1, contentWidth)).length
	const labelRows = labelChipRows(issue.labels, contentWidth).length
	return [titleLines + 1 + labelRows]
}

export const getIssueDetailContentHeight = (issue: IssueItem | null, width: number, height: number, bodyLineLimit?: number) => {
	if (!issue) return 1
	const contentWidth = paneContentWidth(width)
	const titleLines = wrapText(issue.title, Math.max(1, contentWidth)).length
	const labelRows = labelChipRows(issue.labels, contentWidth).length
	const resolvedBodyLineLimit = bodyLineLimit ?? Math.max(1, height - titleLines - labelRows - 2)
	const bodyLines = bodyPreview(issue.body, contentWidth, resolvedBodyLineLimit, { tableMode: "truncate" }).length
	return titleLines + 1 + labelRows + 1 + bodyLines
}

export const IssueDetailPane = ({
	issue,
	width,
	height,
	bodyLineLimit,
	onLinkOpen,
}: {
	issue: IssueItem | null
	width: number
	height: number
	bodyLineLimit?: number
	onLinkOpen?: (url: string) => void
}) => {
	const renderer = useRenderer()
	const [hoveredUrl, setHoveredUrl] = useState<string | null>(null)
	const contentWidth = paneContentWidth(width)
	const titleLines = issue ? wrapText(issue.title, Math.max(1, contentWidth)) : []
	const labelRows = issue ? labelChipRows(issue.labels, contentWidth) : []
	const resolvedBodyLineLimit = bodyLineLimit ?? Math.max(1, height - titleLines.length - labelRows.length - 2)
	const visibleBodyLines = useMemo(
		() => bodyPreview(issue?.body ?? "", contentWidth, resolvedBodyLineLimit, { tableMode: "truncate", issueReferenceRepository: issue?.repository ?? null }),
		[issue?.body, issue?.repository, contentWidth, resolvedBodyLineLimit],
	)
	const urlPositions = useMemo(() => collectUrlPositions(visibleBodyLines), [visibleBodyLines])

	useEffect(() => {
		if (hoveredUrl === null) return
		renderer.setMousePointer("pointer")
		return () => renderer.setMousePointer("default")
	}, [hoveredUrl, renderer])

	const handleMouseMove = function (this: BoxRenderable, event: MouseEvent) {
		if (urlPositions.length === 0) return
		const localX = event.x - this.x - 1
		const localY = event.y - this.y
		const next = findUrlAt(urlPositions, localY, localX)
		if (next !== hoveredUrl) setHoveredUrl(next)
	}

	const handleMouseOut = () => {
		if (hoveredUrl !== null) setHoveredUrl(null)
	}

	const handleMouseDown = function (this: BoxRenderable, event: MouseEvent) {
		if (!onLinkOpen || event.button !== 0) return
		const localX = event.x - this.x - 1
		const localY = event.y - this.y
		const url = findUrlAt(urlPositions, localY, localX)
		if (url === null) return
		event.stopPropagation()
		onLinkOpen(url)
	}

	if (!issue) {
		return (
			<box width={width} height={height} flexDirection="column">
				<IssueDetailLine width={width}>
					<span fg={colors.muted}>No issue selected</span>
				</IssueDetailLine>
				<Filler rows={Math.max(0, height - 1)} prefix="issue-empty" />
			</box>
		)
	}

	const commentsText = issue.commentCount > 0 ? `${issue.commentCount} ${issue.commentCount === 1 ? "comment" : "comments"}` : null
	const opened = formatRelativeDate(issue.createdAt)
	const usedRows = titleLines.length + 1 + labelRows.length + 1 + visibleBodyLines.length
	const contentHeight = Math.max(height, usedRows)

	return (
		<box width={width} height={contentHeight} flexDirection="column">
			{titleLines.map((line, index) => (
				<IssueDetailLine key={`title-${index}`} width={width}>
					<span fg={colors.text} attributes={TextAttributes.BOLD}>
						{fitCell(line, contentWidth)}
					</span>
				</IssueDetailLine>
			))}
			<IssueDetailLine width={width}>
				<SubjectMetaLine number={issue.number} author={issue.author} dateText={opened} commentsText={commentsText} contentWidth={contentWidth} />
			</IssueDetailLine>
			{labelRows.map((row, index) => (
				<IssueDetailLine key={`labels-${index}`} width={width}>
					<LabelChips labels={row} />
				</IssueDetailLine>
			))}
			<PaneDivider width={width} />
			<box flexDirection="column" onMouseMove={handleMouseMove} onMouseOut={handleMouseOut} onMouseDown={handleMouseDown}>
				{visibleBodyLines.map((line, index) => (
					<IssueDetailLine key={index} width={width}>
						<CommentSegments segments={line.segments} hoveredUrl={hoveredUrl} />
					</IssueDetailLine>
				))}
			</box>
			<Filler rows={Math.max(0, contentHeight - usedRows)} prefix="issue-detail" />
		</box>
	)
}
