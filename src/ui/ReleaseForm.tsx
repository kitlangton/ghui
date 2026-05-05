import { TextAttributes } from "@opentui/core"
import { type CommentEditorValue, commentEditorLines, cursorLineIndexForLines } from "./commentEditor.js"
import { colors } from "./colors.js"
import type { ReleaseFormFocus, ReleaseFormState } from "./modals.js"
import { Divider, fitCell, HintRow, ModalFrame, PaddedRow, PlainLine, TextLine } from "./primitives.js"
import { shortRepoName } from "./pullRequests.js"

interface ReleaseFormProps {
	readonly state: ReleaseFormState
	readonly modalWidth: number
	readonly modalHeight: number
	readonly offsetLeft: number
	readonly offsetTop: number
	readonly loadingIndicator: string
}

const labelWidth = 13
const bodyRowCount = 8

const SingleLineRow = ({ label, value, placeholder, focused, rowWidth }: { label: string; value: string; placeholder: string; focused: boolean; rowWidth: number }) => {
	const labelText = fitCell(label, labelWidth)
	const fieldWidth = Math.max(8, rowWidth - labelWidth - 4)
	const showPlaceholder = value.length === 0
	const text = showPlaceholder ? placeholder : value
	const cursorChar = focused ? "▏" : ""
	const inner = `${text}${focused ? cursorChar : ""}`
	const fieldText = fitCell(inner, fieldWidth)
	return (
		<TextLine width={rowWidth}>
			<span fg={focused ? colors.accent : colors.muted}>{labelText}</span>
			<span fg={focused ? colors.accent : colors.muted}> {focused ? "›" : " "} </span>
			{focused ? (
				<span fg={showPlaceholder ? colors.muted : colors.text} bg={colors.selectedBg}>
					{fieldText}
				</span>
			) : (
				<span fg={showPlaceholder ? colors.muted : colors.text}>{fieldText}</span>
			)}
		</TextLine>
	)
}

const PrereleaseRow = ({ checked, focused, rowWidth }: { checked: boolean; focused: boolean; rowWidth: number }) => {
	const labelText = fitCell("Pre-release", labelWidth)
	const box = checked ? "[x]" : "[ ]"
	const inner = ` ${box}  Mark as a pre-release`
	const fieldWidth = Math.max(8, rowWidth - labelWidth - 4)
	return (
		<TextLine width={rowWidth}>
			<span fg={focused ? colors.accent : colors.muted}>{labelText}</span>
			<span fg={focused ? colors.accent : colors.muted}> {focused ? "›" : " "} </span>
			{focused ? (
				<span fg={colors.selectedText} bg={colors.selectedBg}>
					{fitCell(inner, fieldWidth)}
				</span>
			) : (
				<span fg={colors.text}>{fitCell(inner, fieldWidth)}</span>
			)}
		</TextLine>
	)
}

const MakeLatestRow = ({ value, focused, rowWidth }: { value: ReleaseFormState["makeLatest"]; focused: boolean; rowWidth: number }) => {
	const labelText = fitCell("Latest", labelWidth)
	const options = [
		["true", "yes"],
		["false", "no"],
		["legacy", "auto"],
	] as const
	return (
		<TextLine width={rowWidth}>
			<span fg={focused ? colors.accent : colors.muted}>{labelText}</span>
			<span fg={focused ? colors.accent : colors.muted}> {focused ? "›" : " "} </span>
			{options.map(([key, display]) => {
				const selected = key === value
				const text = ` ${display} `
				if (selected && focused) {
					return (
						<span key={key} fg={colors.selectedText} bg={colors.selectedBg} attributes={TextAttributes.BOLD}>
							{text}
						</span>
					)
				}
				if (selected) {
					return (
						<span key={key} fg={colors.text} attributes={TextAttributes.BOLD}>
							{text}
						</span>
					)
				}
				return (
					<span key={key} fg={colors.muted}>
						{text}
					</span>
				)
			})}
		</TextLine>
	)
}

const BodyEditor = ({ value, focused, rowWidth }: { value: CommentEditorValue; focused: boolean; rowWidth: number }) => {
	const lines = commentEditorLines(value.body)
	const cursorLineIndex = focused ? cursorLineIndexForLines(lines, value.cursor) : -1
	const textWidth = Math.max(8, rowWidth - 2)

	const visible = lines.slice(Math.max(0, lines.length - bodyRowCount))
	const offset = lines.length - visible.length

	const rendered: React.ReactNode[] = []
	for (let i = 0; i < bodyRowCount; i++) {
		const lineIndex = offset + i
		const line = visible[i]
		if (line === undefined) {
			rendered.push(<PlainLine key={`body-pad-${i}`} text={fitCell("", rowWidth)} />)
			continue
		}
		const isCursorLine = lineIndex === cursorLineIndex
		const cursorRel = isCursorLine ? Math.max(0, value.cursor - line.start) : -1
		if (!isCursorLine) {
			rendered.push(<PlainLine key={`body-${lineIndex}`} text={fitCell(`  ${line.text}`, rowWidth)} fg={colors.text} />)
			continue
		}
		const before = line.text.slice(0, cursorRel)
		const after = line.text.slice(cursorRel)
		const beforePad = `  ${before}`
		const trail = fitCell(after, Math.max(0, textWidth - beforePad.length + 2 - 1))
		rendered.push(
			<TextLine key={`body-${lineIndex}`} width={rowWidth}>
				<span fg={colors.text}>{beforePad}</span>
				<span fg={colors.background} bg={colors.text}>
					{after.length > 0 ? after.slice(0, 1) : " "}
				</span>
				<span fg={colors.text}>{after.slice(1) + " ".repeat(Math.max(0, trail.length - after.length + 1))}</span>
			</TextLine>,
		)
	}
	return (
		<>
			<TextLine width={rowWidth}>
				<span fg={focused ? colors.accent : colors.muted}>{fitCell("Description", labelWidth)}</span>
				<span fg={focused ? colors.accent : colors.muted}> {focused ? "›" : " "} </span>
				<span fg={colors.muted}>{focused ? "↵ newline · arrows move · ctrl-↵ publish" : "tab to edit"}</span>
			</TextLine>
			{rendered}
		</>
	)
}

