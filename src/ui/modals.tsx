import { TextAttributes } from "@opentui/core"
import { Data } from "effect"
import type { PullRequestLabel, PullRequestMergeInfo, PullRequestReviewComment, PullRequestReviewEvent } from "../domain.js"
import { availableMergeActions } from "../mergeActions.js"
import { clampCursor, commentEditorLines, cursorLineIndexForLines } from "./commentEditor.js"
import { colors, filterThemeDefinitions, oppositeThemeTone, themeDefinitions, type ThemeId, type ThemeTone } from "./colors.js"
import { commentDisplayRows, CommentSegmentsLine, type CommentDisplayLine } from "./comments.js"
import { diffFileStats, diffFileStatsText, type DiffFilePatch } from "./diff.js"
import {
	centerCell,
	Divider,
	Filler,
	fitCell,
	HintRow,
	MatchedCell,
	ModalFrame,
	PaddedRow,
	PlainLine,
	searchModalDims,
	SearchModalFrame,
	StandardModal,
	standardModalDims,
	TextLine,
} from "./primitives.js"
import { labelColor, shortRepoName } from "./pullRequests.js"

export interface LabelModalState {
	readonly repository: string | null
	readonly query: string
	readonly selectedIndex: number
	readonly availableLabels: readonly PullRequestLabel[]
	readonly loading: boolean
}

export interface MergeModalState {
	readonly repository: string | null
	readonly number: number | null
	readonly selectedIndex: number
	readonly loading: boolean
	readonly running: boolean
	readonly info: PullRequestMergeInfo | null
	readonly error: string | null
}

export interface CloseModalState {
	readonly repository: string | null
	readonly number: number | null
	readonly title: string
	readonly url: string | null
	readonly running: boolean
	readonly error: string | null
}

export interface CommentModalState {
	readonly body: string
	readonly cursor: number
	readonly error: string | null
}

export interface CommentThreadModalState {
	readonly scrollOffset: number
}

export interface ChangedFilesModalState {
	readonly query: string
	readonly selectedIndex: number
}

export interface SubmitReviewModalState {
	readonly repository: string | null
	readonly number: number | null
	readonly focus: "action" | "body"
	readonly selectedIndex: number
	readonly body: string
	readonly cursor: number
	readonly running: boolean
	readonly error: string | null
}

export interface ThemeModalState {
	readonly query: string
	readonly filterMode: boolean
	readonly tone: ThemeTone
	readonly initialThemeId: ThemeId
}

export interface CommandPaletteState {
	readonly query: string
	readonly selectedIndex: number
}

export interface OpenRepositoryModalState {
	readonly query: string
	readonly error: string | null
}

export const filterLabels = (labels: readonly PullRequestLabel[], query: string) => {
	const normalized = query.trim().toLowerCase()
	if (normalized.length === 0) return labels
	return labels.filter((label) => label.name.toLowerCase().includes(normalized))
}

export interface ChangedFileSearchResult {
	readonly file: DiffFilePatch
	readonly index: number
	readonly matchIndexes: readonly number[]
}

interface PathSegment {
	readonly text: string
	readonly lower: string
	readonly start: number
	readonly index: number
	readonly isBasename: boolean
}

interface FileTokenMatch {
	readonly score: number
	readonly indexes: readonly number[]
	readonly start: number
}

const PATH_WORD_BOUNDARIES = new Set(["-", "_", "."])

const pathSearchTokens = (query: string) =>
	query
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.filter((token) => token.length > 0)

const pathSegments = (path: string): readonly PathSegment[] => {
	const parts = path.split("/")
	let start = 0
	return parts.map((part, index) => {
		const segment = {
			text: part,
			lower: part.toLowerCase(),
			start,
			index,
			isBasename: index === parts.length - 1,
		}
		start += part.length + 1
		return segment
	})
}

const isPathWordBoundary = (segment: string, index: number) => index === 0 || PATH_WORD_BOUNDARIES.has(segment[index - 1] ?? "")

const fuzzyIndexesFrom = (text: string, token: string, start: number): readonly number[] | null => {
	const indexes: number[] = []
	let tokenIndex = 0
	for (let index = start; index < text.length && tokenIndex < token.length; index++) {
		if (text[index] === token[tokenIndex]) {
			indexes.push(index)
			tokenIndex++
		}
	}
	return tokenIndex === token.length ? indexes : null
}

