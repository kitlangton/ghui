import { TextAttributes, type MouseEvent } from "@opentui/core"
import { useEffect, useMemo, useState } from "react"
import type { AppCommand } from "../commands.js"
import { clampCommandIndex } from "../commands.js"
import { colors } from "./colors.js"
import { scrollTopForVisibleLine } from "./diff.js"
import { centerCell, Filler, fitCell, HintRow, PlainLine, searchModalDims, SearchModalFrame, TextLine, trimCell } from "./primitives.js"

const scopeLabels = {
	Global: "App",
	View: "View",
	"Pull request": "Pull Request",
	Diff: "Diff",
	Comments: "Comments",
	Navigation: "Navigation",
	System: "System",
} as const satisfies Record<AppCommand["scope"], string>

export type CommandPaletteRow =
	| { readonly _tag: "section"; readonly scope: AppCommand["scope"] }
	| { readonly _tag: "spacer" }
	| { readonly _tag: "command"; readonly command: AppCommand; readonly commandIndex: number }

export const buildCommandPaletteRows = (commands: readonly AppCommand[]): readonly CommandPaletteRow[] => {
	const rows: CommandPaletteRow[] = []
	let previousScope: AppCommand["scope"] | null = null
	for (let commandIndex = 0; commandIndex < commands.length; commandIndex++) {
		const command = commands[commandIndex]!
		if (command.scope !== previousScope) {
			if (previousScope !== null) rows.push({ _tag: "spacer" })
			rows.push({ _tag: "section", scope: command.scope })
			previousScope = command.scope
		}
		rows.push({ _tag: "command", command, commandIndex })
	}
	return rows
}

export const commandPaletteSelectedRowIndex = (rows: readonly CommandPaletteRow[], selectedCommandIndex: number) =>
	Math.max(
		0,
		rows.findIndex((row) => row._tag === "command" && row.commandIndex === selectedCommandIndex),
	)

export const commandPaletteScrollTop = ({
	current,
	rowsLength,
	listHeight,
	selectedRowIndex,
}: {
	readonly current: number
	readonly rowsLength: number
	readonly listHeight: number
	readonly selectedRowIndex: number
}) => {
	if (rowsLength <= listHeight) return 0
	const maxScrollTop = Math.max(0, rowsLength - listHeight)
	const clampScrollTop = (value: number) => Math.max(0, Math.min(value, maxScrollTop))
	return clampScrollTop(scrollTopForVisibleLine(current, listHeight, selectedRowIndex, 0))
}

export const commandPaletteClampScrollTop = (rowsLength: number, listHeight: number, value: number) => Math.max(0, Math.min(value, Math.max(0, rowsLength - listHeight)))