const focusOrder: readonly ReleaseFormFocus[] = ["tag", "target", "title", "body", "prerelease", "makeLatest"]

export const ReleaseForm = ({ state, modalWidth, modalHeight, offsetLeft, offsetTop, loadingIndicator }: ReleaseFormProps) => {
	const innerWidth = Math.max(20, modalWidth - 2)
	const rowWidth = innerWidth - 2
	const targetPlaceholder = state.target.length === 0 ? (state.defaultBranch ?? (state.defaultBranchLoading ? `${loadingIndicator} loading default branch…` : "main")) : ""
	const titlePlaceholder = state.tag.length > 0 ? state.tag : "Release title"

	// Header
	const repoText = shortRepoName(state.repository)
	const modeText = state.mode === "edit" ? "Edit release" : "New release"
	const subtitleText = `${repoText}${state.originalTagName ? ` · ${state.originalTagName}` : ""}`
	const headerRightText = state.submitting ? `${loadingIndicator} submitting…` : state.generatingNotes ? `${loadingIndicator} generating…` : ""

	const focusIndex = focusOrder.indexOf(state.focus)

	// Junction rows: title row 0, blank 1, divider 2, body header 3, body lines 4..(3+bodyRowCount), divider, prerelease, makeLatest, divider, footer.
	// Layout (heights):
	//   row 0 title bar
	//   row 1 subtitle
	//   row 2 divider
	//   row 3 tag
	//   row 4 target
	//   row 5 title
	//   row 6 divider
	//   row 7 body header
	//   rows 8..(7+bodyRowCount) body
	//   row 8+bodyRowCount divider
	//   row 9+bodyRowCount prerelease
	//   row 10+bodyRowCount makeLatest
	//   row 11+bodyRowCount divider
	//   row 12+bodyRowCount error / status
	//   row 13+bodyRowCount divider
	//   row 14+bodyRowCount footer
	const junctionRows = [2, 6, 8 + bodyRowCount, 11 + bodyRowCount, 13 + bodyRowCount]
	void focusIndex

	return (
		<ModalFrame left={offsetLeft} top={offsetTop} width={modalWidth} height={modalHeight} junctionRows={junctionRows}>
			<PaddedRow>
				<TextLine>
					<span fg={colors.accent} attributes={TextAttributes.BOLD}>
						{modeText}
					</span>
					{headerRightText.length > 0 ? (
						<>
							<span> </span>
							<span fg={colors.status.pending}>{headerRightText}</span>
						</>
					) : null}
				</TextLine>
			</PaddedRow>
			<PaddedRow>
				<TextLine>
					<span fg={colors.muted}>{fitCell(subtitleText, rowWidth)}</span>
				</TextLine>
			</PaddedRow>
			<Divider width={innerWidth} />

			<PaddedRow>
				<SingleLineRow label="Tag" value={state.tag} placeholder="v1.2.3" focused={state.focus === "tag"} rowWidth={rowWidth} />
			</PaddedRow>
			<PaddedRow>
				<SingleLineRow label="Target" value={state.target} placeholder={targetPlaceholder} focused={state.focus === "target"} rowWidth={rowWidth} />
			</PaddedRow>
			<PaddedRow>
				<SingleLineRow label="Title" value={state.title} placeholder={titlePlaceholder} focused={state.focus === "title"} rowWidth={rowWidth} />
			</PaddedRow>

			<Divider width={innerWidth} />

			<PaddedRow>
				<BodyEditor value={state.body} focused={state.focus === "body"} rowWidth={rowWidth} />
			</PaddedRow>

			<Divider width={innerWidth} />

			<PaddedRow>
				<PrereleaseRow checked={state.isPrerelease} focused={state.focus === "prerelease"} rowWidth={rowWidth} />
			</PaddedRow>
			<PaddedRow>
				<MakeLatestRow value={state.makeLatest} focused={state.focus === "makeLatest"} rowWidth={rowWidth} />
			</PaddedRow>

			<Divider width={innerWidth} />

			<PaddedRow>
				<TextLine>
					{state.error ? (
						<span fg={colors.error}>{fitCell(state.error, rowWidth)}</span>
					) : (
						<span fg={colors.muted}>
							{fitCell(state.mode === "edit" ? "Editing existing release. Tag changes update the release tag." : "Tab between fields. Tag is required.", rowWidth)}
						</span>
					)}
				</TextLine>
			</PaddedRow>

			<Divider width={innerWidth} />

			<PaddedRow>
				<HintRow
					items={[
						{ key: "tab", label: "next" },
						{ key: "ctrl-g", label: "notes" },
						{ key: "ctrl-s", label: "draft" },
						{ key: "ctrl-↵", label: state.mode === "edit" ? "save" : "publish" },
						{ key: "esc", label: "cancel" },
					]}
				/>
			</PaddedRow>
		</ModalFrame>
	)
}

export const releaseFormBodyRowCount = bodyRowCount