const scoreSegmentMatch = (segment: PathSegment, token: string, localIndexes: readonly number[], contiguous: boolean): number => {
	const localStart = localIndexes[0] ?? 0
	const localEnd = localIndexes[localIndexes.length - 1] ?? localStart
	const span = localEnd - localStart + 1
	let score = 1000

	if (segment.lower === token) score += 700
	else if (contiguous && localStart === 0) score += 460
	else if (contiguous && isPathWordBoundary(segment.lower, localStart)) score += 380
	else if (contiguous) score += 280
	else score += 120

	if (segment.isBasename) score += 320
	if (isPathWordBoundary(segment.lower, localStart)) score += 80
	if (localStart === 0) score += 60
	score += Math.min(segment.index, 8) * 18
	score += Math.max(0, 120 - span * 4)
	score += Math.max(0, 40 - localStart * 2)

	if (segment.index === 0 && segment.lower === "packages" && segment.lower !== token) score -= 360

	return score
}

const tokenMatchInSegment = (segment: PathSegment, token: string): FileTokenMatch | null => {
	let best: FileTokenMatch | null = null
	const addCandidate = (localIndexes: readonly number[], contiguous: boolean) => {
		const score = scoreSegmentMatch(segment, token, localIndexes, contiguous)
		const start = segment.start + (localIndexes[0] ?? 0)
		const indexes = localIndexes.map((index) => segment.start + index)
		if (!best || score > best.score || (score === best.score && start < best.start)) {
			best = { score, indexes, start }
		}
	}

	let substringStart = segment.lower.indexOf(token)
	while (substringStart >= 0) {
		addCandidate(
			Array.from({ length: token.length }, (_, index) => substringStart + index),
			true,
		)
		substringStart = segment.lower.indexOf(token, substringStart + 1)
	}

	for (let index = 0; index < segment.lower.length; index++) {
		if (segment.lower[index] !== token[0]) continue
		const indexes = fuzzyIndexesFrom(segment.lower, token, index)
		if (indexes) addCandidate(indexes, false)
	}

	return best
}

const tokenMatchInPath = (segments: readonly PathSegment[], token: string): FileTokenMatch | null => {
	let best: FileTokenMatch | null = null
	for (const segment of segments) {
		const match = tokenMatchInSegment(segment, token)
		if (!match) continue
		if (!best || match.score > best.score || (match.score === best.score && match.start < best.start)) {
			best = match
		}
	}
	return best
}

const fuzzyPathMatch = (path: string, query: string): { readonly score: number; readonly matchIndexes: readonly number[] } | null => {
	const tokens = pathSearchTokens(query)
	if (tokens.length === 0) return { score: 0, matchIndexes: [] }

	const segments = pathSegments(path)
	const matchIndexes = new Set<number>()
	let score = 0
	let previousStart = -1

	for (const token of tokens) {
		const match = tokenMatchInPath(segments, token)
		if (!match) return null
		score += match.score
		score += previousStart < 0 || match.start >= previousStart ? 80 : -80
		previousStart = match.start
		for (const index of match.indexes) matchIndexes.add(index)
	}

	return { score, matchIndexes: [...matchIndexes].sort((left, right) => left - right) }
}

export const filterChangedFiles = (files: readonly DiffFilePatch[], query: string): readonly ChangedFileSearchResult[] => {
	const hasQuery = pathSearchTokens(query).length > 0
	const results: Array<ChangedFileSearchResult & { readonly score: number }> = []
	for (const [index, file] of files.entries()) {
		const match = fuzzyPathMatch(file.name, query)
		if (match) results.push({ file, index, matchIndexes: match.matchIndexes, score: match.score })
	}
	if (hasQuery) {
		results.sort((left, right) => {
			return right.score - left.score || left.index - right.index
		})
	}
	return results
}

export interface SubmitReviewOption {
	readonly event: PullRequestReviewEvent
	readonly title: string
	readonly description: string
}

export const submitReviewOptions: readonly SubmitReviewOption[] = [
	{ event: "COMMENT", title: "Comment", description: "Submit a general review without changing status" },
	{ event: "APPROVE", title: "Approve", description: "Approve this pull request" },
	{ event: "REQUEST_CHANGES", title: "Request changes", description: "Block merge until follow-up changes are made" },
]

const submitReviewEventColors = {
	COMMENT: colors.status.review,
	APPROVE: colors.status.passing,
	REQUEST_CHANGES: colors.status.failing,
} satisfies Record<PullRequestReviewEvent, string>

const submitReviewEventColor = (event: PullRequestReviewEvent) => submitReviewEventColors[event]

export const initialLabelModalState: LabelModalState = {
	repository: null,
	query: "",
	selectedIndex: 0,
	availableLabels: [],
	loading: false,
}