export const CommandPalette = ({
	commands,
	query,
	selectedIndex,
	modalWidth,
	modalHeight,
	offsetLeft,
	offsetTop,
	onSelectCommandIndex,
	onRunCommand,
}: {
	commands: readonly AppCommand[]
	query: string
	selectedIndex: number
	modalWidth: number
	modalHeight: number
	offsetLeft: number
	offsetTop: number
	onSelectCommandIndex: (index: number) => void
	onRunCommand: (command: AppCommand) => void
}) => {
	const { bodyHeight: listHeight, rowWidth } = searchModalDims(modalWidth, modalHeight)
	const clampedIndex = clampCommandIndex(selectedIndex, commands)
	const [scrollTop, setScrollTop] = useState(0)
	const rows = useMemo(() => buildCommandPaletteRows(commands), [commands])
	const selectedRowIndex = commandPaletteSelectedRowIndex(rows, clampedIndex)
	const visibleRows = rows.slice(scrollTop, scrollTop + listHeight)
	const bottomPaddingRows = Math.max(0, listHeight - visibleRows.length)
	const countText = commands.length === 1 ? "1 command" : `${commands.length} commands`
	const emptyTopRows = Math.max(0, Math.floor((listHeight - 1) / 2))
	const emptyBottomRows = Math.max(0, listHeight - emptyTopRows - 1)
	const runCommandOnMouseDown = (command: AppCommand) => (event: MouseEvent) => {
		if (event.button !== 0) return
		event.preventDefault()
		event.stopPropagation()
		onRunCommand(command)
	}
	const selectCommandOnMouse = (commandIndex: number) => (event: MouseEvent) => {
		onSelectCommandIndex(commandIndex)
		event.stopPropagation()
	}
	const handleMouseScroll = (event: MouseEvent) => {
		if (!event.scroll || rows.length <= listHeight) return
		const delta = Math.max(1, Math.ceil(event.scroll.delta))
		const direction = event.scroll.direction === "down" || event.scroll.direction === "right" ? 1 : -1
		setScrollTop((current) => commandPaletteClampScrollTop(rows.length, listHeight, current + direction * delta))
		event.preventDefault()
		event.stopPropagation()
	}
	const content =
		rows.length === 0 ? (
			<>
				<Filler rows={emptyTopRows} prefix="top" />
				<PlainLine text={centerCell("No matching command", rowWidth)} fg={colors.muted} />
				<Filler rows={emptyBottomRows} prefix="bottom" />
			</>
		) : (
			<>
				{visibleRows.map((row, index) => {
					const rowIndex = scrollTop + index
					if (row._tag === "spacer") {
						return <PlainLine key={`spacer-${rowIndex}`} text="" />
					}
					if (row._tag === "section") {
						return <PlainLine key={`section-${row.scope}-${rowIndex}`} text={fitCell(`  ${scopeLabels[row.scope].toUpperCase()}`, rowWidth)} fg={colors.muted} />
					}

					const { command, commandIndex } = row
					const isSelected = commandIndex === clampedIndex
					const shortcut = command.shortcut ? trimCell(command.shortcut, 16) : ""
					const shortcutWidth = shortcut.length === 0 ? 0 : Math.min(18, Math.max(6, shortcut.length + 1))
					const trailingPadding = shortcut.length === 0 ? 0 : 1
					// Layout: "▸ " (2) + title + "  " (2) + subtitle + filler + shortcut + " " (1)
					const SELECTOR_WIDTH = 2
					const titleAvailable = Math.max(8, rowWidth - SELECTOR_WIDTH - shortcutWidth - trailingPadding)
					const titleText = trimCell(command.title, Math.min(titleAvailable, 36))
					const subtitleSpace = Math.max(0, titleAvailable - titleText.length - 2)
					const subtitleText = command.subtitle && subtitleSpace > 4 ? trimCell(command.subtitle, subtitleSpace) : ""
					const fillerWidth = Math.max(0, titleAvailable - titleText.length - (subtitleText ? 2 + subtitleText.length : 0))

					return (
						<box
							key={command.id}
							height={1}
							onMouseDown={runCommandOnMouseDown(command)}
							onMouseMove={selectCommandOnMouse(commandIndex)}
							onMouseOver={selectCommandOnMouse(commandIndex)}
						>
							<TextLine width={rowWidth} bg={isSelected ? colors.selectedBg : undefined} fg={isSelected ? colors.selectedText : colors.text}>
								<span fg={isSelected ? colors.accent : colors.muted}>{isSelected ? "▸" : " "}</span>
								<span> </span>
								{isSelected ? <span attributes={TextAttributes.BOLD}>{titleText}</span> : <span>{titleText}</span>}
								{subtitleText ? <span fg={colors.muted}>{`  ${subtitleText}`}</span> : null}
								{fillerWidth > 0 ? <span>{" ".repeat(fillerWidth)}</span> : null}
								{shortcutWidth > 0 ? <span fg={colors.muted}>{fitCell(shortcut, shortcutWidth, "right")}</span> : null}
								{trailingPadding > 0 ? <span> </span> : null}
							</TextLine>
						</box>
					)
				})}
				<Filler rows={bottomPaddingRows} prefix="pad" />
			</>
		)
	useEffect(() => {
		setScrollTop((current) => commandPaletteScrollTop({ current, rowsLength: rows.length, listHeight, selectedRowIndex }))
	}, [listHeight, rows.length, selectedRowIndex])
	return (
		<SearchModalFrame
			left={offsetLeft}
			top={offsetTop}
			width={modalWidth}
			height={modalHeight}
			title="Commands"
			query={query}
			placeholder="Search"
			countText={countText}
			onBodyMouseScroll={handleMouseScroll}
			footer={
				<HintRow
					items={[
						{ key: "↑↓", label: "select" },
						{ key: "enter", label: "run" },
						{ key: "esc", label: "close" },
					]}
				/>
			}
		>
			{content}
		</SearchModalFrame>
	)
}
