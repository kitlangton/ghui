import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { type RefObject } from "react"
import { daysOpen } from "../date.js"
import type { RepositoryDetails } from "../domain.js"
import { colors } from "./colors.js"
import { wrapText } from "./DetailsPane.js"
import { SelectableRow, useHoverState } from "./listSelection/SelectableRow.js"
import { PaneDivider, PaneInsetLine, paneContentWidth } from "./paneLayout.js"
import { Filler, fitCell, MatchedCell, PlainLine, TextLine, trimCell } from "./primitives.js"

export interface RepositoryListItem {
	readonly repository: string
	readonly pullRequestCount: number
	readonly issueCount: number
	readonly current: boolean
	readonly favorite: boolean
	readonly recent: boolean
	readonly lastActivityAt: Date | null
	readonly description: string | null
}

export const getRepoDetailJunctionRows = (repository: RepositoryListItem | null, details: RepositoryDetails | null): readonly number[] => {
	if (!repository) return []
	// Header rows above the divider: title + status. Stats and branch only
	// render when full details are loaded.
	const extraRows = (details ? 1 : 0) + (details?.defaultBranch ? 1 : 0)
	return [2 + extraRows]
}

const activityText = (date: Date | null) => (date ? `${daysOpen(date)}d` : "-")

const RepoNameCell = ({ repository, width, current }: { readonly repository: string; readonly width: number; readonly current: boolean }) => {
	const currentText = current ? " current" : ""
	const nameWidth = Math.max(1, width - currentText.length)
	const fitted = trimCell(repository, nameWidth)
	const slash = fitted.indexOf("/")
	const owner = slash >= 0 ? fitted.slice(0, slash + 1) : ""
	const repoName = slash >= 0 ? fitted.slice(slash + 1) : fitted
	const padding = Math.max(0, nameWidth - fitted.length)
	return (
		<>
			{owner ? <span fg={colors.separator}>{owner}</span> : null}
			<span>{repoName}</span>
			{current ? <span fg={colors.accent}>{currentText}</span> : null}
			{padding > 0 ? <span>{" ".repeat(padding)}</span> : null}
		</>
	)
}

export const RepoList = ({
	repositories,
	selectedIndex,
	contentWidth,
	filterText = "",
	showFilterBar = false,
	isFilterEditing = false,
	onSelectRepository,
}: {
	repositories: readonly RepositoryListItem[]
	selectedIndex: number
	contentWidth: number
	filterText?: string
	showFilterBar?: boolean
	isFilterEditing?: boolean
	onSelectRepository: (index: number) => void
}) => {
	const { isHovered, onHoverChange } = useHoverState<number>()

	if (repositories.length === 0) {
		return (
			<box width={contentWidth} flexDirection="column">
				{showFilterBar ? (
					<TextLine>
						<span fg={colors.count}>/</span>
						<span fg={colors.muted}> </span>
						<span fg={isFilterEditing ? colors.text : colors.count}>{filterText.length > 0 ? filterText : "type to filter..."}</span>
					</TextLine>
				) : null}
				<PlainLine text={filterText.length > 0 ? "- No matching repositories." : "No repositories loaded yet"} fg={colors.muted} />
			</box>
		)
	}

	const ageWidth = Math.max(4, ...repositories.map((repo) => activityText(repo.lastActivityAt).length))
	const markerWidth = 1
	const repoWidth = Math.max(12, contentWidth - markerWidth - 1 - 1 - ageWidth)

	return (
		<box width={contentWidth} flexDirection="column">
			{showFilterBar ? (
				<TextLine>
					<span fg={colors.count}>/</span>
					<span fg={colors.muted}> </span>
					<span fg={isFilterEditing ? colors.text : colors.count}>{filterText.length > 0 ? filterText : "type to filter..."}</span>
				</TextLine>
			) : null}
			{repositories.map((repo, index) => {
				const selected = index === selectedIndex
				const marker = repo.favorite ? "★" : "·"
				const markerFg = repo.favorite ? colors.accent : colors.muted
				const nameFg = repo.current ? colors.count : colors.text
				const age = activityText(repo.lastActivityAt)
				return (
					<SelectableRow
						key={repo.repository}
						width={contentWidth}
						height={1}
						selected={selected}
						hovered={isHovered(index)}
						onSelect={() => onSelectRepository(index)}
						onHoverChange={onHoverChange(index)}
					>
						{(rowBg) => (
							<TextLine width={contentWidth} bg={rowBg}>
								<span fg={markerFg}>{marker}</span>
								<span> </span>
								<span fg={nameFg}>
									{filterText.length > 0 ? (
										<MatchedCell text={repo.repository} width={repoWidth} query={filterText} />
									) : (
										<RepoNameCell repository={repo.repository} width={repoWidth} current={repo.current} />
									)}
								</span>
								<span fg={colors.muted}> </span>
								<span fg={colors.muted}>{fitCell(age, ageWidth, "right")}</span>
							</TextLine>
						)}
					</SelectableRow>
				)
			})}
		</box>
	)
}