export const initialMergeModalState: MergeModalState = {
	repository: null,
	number: null,
	selectedIndex: 0,
	loading: false,
	running: false,
	info: null,
	error: null,
}

export const initialCloseModalState: CloseModalState = {
	repository: null,
	number: null,
	title: "",
	url: null,
	running: false,
	error: null,
}

export const initialCommentModalState: CommentModalState = {
	body: "",
	cursor: 0,
	error: null,
}

export const initialCommentThreadModalState: CommentThreadModalState = {
	scrollOffset: 0,
}

export const initialChangedFilesModalState: ChangedFilesModalState = {
	query: "",
	selectedIndex: 0,
}

export const initialSubmitReviewModalState: SubmitReviewModalState = {
	repository: null,
	number: null,
	focus: "action",
	selectedIndex: 0,
	body: "",
	cursor: 0,
	running: false,
	error: null,
}

export const initialThemeModalState: ThemeModalState = {
	query: "",
	filterMode: false,
	tone: "dark",
	initialThemeId: "ghui",
}

export const initialCommandPaletteState: CommandPaletteState = {
	query: "",
	selectedIndex: 0,
}

export const initialOpenRepositoryModalState: OpenRepositoryModalState = {
	query: "",
	error: null,
}

export type Modal = Data.TaggedEnum<{
	None: {}
	Label: LabelModalState
	Close: CloseModalState
	Merge: MergeModalState
	Comment: CommentModalState
	CommentThread: CommentThreadModalState
	ChangedFiles: ChangedFilesModalState
	SubmitReview: SubmitReviewModalState
	Theme: ThemeModalState
	CommandPalette: CommandPaletteState
	OpenRepository: OpenRepositoryModalState
}>

export const Modal = Data.taggedEnum<Modal>()
export const initialModal: Modal = Modal.None()

export type ModalTag = Modal["_tag"]
export type ModalState<Tag extends Exclude<ModalTag, "None">> = Omit<Extract<Modal, { _tag: Tag }>, "_tag">

export const modalInitialStates = {
	Label: initialLabelModalState,
	Close: initialCloseModalState,
	Merge: initialMergeModalState,
	Comment: initialCommentModalState,
	CommentThread: initialCommentThreadModalState,
	ChangedFiles: initialChangedFilesModalState,
	SubmitReview: initialSubmitReviewModalState,
	Theme: initialThemeModalState,
	CommandPalette: initialCommandPaletteState,
	OpenRepository: initialOpenRepositoryModalState,
} as const satisfies { [Tag in Exclude<ModalTag, "None">]: ModalState<Tag> }

export const OpenRepositoryModal = ({
	state,
	modalWidth,
	modalHeight,
	offsetLeft,
	offsetTop,
}: {
	state: OpenRepositoryModalState
	modalWidth: number
	modalHeight: number
	offsetLeft: number
	offsetTop: number
}) => {
	const { contentWidth } = standardModalDims(modalWidth, modalHeight)
	const inputText = state.query.length > 0 ? state.query : "owner/name or GitHub URL"

	return (
		<StandardModal
			left={offsetLeft}
			top={offsetTop}
			width={modalWidth}
			height={modalHeight}
			title="Open Repository"
			headerRight={{ text: "owner/name" }}
			subtitle={
				<TextLine>
					<span fg={colors.count}>› </span>
					<span fg={state.query.length > 0 ? colors.text : colors.muted}>{fitCell(inputText, Math.max(1, contentWidth - 2))}</span>
				</TextLine>
			}
			bodyPadding={1}
			footer={
				<HintRow
					items={[
						{ key: "enter", label: "open" },
						{ key: "ctrl-u", label: "clear" },
						{ key: "ctrl-w", label: "word" },
						{ key: "esc", label: "cancel" },
					]}
				/>
			}
		>
			{state.error ? (
				<PlainLine text={fitCell(state.error, contentWidth)} fg={colors.error} />
			) : (
				<PlainLine text={fitCell("Switches to the selected repository view.", contentWidth)} fg={colors.muted} />
			)}
		</StandardModal>
	)
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
	const { bodyHeight: maxVisible, rowWidth } = searchModalDims(modalWidth, modalHeight)
	const currentNames = new Set(currentLabels.map((l) => l.name.toLowerCase()))
	const filtered = filterLabels(state.availableLabels, state.query)
	const labelMessageTopRows = Math.max(0, Math.floor((maxVisible - 1) / 2))
	const labelMessageBottomRows = Math.max(0, maxVisible - labelMessageTopRows - 1)
	const selectedIndex = filtered.length === 0 ? 0 : Math.max(0, Math.min(state.selectedIndex, filtered.length - 1))
	const scrollStart = Math.min(Math.max(0, filtered.length - maxVisible), Math.max(0, selectedIndex - maxVisible + 1))
	const visibleLabels = filtered.slice(scrollStart, scrollStart + maxVisible)
	const title = state.repository ? `Labels  ${shortRepoName(state.repository)}` : "Labels"
	const countText = state.loading ? "loading" : `${filtered.length}/${state.availableLabels.length}`

	return (
		<SearchModalFrame
			left={offsetLeft}
			top={offsetTop}
			width={modalWidth}
			height={modalHeight}
			title={title}
			query={state.query}
			placeholder="filter labels"
			countText={countText}
			footer={
				<TextLine>
					<span fg={colors.count}>↑↓</span>
					<span fg={colors.muted}> move </span>
					<span fg={colors.count}>esc</span>
					<span fg={colors.muted}> close</span>
					{filtered.length > maxVisible ? (
						<span fg={colors.muted}>
							{" "}
							{selectedIndex + 1}/{filtered.length}
						</span>
					) : null}
				</TextLine>
			}
		>
			{state.loading ? (
				<>
					<Filler rows={labelMessageTopRows} prefix="top" />
					<PlainLine text={centerCell(`${loadingIndicator} Loading labels`, rowWidth)} fg={colors.muted} />
					<Filler rows={labelMessageBottomRows} prefix="bottom" />
				</>
			) : visibleLabels.length === 0 ? (
				<>
					<Filler rows={labelMessageTopRows} prefix="top" />
					<PlainLine text={centerCell(state.query.length > 0 ? "No matching labels" : "No labels found", rowWidth)} fg={colors.muted} />
					<Filler rows={labelMessageBottomRows} prefix="bottom" />
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
								<span bg={labelColor(label)}> </span>
								<span> {fitCell(label.name, nameWidth)}</span>
							</TextLine>
						</box>
					)
				})
			)}
		</SearchModalFrame>
	)
}

