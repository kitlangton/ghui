import { TextAttributes } from "@opentui/core"
import type { PullRequestLabel, PullRequestMergeInfo } from "../domain.js"
import { availableMergeActions } from "../mergeActions.js"
import { colors, themeDefinitions, type ThemeId } from "./colors.js"
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

export interface ThemeModalState {
	readonly open: boolean
	readonly selectedIndex: number
	readonly initialThemeId: ThemeId
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

export const initialThemeModalState: ThemeModalState = {
	open: false,
	selectedIndex: 0,
	initialThemeId: "ghui",
}

const mergeUnavailableReason = (info: PullRequestMergeInfo | null) => {
	if (!info) return "Loading merge status from GitHub."
	if (info.state !== "open") return "This pull request is not open."
	if (info.isDraft) return "Draft pull requests cannot be merged."
	if (info.mergeable === "conflicting") return "This branch has merge conflicts."
	return "No merge actions are currently available."
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
	const rowWidth = innerWidth
	const currentNames = new Set(currentLabels.map((l) => l.name.toLowerCase()))
	const filtered = state.availableLabels.filter((label) =>
		state.query.length === 0 || label.name.toLowerCase().includes(state.query.toLowerCase()),
	)
	const maxVisible = Math.max(1, modalHeight - 7)
	const labelMessageTopRows = Math.max(0, Math.floor((maxVisible - 1) / 2))
	const labelMessageBottomRows = Math.max(0, maxVisible - labelMessageTopRows - 1)
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
			<box height={maxVisible} flexDirection="column">
				{state.loading ? (
					<>
						{Array.from({ length: labelMessageTopRows }, (_, index) => <box key={`top-${index}`} height={1} />)}
						<PlainLine text={centerCell(`${loadingIndicator} Loading labels`, rowWidth)} fg={colors.muted} />
						{Array.from({ length: labelMessageBottomRows }, (_, index) => <box key={`bottom-${index}`} height={1} />)}
					</>
				) : visibleLabels.length === 0 ? (
					<>
						{Array.from({ length: labelMessageTopRows }, (_, index) => <box key={`top-${index}`} height={1} />)}
						<PlainLine text={centerCell(state.query.length > 0 ? "No matching labels" : "No labels found", rowWidth)} fg={colors.muted} />
						{Array.from({ length: labelMessageBottomRows }, (_, index) => <box key={`bottom-${index}`} height={1} />)}
					</>
				) : (
					visibleLabels.map((label, index) => {
						const actualIndex = scrollStart + index
						const isActive = currentNames.has(label.name.toLowerCase())
						const isSelected = actualIndex === selectedIndex
						const marker = isActive ? "✓" : " "
						const nameWidth = Math.max(1, rowWidth - 5)
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
	const rowWidth = innerWidth
	const options = availableMergeActions(state.info)
	const selectedIndex = options.length === 0 ? 0 : Math.max(0, Math.min(state.selectedIndex, options.length - 1))
	const title = state.info ? `Merge  #${state.info.number}` : state.number ? `Merge  #${state.number}` : "Merge"
	const rightText = state.running ? "running" : state.loading ? "loading" : state.info?.autoMergeEnabled ? "auto on" : "manual"
	const headerGap = Math.max(1, contentWidth - title.length - rightText.length)
	const repo = state.info?.repository ?? state.repository
	const statusLine = state.info
		? `${shortRepoName(state.info.repository)}  ${state.info.mergeable}  ${state.info.reviewStatus}  ${state.info.checkSummary ?? state.info.checkStatus}`
		: repo ? shortRepoName(repo) : ""
	const optionAreaHeight = Math.max(1, modalHeight - 7)
	const optionRows = Math.max(1, Math.floor(optionAreaHeight / 2))
	const visibleOptions = options.slice(0, optionRows)
	const loadingTopRows = Math.max(0, Math.floor((optionAreaHeight - 1) / 2))
	const loadingBottomRows = Math.max(0, optionAreaHeight - loadingTopRows - 1)

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
			<box height={optionAreaHeight} flexDirection="column">
				{state.loading ? (
					<>
						{Array.from({ length: loadingTopRows }, (_, index) => <box key={`top-${index}`} height={1} />)}
						<PlainLine text={centerCell(`${loadingIndicator} Loading merge status`, rowWidth)} fg={colors.muted} />
						{Array.from({ length: loadingBottomRows }, (_, index) => <box key={`bottom-${index}`} height={1} />)}
					</>
				) : state.error ? (
					<PlainLine text={centerCell(state.error, rowWidth)} fg={colors.error} />
				) : visibleOptions.length === 0 ? (
					<PlainLine text={centerCell(mergeUnavailableReason(state.info), rowWidth)} fg={colors.muted} />
				) : (
					visibleOptions.map((option, index) => {
						const isSelected = index === selectedIndex
						const titleColor = option.danger ? colors.error : isSelected ? colors.selectedText : colors.text
						const titleWidth = Math.max(1, rowWidth - 1)
						const descriptionWidth = Math.max(1, rowWidth - 1)

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

export const ThemeModal = ({
	state,
	activeThemeId,
	modalWidth,
	modalHeight,
	offsetLeft,
	offsetTop,
}: {
	state: ThemeModalState
	activeThemeId: ThemeId
	modalWidth: number
	modalHeight: number
	offsetLeft: number
	offsetTop: number
}) => {
	const innerWidth = Math.max(16, modalWidth - 2)
	const contentWidth = Math.max(14, innerWidth - 2)
	const rowWidth = innerWidth
	const maxVisible = Math.max(1, modalHeight - 7)
	const selectedIndex = Math.max(0, Math.min(state.selectedIndex, themeDefinitions.length - 1))
	const selectedTheme = themeDefinitions[selectedIndex]!
	const scrollStart = Math.min(
		Math.max(0, themeDefinitions.length - maxVisible),
		Math.max(0, selectedIndex - maxVisible + 1),
	)
	const visibleThemes = themeDefinitions.slice(scrollStart, scrollStart + maxVisible)
	const countText = `${selectedIndex + 1}/${themeDefinitions.length}`
	const title = "Themes"
	const headerGap = Math.max(1, contentWidth - title.length - countText.length)

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
				<PlainLine text={fitCell(selectedTheme.description, contentWidth)} fg={colors.muted} />
			</box>
			<Divider width={innerWidth} />
			<box height={maxVisible} flexDirection="column">
				{visibleThemes.map((theme, index) => {
					const actualIndex = scrollStart + index
					const isSelected = actualIndex === selectedIndex
					const isActive = theme.id === activeThemeId
					const marker = isActive ? "✓" : " "
					const swatchWidth = 6
					const nameWidth = Math.max(1, rowWidth - swatchWidth - 3)

					return (
						<TextLine key={theme.id} bg={isSelected ? colors.selectedBg : undefined} fg={isSelected ? colors.selectedText : colors.text}>
							<span fg={isActive ? colors.status.passing : colors.muted}>{marker}</span>
							<span> </span>
							<span>{fitCell(theme.name, nameWidth)}</span>
							<span bg={theme.colors.background}> </span>
							<span bg={theme.colors.panel}> </span>
							<span bg={theme.colors.accent}> </span>
							<span bg={theme.colors.status.passing}> </span>
							<span bg={theme.colors.status.failing}> </span>
							<span bg={theme.colors.status.review}> </span>
						</TextLine>
					)
				})}
			</box>
			<Divider width={innerWidth} />
			<box height={1} paddingLeft={1} paddingRight={1}>
				<TextLine>
					<span fg={colors.count}>↑↓</span>
					<span fg={colors.muted}> preview  </span>
					<span fg={colors.count}>enter</span>
					<span fg={colors.muted}> select  </span>
					<span fg={colors.count}>esc</span>
					<span fg={colors.muted}> cancel</span>
				</TextLine>
			</box>
		</ModalFrame>
	)
}
