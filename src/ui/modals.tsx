import { TextAttributes } from "@opentui/core"
import type { PullRequestLabel, PullRequestMergeAction, PullRequestMergeInfo } from "../domain.js"
import { colors } from "./colors.js"
import { centerCell, Divider, fitCell, ModalFrame, PlainLine, TextLine } from "./primitives.js"
import { labelColor, shortRepoName } from "./pullRequests.js"

export interface LabelModalState {
	readonly open: boolean
	readonly repository: string | null
	readonly query: string
	readonly selectedIndex: number
	readonly availableLabels: readonly PullRequestLabel[]
	readonly loading: boolean
}

export interface MergeModalState {
	readonly open: boolean
	readonly repository: string | null
	readonly number: number | null
	readonly selectedIndex: number
	readonly loading: boolean
	readonly running: boolean
	readonly info: PullRequestMergeInfo | null
	readonly error: string | null
}

interface MergeModalOption {
	readonly action: PullRequestMergeAction
	readonly title: string
	readonly description: string
	readonly danger?: boolean
}

export const initialLabelModalState: LabelModalState = {
	open: false,
	repository: null,
	query: "",
	selectedIndex: 0,
	availableLabels: [],
	loading: false,
}

export const initialMergeModalState: MergeModalState = {
	open: false,
	repository: null,
	number: null,
	selectedIndex: 0,
	loading: false,
	running: false,
	info: null,
	error: null,
}

const isCleanlyMergeable = (info: PullRequestMergeInfo) =>
	info.state === "open" &&
	!info.isDraft &&
	info.mergeable === "mergeable" &&
	info.reviewStatus !== "changes" &&
	info.reviewStatus !== "review" &&
	info.checkStatus !== "pending" &&
	info.checkStatus !== "failing"

export const mergeModalOptions = (info: PullRequestMergeInfo | null): readonly MergeModalOption[] => {
	if (!info || info.state !== "open") return []
	const options: MergeModalOption[] = []

	if (isCleanlyMergeable(info)) {
		options.push({
			action: "squash",
			title: "Squash merge now",
			description: "Merge this pull request and delete the branch.",
		})
	}

	if (!info.autoMergeEnabled && !info.isDraft && info.mergeable !== "conflicting") {
		options.push({
			action: "auto",
			title: "Enable auto-merge",
			description: "Squash merge automatically after GitHub requirements pass.",
		})
	}

	if (info.autoMergeEnabled) {
		options.push({
			action: "disable-auto",
			title: "Disable auto-merge",
			description: "Cancel the pending GitHub auto-merge request.",
		})
	}

	if (!info.isDraft && info.mergeable !== "conflicting") {
		options.push({
			action: "admin",
			title: "Admin override merge",
			description: "Bypass unmet merge requirements with --admin.",
			danger: true,
		})
	}

	return options
}

const mergeUnavailableReason = (info: PullRequestMergeInfo | null) => {
	if (!info) return "Loading merge status from GitHub."
	if (info.state !== "open") return "This pull request is not open."
	if (info.isDraft) return "Draft pull requests cannot be merged."
	if (info.mergeable === "conflicting") return "This branch has merge conflicts."
	return "No merge actions are currently available."
}

export const mergeActionPastTense = (action: PullRequestMergeAction) => {
	if (action === "auto") return "Enabled auto-merge"
	if (action === "disable-auto") return "Disabled auto-merge"
	if (action === "admin") return "Admin merged"
	return "Merged"
}