export const ChangedFilesModal = ({
	state,
	results,
	totalCount,
	modalWidth,
	modalHeight,
	offsetLeft,
	offsetTop,
}: {
	state: ChangedFilesModalState
	results: readonly ChangedFileSearchResult[]
	totalCount: number
	modalWidth: number
	modalHeight: number
	offsetLeft: number
	offsetTop: number
}) => {
	const { bodyHeight: maxVisible, rowWidth } = searchModalDims(modalWidth, modalHeight)
	const filtered = results
	const selectedIndex = filtered.length === 0 ? 0 : Math.max(0, Math.min(state.selectedIndex, filtered.length - 1))
	const scrollStart = Math.min(Math.max(0, filtered.length - maxVisible), Math.max(0, selectedIndex - maxVisible + 1))
	const visibleFiles = filtered.slice(scrollStart, scrollStart + maxVisible)
	const title = "Files"
	const countText = `${filtered.length}/${totalCount}`
	const messageTopRows = Math.max(0, Math.floor((maxVisible - 1) / 2))
	const messageBottomRows = Math.max(0, maxVisible - messageTopRows - 1)

	return (
		<SearchModalFrame
			left={offsetLeft}
			top={offsetTop}
			width={modalWidth}
			height={modalHeight}
			title={title}
			query={state.query}
			placeholder="Filter"
			countText={countText}
			footer={
				<HintRow
					items={[
						{ key: "↑↓", label: "move" },
						{ key: "enter", label: "jump" },
						{ key: "esc", label: "close" },
					]}
				/>
			}
		>
			{visibleFiles.length === 0 ? (
				<>
					<Filler rows={messageTopRows} prefix="top" />
					<PlainLine text={centerCell(state.query.length > 0 ? "No matching files" : "No changed files", rowWidth)} fg={colors.muted} />
					<Filler rows={messageBottomRows} prefix="bottom" />
				</>
			) : (
				visibleFiles.map((entry, index) => {
					const actualIndex = scrollStart + index
					const isSelected = actualIndex === selectedIndex
					const stats = diffFileStatsText(diffFileStats(entry.file)) || "0"
					const statsWidth = Math.min(10, Math.max(3, stats.length))
					const nameWidth = Math.max(1, rowWidth - statsWidth)
					return (
						<TextLine
							key={`${entry.index}:${entry.file.name}`}
							width={rowWidth}
							bg={isSelected ? colors.selectedBg : undefined}
							fg={isSelected ? colors.selectedText : colors.text}
						>
							<MatchedCell text={entry.file.name} width={nameWidth} query={state.query} matchIndexes={entry.matchIndexes} />
							<span fg={colors.muted}>{fitCell(stats, statsWidth, "right")}</span>
						</TextLine>
					)
				})
			)}
		</SearchModalFrame>
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
	const { contentWidth, bodyHeight: optionAreaHeight, rowWidth } = standardModalDims(modalWidth, modalHeight)
	const options = availableMergeActions(state.info)
	const selectedIndex = options.length === 0 ? 0 : Math.max(0, Math.min(state.selectedIndex, options.length - 1))
	const title = state.info ? `Merge  #${state.info.number}` : state.number ? `Merge  #${state.number}` : "Merge"
	const rightText = state.running ? `${loadingIndicator} running` : state.loading ? `${loadingIndicator} loading` : state.info?.autoMergeEnabled ? "auto on" : "manual"
	const repo = state.info?.repository ?? state.repository
	const statusLine = state.info
		? `${shortRepoName(state.info.repository)}  ${state.info.mergeable}  ${state.info.reviewStatus}  ${state.info.checkSummary ?? state.info.checkStatus}`
		: repo
			? shortRepoName(repo)
			: ""
	const optionRows = Math.max(1, Math.floor(optionAreaHeight / 2))
	const scrollStart = Math.min(
		Math.max(0, options.length - optionRows),
		Math.max(0, selectedIndex - optionRows + 1),
	)
	const visibleOptions = options.slice(scrollStart, scrollStart + optionRows)
	const loadingTopRows = Math.max(0, Math.floor((optionAreaHeight - 1) / 2))
	const loadingBottomRows = Math.max(0, optionAreaHeight - loadingTopRows - 1)

	return (
		<StandardModal
			left={offsetLeft}
			top={offsetTop}
			width={modalWidth}
			height={modalHeight}
			title={title}
			headerRight={{ text: rightText, pending: state.running || state.loading }}
			subtitle={<PlainLine text={fitCell(statusLine, contentWidth)} fg={colors.muted} />}
			footer={
				<HintRow
					items={[
						{ key: "↑↓", label: "move" },
						{ key: "enter", label: "confirm" },
						{ key: "esc", label: "close" },
						{ key: `${selectedIndex + 1}/${options.length}`, label: "", when: options.length > optionRows, keyFg: colors.muted },
					]}
				/>
			}
		>
			{state.loading ? (
				<>
					<Filler rows={loadingTopRows} prefix="top" />
					<PlainLine text={centerCell(`${loadingIndicator} Loading merge status`, rowWidth)} fg={colors.muted} />
					<Filler rows={loadingBottomRows} prefix="bottom" />
				</>
			) : state.error ? (
				<PlainLine text={centerCell(state.error, rowWidth)} fg={colors.error} />
			) : visibleOptions.length === 0 ? (
				<PlainLine text={centerCell(mergeUnavailableReason(state.info), rowWidth)} fg={colors.muted} />
			) : (
				visibleOptions.map((option, index) => {
					const actualIndex = scrollStart + index
					const isSelected = actualIndex === selectedIndex
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
		</StandardModal>
	)
}

export const CloseModal = ({
	state,
	modalWidth,
	modalHeight,
	offsetLeft,
	offsetTop,
	loadingIndicator,
}: {
	state: CloseModalState
	modalWidth: number
	modalHeight: number
	offsetLeft: number
	offsetTop: number
	loadingIndicator: string
}) => {
	const { contentWidth, bodyHeight } = standardModalDims(modalWidth, modalHeight)
	const title = state.number ? `Close  #${state.number}` : "Close pull request"
	const rightText = state.running ? `${loadingIndicator} closing` : "confirm"
	const repo = state.repository ? shortRepoName(state.repository) : ""
	const titleLines = [fitCell(repo, contentWidth), fitCell(state.title, contentWidth)]
	const topRows = Math.max(0, Math.floor((bodyHeight - titleLines.length - 2) / 2))
	const bottomRows = Math.max(0, bodyHeight - topRows - titleLines.length - 2)

	return (
		<StandardModal
			left={offsetLeft}
			top={offsetTop}
			width={modalWidth}
			height={modalHeight}
			title={title}
			titleFg={colors.error}
			headerRight={{ text: rightText, pending: state.running }}
			subtitle={<PlainLine text={fitCell("This will close the pull request without merging it.", contentWidth)} fg={colors.muted} />}
			bodyPadding={1}
			footer={
				<HintRow
					items={[
						{ key: "enter", label: "close" },
						{ key: "esc", label: "cancel" },
					]}
				/>
			}
		>
			{state.error ? (
				<PlainLine text={fitCell(state.error, contentWidth)} fg={colors.error} />
			) : (
				<>
					<Filler rows={topRows} prefix="top" />
					<PlainLine text={titleLines[0]!} fg={colors.muted} />
					<PlainLine text={titleLines[1]!} fg={colors.text} bold />
					<Filler rows={bottomRows} prefix="bottom" />
				</>
			)}
		</StandardModal>
	)
}

export const CommentModal = ({
	state,
	anchorLabel,
	modalWidth,
	modalHeight,
	offsetLeft,
	offsetTop,
}: {
	state: CommentModalState
	anchorLabel: string
	modalWidth: number
	modalHeight: number
	offsetLeft: number
	offsetTop: number
}) => {
	const { contentWidth, bodyHeight } = standardModalDims(modalWidth, modalHeight)
	const title = "Comment"
	const editorHeight = Math.max(1, bodyHeight - (state.error ? 1 : 0))
	const lineRanges = commentEditorLines(state.body)
	const cursor = clampCursor(state.body, state.cursor)
	const cursorLineIndex = cursorLineIndexForLines(lineRanges, cursor)
	const visibleStart = Math.min(Math.max(0, lineRanges.length - editorHeight), Math.max(0, cursorLineIndex - editorHeight + 1))
	const visibleLines = lineRanges.slice(visibleStart, visibleStart + editorHeight)
	const renderEditorLine = (line: { readonly text: string; readonly start: number; readonly end: number }, index: number) => {
		const lineIndex = visibleStart + index
		const isCursorLine = lineIndex === cursorLineIndex
		const cursorColumn = Math.max(0, Math.min(cursor - line.start, line.text.length))
		const viewStart = isCursorLine ? Math.max(0, cursorColumn - contentWidth + 1) : 0
		const visibleText = line.text.slice(viewStart, viewStart + contentWidth)

		if (!isCursorLine) {
			return <PlainLine key={lineIndex} text={fitCell(visibleText, contentWidth)} fg={state.body.length > 0 ? colors.text : colors.muted} />
		}

		const cursorInView = cursorColumn - viewStart
		const before = visibleText.slice(0, cursorInView)
		const placeholder = state.body.length === 0 ? "Write a comment..." : ""
		const cursorChar = placeholder ? (placeholder[0] ?? " ") : (visibleText[cursorInView] ?? " ")
		const after = placeholder ? placeholder.slice(1) : visibleText.slice(cursorInView + 1)

		return (
			<TextLine key={lineIndex}>
				{before ? <span fg={colors.text}>{before}</span> : null}
				<span bg={colors.accent} fg={colors.background}>
					{cursorChar}
				</span>
				{after ? <span fg={placeholder ? colors.muted : colors.text}>{after}</span> : null}
			</TextLine>
		)
	}

	return (
		<StandardModal
			left={offsetLeft}
			top={offsetTop}
			width={modalWidth}
			height={modalHeight}
			title={title}
			headerRight={{ text: "enter save" }}
			subtitle={<PlainLine text={fitCell(anchorLabel, contentWidth)} fg={colors.muted} />}
			bodyPadding={1}
			footer={
				<HintRow
					items={[
						{ key: "enter", label: "save" },
						{ key: "shift-enter", label: "newline" },
						{ key: "esc", label: "cancel" },
					]}
				/>
			}
		>
			{state.error ? <PlainLine text={fitCell(state.error, contentWidth)} fg={colors.error} /> : null}
			{visibleLines.map(renderEditorLine)}
		</StandardModal>
	)
}

export const SubmitReviewModal = ({
	state,
	modalWidth,
	modalHeight,
	offsetLeft,
	offsetTop,
}: {
	state: SubmitReviewModalState
	modalWidth: number
	modalHeight: number
	offsetLeft: number
	offsetTop: number
}) => {
	const { innerWidth, contentWidth } = standardModalDims(modalWidth, modalHeight)
	const selectedIndex = Math.max(0, Math.min(state.selectedIndex, submitReviewOptions.length - 1))
	const headerRows = 1
	const actionHeight = submitReviewOptions.length
	const errorHeight = state.error ? 1 : 0
	const footerRows = 1
	const dividerRows = 3
	const frameBorderRows = 2
	const editorHeight = Math.max(1, modalHeight - frameBorderRows - headerRows - actionHeight - errorHeight - footerRows - dividerRows)
	const actionDividerRow = headerRows
	const editorDividerRow = headerRows + 1 + actionHeight
	const footerDividerRow = editorDividerRow + 1 + errorHeight + editorHeight
	const lineRanges = commentEditorLines(state.body)
	const cursor = clampCursor(state.body, state.cursor)
	const cursorLineIndex = cursorLineIndexForLines(lineRanges, cursor)
	const visibleStart = Math.min(Math.max(0, lineRanges.length - editorHeight), Math.max(0, cursorLineIndex - editorHeight + 1))
	const visibleLines = lineRanges.slice(visibleStart, visibleStart + editorHeight)
	const title = "Submit review"
	const editorFocused = state.focus === "body"
	const renderEditorLine = (line: { readonly text: string; readonly start: number; readonly end: number }, index: number) => {
		const lineIndex = visibleStart + index
		const isCursorLine = lineIndex === cursorLineIndex
		const cursorColumn = Math.max(0, Math.min(cursor - line.start, line.text.length))
		const viewStart = editorFocused && isCursorLine ? Math.max(0, cursorColumn - contentWidth + 1) : 0
		const visibleText = line.text.slice(viewStart, viewStart + contentWidth)

		if (!editorFocused || !isCursorLine) {
			if (state.body.length === 0 && lineIndex === 0) {
				return <PlainLine key={lineIndex} text={fitCell("Optional review summary...", contentWidth)} fg={colors.muted} />
			}
			return <PlainLine key={lineIndex} text={fitCell(visibleText, contentWidth)} fg={state.body.length > 0 ? colors.text : colors.muted} />
		}

		const cursorInView = cursorColumn - viewStart
		const before = visibleText.slice(0, cursorInView)
		const placeholder = state.body.length === 0 ? "Optional review summary..." : ""
		const cursorChar = placeholder ? (placeholder[0] ?? " ") : (visibleText[cursorInView] ?? " ")
		const after = placeholder ? placeholder.slice(1) : visibleText.slice(cursorInView + 1)

		return (
			<TextLine key={lineIndex}>
				{before ? <span fg={colors.text}>{before}</span> : null}
				<span bg={colors.accent} fg={colors.background}>
					{cursorChar}
				</span>
				{after ? <span fg={placeholder ? colors.muted : colors.text}>{after}</span> : null}
			</TextLine>
		)
	}

	return (
		<ModalFrame left={offsetLeft} top={offsetTop} width={modalWidth} height={modalHeight} junctionRows={[actionDividerRow, editorDividerRow, footerDividerRow]}>
			<PaddedRow>
				<TextLine>
					<span fg={colors.accent} attributes={TextAttributes.BOLD}>
						{title}
					</span>
				</TextLine>
			</PaddedRow>
			<Divider width={innerWidth} />
			<box height={actionHeight} flexDirection="column" paddingLeft={1} paddingRight={1}>
				{submitReviewOptions.map((option, index) => {
					const isSelected = index === selectedIndex
					const isFocusedSelection = isSelected && state.focus === "action"
					const titleWidth = Math.min(18, Math.max(8, contentWidth - 8))
					const descriptionWidth = Math.max(1, contentWidth - titleWidth - 4)
					return (
						<TextLine key={option.event} bg={isFocusedSelection ? colors.selectedBg : undefined} fg={isFocusedSelection ? colors.selectedText : colors.text}>
							<span fg={submitReviewEventColor(option.event)}>{isFocusedSelection ? "›" : isSelected ? "✓" : " "}</span>
							<span> {fitCell(option.title, titleWidth)}</span>
							<span fg={isFocusedSelection ? colors.selectedText : colors.muted}>{fitCell(option.description, descriptionWidth)}</span>
						</TextLine>
					)
				})}
			</box>
			<Divider width={innerWidth} />
			{state.error ? (
				<PaddedRow>
					<PlainLine text={fitCell(state.error, contentWidth)} fg={colors.error} />
				</PaddedRow>
			) : null}
			<box height={editorHeight} flexDirection="column" paddingLeft={1} paddingRight={1}>
				{visibleLines.map(renderEditorLine)}
			</box>
			<Divider width={innerWidth} />
			<PaddedRow>
				<HintRow
					items={
						editorFocused
							? [
									{ key: "shift-enter", label: "newline" },
									{ key: "enter", label: "submit" },
									{ key: "esc", label: "actions" },
								]
							: [
									{ key: "↑↓", label: "action" },
									{ key: "enter", label: "summary" },
									{ key: "esc", label: "cancel" },
								]
					}
				/>
			</PaddedRow>
		</ModalFrame>
	)
}

const commentThreadRows = (comments: readonly PullRequestReviewComment[], width: number): readonly CommentDisplayLine[] =>
	comments.flatMap((comment) => commentDisplayRows({ item: comment, width }))

export const CommentThreadModal = ({
	state,
	anchorLabel,
	comments,
	modalWidth,
	modalHeight,
	offsetLeft,
	offsetTop,
}: {
	state: CommentThreadModalState
	anchorLabel: string
	comments: readonly PullRequestReviewComment[]
	modalWidth: number
	modalHeight: number
	offsetLeft: number
	offsetTop: number
}) => {
	const { contentWidth, bodyHeight } = standardModalDims(modalWidth, modalHeight)
	const title = "Thread"
	const countText = comments.length === 1 ? "1 comment" : `${comments.length} comments`
	const rows = commentThreadRows(comments, contentWidth)
	const maxScroll = Math.max(0, rows.length - bodyHeight)
	const scrollOffset = Math.max(0, Math.min(state.scrollOffset, maxScroll))
	const visibleRows = rows.slice(scrollOffset, scrollOffset + bodyHeight)

	return (
		<StandardModal
			left={offsetLeft}
			top={offsetTop}
			width={modalWidth}
			height={modalHeight}
			title={title}
			headerRight={{ text: countText }}
			subtitle={<PlainLine text={fitCell(anchorLabel, contentWidth)} fg={colors.muted} />}
			bodyPadding={1}
			footer={
				<HintRow
					items={[
						{ key: "↑↓", label: "scroll" },
						{ key: "enter", label: "comment" },
						{ key: "esc", label: "close" },
					]}
				/>
			}
		>
			{visibleRows.length === 0 ? (
				<PlainLine text={fitCell("No comments on this line.", contentWidth)} fg={colors.muted} />
			) : (
				visibleRows.map((row) => <CommentSegmentsLine key={row.key} segments={row.segments} />)
			)}
		</StandardModal>
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
	const { contentWidth, bodyHeight: maxVisible, rowWidth } = standardModalDims(modalWidth, modalHeight)
	const filteredThemes = filterThemeDefinitions(state.query, state.tone)
	const activeIndex = filteredThemes.findIndex((theme) => theme.id === activeThemeId)
	const selectedIndex = Math.max(0, activeIndex)
	const selectedTheme = filteredThemes[selectedIndex] ?? themeDefinitions.find((theme) => theme.id === activeThemeId) ?? themeDefinitions[0]!
	const scrollStart = Math.min(Math.max(0, filteredThemes.length - maxVisible), Math.max(0, selectedIndex - maxVisible + 1))
	const visibleThemes = filteredThemes.slice(scrollStart, scrollStart + maxVisible)
	const countText = `${filteredThemes.length === 0 ? 0 : selectedIndex + 1}/${filteredThemes.length}`
	const subtitleText = state.filterMode ? (state.query.length > 0 ? state.query : "type to filter themes") : selectedTheme.description
	const queryPrefix = "/ "
	const subtitleWidth = Math.max(1, contentWidth - (state.filterMode ? queryPrefix.length : 0))
	const messageTopRows = Math.max(0, Math.floor((maxVisible - 1) / 2))
	const messageBottomRows = Math.max(0, maxVisible - messageTopRows - 1)
	const toneLabel = state.tone === "dark" ? "Dark" : "Light"
	const nextToneLabel = oppositeThemeTone(state.tone)

	return (
		<StandardModal
			left={offsetLeft}
			top={offsetTop}
			width={modalWidth}
			height={modalHeight}
			title={`${toneLabel} Themes`}
			headerRight={{ text: countText }}
			subtitle={
				state.filterMode ? (
					<TextLine>
						<span fg={colors.count}>{queryPrefix}</span>
						<span fg={state.query.length > 0 ? colors.text : colors.muted}>{fitCell(subtitleText, subtitleWidth)}</span>
					</TextLine>
				) : (
					<PlainLine text={fitCell(subtitleText, subtitleWidth)} fg={colors.muted} />
				)
			}
			footer={
				<HintRow
					items={[
						{ key: "tab", label: `${nextToneLabel} mode` },
						{ key: "enter", label: "select" },
						{ key: "esc", label: "cancel" },
					]}
				/>
			}
		>
			{visibleThemes.length === 0 ? (
				<>
					<Filler rows={messageTopRows} prefix="top" />
					<PlainLine text={centerCell("No matching themes", rowWidth)} fg={colors.muted} />
					<Filler rows={messageBottomRows} prefix="bottom" />
				</>
			) : (
				visibleThemes.map((theme, index) => {
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
							<span bg={theme.colors.modalBackground}> </span>
							<span bg={theme.colors.accent}> </span>
							<span bg={theme.colors.status.passing}> </span>
							<span bg={theme.colors.status.failing}> </span>
							<span bg={theme.colors.status.review}> </span>
						</TextLine>
					)
				})
			)}
		</StandardModal>
	)
}
