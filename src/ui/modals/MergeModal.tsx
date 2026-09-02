import { TextAttributes } from "@opentui/core"
import { allowedMergeMethodList } from "../../domain.js"
import { getMergeKindDefinition, mergeKindRowTitle, visibleMergeKinds } from "../../mergeActions.js"
import { colors } from "../colors.js"
import { centerCell, Filler, fitCell, HintRow, PlainLine, standardModalDims, StandardModal, TextLine, TokenLine } from "../primitives.js"
import { buildStatusBadges, mergeUnavailableReason, MethodStripLine } from "./shared.js"
import type { MergeModalState } from "./types.js"

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
	const allowedMethods = state.allowedMethods
	const allowedMethodCount = allowedMethods ? allowedMergeMethodList(allowedMethods).length : 0
	const methodsLoaded = allowedMethods !== null
	const isLoading = state.loading || !methodsLoaded
	const showStrip = allowedMethodCount > 1
	const { rowWidth, bodyHeight: optionAreaHeight } = standardModalDims(modalWidth, modalHeight, showStrip)
	const kinds = visibleMergeKinds(state.info, allowedMethods, state.selectedMethod)
	const selectedIndex = kinds.length === 0 ? 0 : Math.max(0, Math.min(state.selectedIndex, kinds.length - 1))
	const title = state.info ? `Merge #${state.info.number}` : state.number ? `Merge #${state.number}` : "Merge"
	const rightText = state.running ? `${loadingIndicator} running` : isLoading ? `${loadingIndicator} loading` : state.info?.autoMergeEnabled ? "auto on" : "manual"
	const repo = state.info?.repository ?? state.repository
	const statusBadges = buildStatusBadges(state.info, repo)
	const optionRows = Math.max(1, Math.floor(optionAreaHeight / 2))
	const scrollStart = Math.min(Math.max(0, kinds.length - optionRows), Math.max(0, selectedIndex - optionRows + 1))
	const visibleOptions = kinds.slice(scrollStart, scrollStart + optionRows)
	const fromDraft = Boolean(state.info?.isDraft)
	const inConfirmMode = state.pendingConfirm !== null
	const messageTopRows = Math.max(0, Math.floor((optionAreaHeight - 1) / 2))
	const messageBottomRows = Math.max(0, optionAreaHeight - messageTopRows - 1)
	const canConfirm = kinds.length > 0 && !state.error && !isLoading
	const footerItems = inConfirmMode
		? [
				{ key: "enter", label: "confirm" },
				{ key: "esc", label: "back" },
			]
		: [
				{ key: "↑↓", label: "move", disabled: kinds.length === 0 },
				...(showStrip ? [{ key: "←→", label: "method" }] : []),
				{ key: "enter", label: "confirm", disabled: !canConfirm },
				{ key: "esc", label: "close" },
				{ key: `${selectedIndex + 1}/${kinds.length}`, label: "", when: kinds.length > optionRows, keyFg: colors.muted },
			]

	const renderCenteredMessage = (text: string, fg: string) => (
		<>
			<Filler rows={messageTopRows} prefix="top" />
			<PlainLine text={centerCell(text, rowWidth)} fg={fg} />
			<Filler rows={messageBottomRows} prefix="bottom" />
		</>
	)

	const renderCenteredLines = (lines: readonly { readonly text: string; readonly fg: string; readonly bold?: boolean }[]) => {
		const top = Math.max(0, Math.floor((optionAreaHeight - lines.length) / 2))
		const bottom = Math.max(0, optionAreaHeight - top - lines.length)
		return (
			<>
				<Filler rows={top} prefix="top" />
				{lines.map((line, idx) => (
					<TextLine key={idx}>
						<span fg={line.fg} attributes={line.bold ? TextAttributes.BOLD : 0}>
							{centerCell(line.text, rowWidth)}
						</span>
					</TextLine>
				))}
				<Filler rows={bottom} prefix="bottom" />
			</>
		)
	}

	const renderBody = () => {
		if (state.error) return renderCenteredMessage(state.error, colors.error)
		if (isLoading) return renderCenteredMessage(`${loadingIndicator} ${state.loading ? "Loading merge status" : "Loading merge methods"}`, colors.muted)
		if (state.pendingConfirm && state.info) {
			const kindDef = getMergeKindDefinition(state.pendingConfirm.kind, state.info.mergeQueueEnabled)
			const action = kindDef.title(state.pendingConfirm.method)
			const lowered = action.charAt(0).toLowerCase() + action.slice(1)
			return renderCenteredLines([
				{ text: `Mark #${state.info.number} ready for review`, fg: colors.text, bold: true },
				{ text: `and ${lowered}?`, fg: colors.text },
			])
		}
		if (visibleOptions.length === 0) return renderCenteredMessage(mergeUnavailableReason(state.info), colors.muted)
		return visibleOptions.map((kind, index) => {
			const actualIndex = scrollStart + index
			const isSelected = actualIndex === selectedIndex
			const titleColor = kind.danger ? colors.error : isSelected ? colors.selectedText : colors.text
			const cellWidth = Math.max(1, rowWidth - 1)
			const rowTitle = mergeKindRowTitle(kind, state.selectedMethod, fromDraft)
			return (
				<box key={kind.kind} height={2} flexDirection="column">
					<TextLine bg={isSelected ? colors.selectedBg : undefined}>
						<span fg={titleColor}> {fitCell(rowTitle, cellWidth)}</span>
					</TextLine>
					<TextLine bg={isSelected ? colors.selectedBg : undefined}>
						<span fg={colors.muted}> {fitCell(kind.description(state.selectedMethod), cellWidth)}</span>
					</TextLine>
				</box>
			)
		})
	}

	return (
		<StandardModal
			left={offsetLeft}
			top={offsetTop}
			width={modalWidth}
			height={modalHeight}
			title={title}
			headerRight={{ text: rightText, pending: state.running || isLoading }}
			subtitle={<TokenLine tokens={statusBadges} />}
			middleRow={showStrip && allowedMethods ? <MethodStripLine allowed={allowedMethods} selected={state.selectedMethod} /> : undefined}
			footer={<HintRow items={footerItems} />}
		>
			{renderBody()}
		</StandardModal>
	)
}