export const LabelModal = ({
	state,
	currentLabels,
	modalWidth,
	modalHeight,
	offsetLeft,
	offsetTop,
	loadingIndicator,
}: {
	state: LabelModalState
	currentLabels: readonly PullRequestLabel[]
	modalWidth: number
	modalHeight: number
	offsetLeft: number
	offsetTop: number
	loadingIndicator: string
}) => {
	const innerWidth = Math.max(16, modalWidth - 2)
	const contentWidth = Math.max(14, innerWidth - 2)
	const currentNames = new Set(currentLabels.map((l) => l.name.toLowerCase()))
	const filtered = state.availableLabels.filter((label) =>
		state.query.length === 0 || label.name.toLowerCase().includes(state.query.toLowerCase()),
	)
	const maxVisible = Math.max(1, modalHeight - 8)
	const selectedIndex = filtered.length === 0 ? 0 : Math.max(0, Math.min(state.selectedIndex, filtered.length - 1))
	const scrollStart = Math.min(
		Math.max(0, filtered.length - maxVisible),
		Math.max(0, selectedIndex - maxVisible + 1),
	)
	const visibleLabels = filtered.slice(scrollStart, scrollStart + maxVisible)
	const title = state.repository ? `Labels  ${shortRepoName(state.repository)}` : "Labels"
	const countText = state.loading ? "loading" : `${filtered.length}/${state.availableLabels.length}`
	const headerGap = Math.max(1, contentWidth - title.length - countText.length)
	const queryText = state.query.length > 0 ? state.query : "type to filter labels"
	const queryPrefix = state.query.length > 0 ? "/ " : "/ "
	const queryWidth = Math.max(1, contentWidth - queryPrefix.length)

	return (
		<ModalFrame left={offsetLeft} top={offsetTop} width={modalWidth} height={modalHeight} junctionRows={[2, modalHeight - 4]}>
			<box height={1} paddingLeft={1} paddingRight={1}>
				<TextLine>
					<span fg={colors.accent} attributes={TextAttributes.BOLD}>{title}</span>
					<span fg={colors.muted}>{" ".repeat(headerGap)}</span>
					<span fg={colors.muted}>{countText}</span>
				</TextLine>
			</box>
			<box height={1} paddingLeft={1} paddingRight={1}>
				<TextLine>
					<span fg={colors.count}>{queryPrefix}</span>
					<span fg={state.query.length > 0 ? colors.text : colors.muted}>{fitCell(queryText, queryWidth)}</span>
				</TextLine>
			</box>
			<Divider width={innerWidth} />
			<box flexDirection="column" paddingLeft={1} paddingRight={1}>
				{state.loading ? (
					<PlainLine text={centerCell(`${loadingIndicator} Loading labels`, contentWidth)} fg={colors.muted} />
				) : visibleLabels.length === 0 ? (
					<PlainLine text={centerCell(state.query.length > 0 ? "No matching labels" : "No labels found", contentWidth)} fg={colors.muted} />
				) : (
					visibleLabels.map((label, index) => {
						const actualIndex = scrollStart + index
						const isActive = currentNames.has(label.name.toLowerCase())
						const isSelected = actualIndex === selectedIndex
						const marker = isActive ? "✓" : " "
						const nameWidth = Math.max(1, contentWidth - 5)
						return (
							<box key={label.name} height={1}>
								<TextLine bg={isSelected ? colors.selectedBg : undefined} fg={isSelected ? colors.selectedText : colors.text}>
									<span fg={isActive ? colors.status.passing : colors.muted}>{marker}</span>
									<span> </span>
									<span bg={labelColor(label)}>  </span>
									<span> {fitCell(label.name, nameWidth)}</span>
								</TextLine>
							</box>
						)
					})
				)}
			</box>
			<box flexGrow={1} />
			<Divider width={innerWidth} />
			<box height={1} paddingLeft={1} paddingRight={1}>
				<TextLine>
					<span fg={colors.count}>↑↓</span>
					<span fg={colors.muted}> move  </span>
					<span fg={colors.count}>esc</span>
					<span fg={colors.muted}> close</span>
					{filtered.length > maxVisible ? <span fg={colors.muted}>  {selectedIndex + 1}/{filtered.length}</span> : null}
				</TextLine>
			</box>
		</ModalFrame>
	)
}