const formatCount = (count: number) => (count >= 1000 ? `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k` : String(count))

const relativeTime = (date: Date | null) => {
	if (!date) return null
	const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
	if (seconds < 60) return "just now"
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours}h ago`
	const days = Math.floor(hours / 24)
	if (days < 30) return `${days}d ago`
	const months = Math.floor(days / 30)
	if (months < 12) return `${months}mo ago`
	return `${Math.floor(months / 12)}y ago`
}

export const RepoDetailPane = ({
	repository,
	details,
	width,
	height,
	descriptionLineLimit = 1,
	descriptionScrollRef,
	showScrollbar = false,
}: {
	repository: RepositoryListItem | null
	details: RepositoryDetails | null
	width: number
	height: number
	descriptionLineLimit?: number
	descriptionScrollRef?: RefObject<ScrollBoxRenderable | null>
	showScrollbar?: boolean
}) => {
	const contentWidth = paneContentWidth(width)
	if (!repository) {
		return (
			<box width={width} height={height} flexDirection="column">
				<PaneInsetLine width={width}>
					<span fg={colors.muted}>No repository selected</span>
				</PaneInsetLine>
				<Filler rows={Math.max(0, height - 1)} prefix="repo-empty" />
			</box>
		)
	}

	const description = details?.description ?? repository.description ?? (details === null ? "Loading…" : "No description.")
	const wrappedDescriptionLines = wrapText(description, contentWidth)
	const descriptionLines = descriptionScrollRef ? wrappedDescriptionLines : wrappedDescriptionLines.slice(0, descriptionLineLimit)

	const statusParts = [
		repository.current ? "current" : null,
		repository.favorite ? "starred" : null,
		!repository.current && !repository.favorite && repository.recent ? "recent" : null,
		details?.isPrivate ? "private" : null,
		details?.isArchived ? "archived" : null,
	].filter((part): part is string => part !== null)
	const status = statusParts.length > 0 ? statusParts.join("  ") : "repository"

	const pushedAt = details?.pushedAt ? relativeTime(details.pushedAt) : repository.lastActivityAt ? `${daysOpen(repository.lastActivityAt)}d ago` : "unknown"

	const stats = details
		? [
				{ icon: "★", value: formatCount(details.stargazerCount) },
				{ icon: "⑂", value: formatCount(details.forkCount) },
				{ icon: "⌥", value: formatCount(details.openPullRequestCount) },
				{ icon: "⊙", value: formatCount(details.openIssueCount) },
			]
		: null
	const branchRow = details?.defaultBranch ? `branch ${details.defaultBranch}` : null

	const fixedRows = 4 + (stats ? 1 : 0) + (branchRow ? 1 : 0)
	const descriptionHeight = Math.max(1, height - fixedRows)

	return (
		<box width={width} height={height} flexDirection="column">
			<PaneInsetLine width={width}>
				<span fg={colors.text} attributes={TextAttributes.BOLD}>
					{fitCell(repository.repository, contentWidth)}
				</span>
			</PaneInsetLine>
			<PaneInsetLine width={width}>
				<span fg={repository.current || repository.favorite ? colors.accent : colors.count}>{status}</span>
				<span fg={colors.muted}> pushed {pushedAt}</span>
			</PaneInsetLine>
			{stats ? (
				<PaneInsetLine width={width}>
					<span fg={colors.muted}>{stats.map((item) => `${item.icon} ${item.value}`).join("  ")}</span>
				</PaneInsetLine>
			) : null}
			{branchRow ? (
				<PaneInsetLine width={width}>
					<span fg={colors.muted}>{fitCell(branchRow, contentWidth)}</span>
				</PaneInsetLine>
			) : null}
			<PaneDivider width={width} />
			<PaneInsetLine width={width}>
				<span fg={colors.count} attributes={TextAttributes.BOLD}>
					About
				</span>
			</PaneInsetLine>
			<scrollbox
				{...(descriptionScrollRef ? { ref: descriptionScrollRef } : {})}
				focusable={false}
				height={descriptionHeight}
				flexGrow={0}
				verticalScrollbarOptions={{ visible: showScrollbar && descriptionLines.length > descriptionHeight }}
			>
				<box flexDirection="column">
					{descriptionLines.map((line, index) => (
						<PaneInsetLine key={index} width={width}>
							<span fg={colors.muted}>{fitCell(line, contentWidth)}</span>
						</PaneInsetLine>
					))}
				</box>
			</scrollbox>
		</box>
	)
}