export const MergeModal = ({
	state,
	modalWidth,
	modalHeight,
	offsetLeft,
	offsetTop,
	loadingIndicator,
}: {
	state: MergeModalState
	modalWidth: number
	modalHeight: number
	offsetLeft: number
	offsetTop: number
	loadingIndicator: string
}) => {
	const innerWidth = Math.max(16, modalWidth - 2)
	const contentWidth = Math.max(14, innerWidth - 2)
	const options = mergeModalOptions(state.info)
	const selectedIndex = options.length === 0 ? 0 : Math.max(0, Math.min(state.selectedIndex, options.length - 1))
	const title = state.info ? `Merge  #${state.info.number}` : state.number ? `Merge  #${state.number}` : "Merge"
	const rightText = state.running ? "running" : state.loading ? "loading" : state.info?.autoMergeEnabled ? "auto on" : "manual"
	const headerGap = Math.max(1, contentWidth - title.length - rightText.length)
	const repo = state.info?.repository ?? state.repository
	const statusLine = state.info
		? `${shortRepoName(state.info.repository)}  ${state.info.mergeable}  ${state.info.reviewStatus}  ${state.info.checkSummary ?? state.info.checkStatus}`
		: repo ? shortRepoName(repo) : ""
	const optionRows = Math.max(1, Math.floor((modalHeight - 9) / 2))
	const visibleOptions = options.slice(0, optionRows)

	return (
		<ModalFrame left={offsetLeft} top={offsetTop} width={modalWidth} height={modalHeight} junctionRows={[2, modalHeight - 4]}>
			<box height={1} paddingLeft={1} paddingRight={1}>
				<TextLine>
					<span fg={colors.accent} attributes={TextAttributes.BOLD}>{title}</span>
					<span fg={colors.muted}>{" ".repeat(headerGap)}</span>
					<span fg={state.running || state.loading ? colors.status.pending : colors.muted}>{rightText}</span>
				</TextLine>
			</box>
			<box height={1} paddingLeft={1} paddingRight={1}>
				<PlainLine text={fitCell(statusLine, contentWidth)} fg={colors.muted} />
			</box>
			<Divider width={innerWidth} />
			<box flexDirection="column" paddingLeft={1} paddingRight={1}>
				{state.loading ? (
					<PlainLine text={centerCell(`${loadingIndicator} Loading merge status`, contentWidth)} fg={colors.muted} />
				) : state.error ? (
					<PlainLine text={centerCell(state.error, contentWidth)} fg={colors.error} />
				) : visibleOptions.length === 0 ? (
					<PlainLine text={centerCell(mergeUnavailableReason(state.info), contentWidth)} fg={colors.muted} />
				) : (
					visibleOptions.map((option, index) => {
						const isSelected = index === selectedIndex
						const titleColor = option.danger ? colors.error : isSelected ? colors.selectedText : colors.text
						const titleWidth = Math.max(1, contentWidth - 1)
						const descriptionWidth = Math.max(1, contentWidth - 1)

						return (
							<box key={option.action} height={2} flexDirection="column">
								<TextLine bg={isSelected ? colors.selectedBg : undefined}>
									<span fg={titleColor}> {fitCell(option.title, titleWidth)}</span>
								</TextLine>
								<TextLine bg={isSelected ? colors.selectedBg : undefined}>
									<span fg={colors.muted}> {fitCell(option.description, descriptionWidth)}</span>
								</TextLine>
							</box>
						)
					})
				)}
			</box>
			<box flexGrow={1} />
			<Divider width={innerWidth} />
			<box height={1} paddingLeft={1} paddingRight={1}>
				<TextLine>
					<span fg={colors.count}>↑↓</span>
					<span fg={colors.muted}> move  </span>
					<span fg={colors.count}>enter</span>
					<span fg={colors.muted}> confirm  </span>
					<span fg={colors.count}>esc</span>
					<span fg={colors.muted}> close</span>
				</TextLine>
			</box>
		</ModalFrame>
	)
}
