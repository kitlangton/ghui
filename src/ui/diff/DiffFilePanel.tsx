import type { MouseEvent } from "@opentui/core"
import { colors } from "../colors.js"
import { type DiffFilePatch, diffFileStats, diffFileStatsText } from "../diff.js"
import type { ChangedFileSearchResult } from "../modals/shared.js"
import { Divider, fitCell, HintRow, MatchedCell, PaddedRow, PlainLine, TextLine } from "../primitives.js"

interface DiffFilePanelProps {
	readonly files: readonly DiffFilePatch[]
	readonly currentFileIndex: number
	readonly width: number
	readonly height: number
	readonly pickerActive: boolean
	readonly pickerQuery: string
	readonly pickerSelectedIndex: number
	readonly pickerResults: readonly ChangedFileSearchResult[]
	readonly onSelectFile: (index: number) => void
}

// Row indices (within the panel's own box) where the panel paints a
// horizontal divider. Exported so the parent surface can junction the
// vertical rail (`┤`) at those rows.
export const diffFilePanelDividerRows = (pickerActive: boolean): readonly number[] => (pickerActive ? [1, 3] : [1])

// Path truncation that preserves the basename and as many trailing segments
// as fit. `fitCell` head-truncates, which is wrong for paths — we'd see
// "packages/opencode/src…" and lose the actual filename. Instead, walk
// slash boundaries from the front and prepend "…/" once we find a tail
// short enough. As a last resort we head-trim the basename itself.
const truncatePath = (path: string, width: number): string => {
	if (width <= 0) return ""
	if (path.length <= width) return path
	const segments = path.split("/")
	for (let start = 1; start < segments.length; start++) {
		const tail = segments.slice(start).join("/")
		const candidate = `…/${tail}`
		if (candidate.length <= width) return candidate
	}
	const basename = segments[segments.length - 1] ?? path
	if (basename.length + 1 <= width) return `…${basename}`
	return `…${basename.slice(basename.length - (width - 1))}`
}

// Docked left-rail file list for the diff full-view. Renders in two modes:
//
//   1. Passive — picker inactive. Shows every file, highlights the one the
//      diff is currently scrolled to. Clicks jump the diff to that file.
//   2. Picker — picker active (changedFilesModalActive). Shows the query
//      query at the top, the filtered/scored result set, and tracks the
//      picker's own selection cursor. Clicks still jump.
//
// The component is presentational: the parent decides which mode to render
// by passing `pickerActive` + the matching slice of state.
export const DiffFilePanel = ({ files, currentFileIndex, width, height, pickerActive, pickerQuery, pickerSelectedIndex, pickerResults, onSelectFile }: DiffFilePanelProps) => {
	const innerWidth = Math.max(8, width - 2)
	// Rows used by chrome: title + divider, optional query + divider, hint row.
	const chromeRows = (pickerActive ? 4 : 2) + 1
	const visibleRows = Math.max(1, height - chromeRows)
	const totalCount = files.length
	const title = pickerActive ? `Files ${pickerResults.length}/${totalCount}` : `Files ${totalCount}`

	type PanelRow = { readonly file: DiffFilePatch; readonly index: number; readonly matchIndexes?: readonly number[] }
	const rows: readonly PanelRow[] = pickerActive
		? pickerResults.map((entry) => ({ file: entry.file, index: entry.index, matchIndexes: entry.matchIndexes }))
		: files.map((file, index) => ({ file, index }))

	const rawSelected = pickerActive ? pickerSelectedIndex : rows.findIndex((row) => row.index === currentFileIndex)
	const selectedRow = rows.length === 0 ? 0 : Math.max(0, Math.min(rawSelected, rows.length - 1))
	const scrollStart = Math.min(Math.max(0, rows.length - visibleRows), Math.max(0, selectedRow - Math.floor(visibleRows / 2)))
	const visibleSlice = rows.slice(scrollStart, scrollStart + visibleRows)
	const blankRows = Math.max(0, visibleRows - visibleSlice.length)

	const hintItems = pickerActive
		? [
				{ key: "↑↓", label: "move" },
				{ key: "↵", label: "open" },
				{ key: "⎋", label: "back" },
			]
		: [
				{ key: "[]", label: "prev/next" },
				{ key: "f", label: "filter" },
				{ key: "⇧F", label: "hide" },
			]

	return (
		<box width={width} height={height} flexDirection="column" backgroundColor={colors.background}>
			<PaddedRow>
				<PlainLine text={fitCell(title, innerWidth)} fg={colors.muted} />
			</PaddedRow>
			<Divider width={width} />
			{pickerActive ? (
				<>
					<PaddedRow>
						<TextLine width={innerWidth}>
							<span fg={colors.muted}>/ </span>
							<span fg={colors.text}>{fitCell(pickerQuery, Math.max(1, innerWidth - 2))}</span>
						</TextLine>
					</PaddedRow>
					<Divider width={width} />
				</>
			) : null}
			{rows.length === 0 ? (
				<PaddedRow>
					<PlainLine text={fitCell(pickerActive && pickerQuery.length > 0 ? "No matching files" : "No files", innerWidth)} fg={colors.muted} />
				</PaddedRow>
			) : (
				visibleSlice.map((row) => {
					const stats = diffFileStatsText(diffFileStats(row.file)) || "0"
					const statsWidth = Math.min(10, Math.max(3, stats.length))
					const nameWidth = Math.max(1, innerWidth - statsWidth - 1)
					const isSelected = row.index === (pickerActive ? rows[selectedRow]?.index : currentFileIndex)
					const handleMouseDown = function (this: unknown, event: MouseEvent) {
						if (event.button !== 0) return
						onSelectFile(row.index)
					}
					const truncated = truncatePath(row.file.name, nameWidth)
					// MatchedCell indices reference positions in the *original* string; if we
					// head-truncated, those indices no longer line up, so drop the highlight.
					const showMatches = Boolean(row.matchIndexes && truncated === row.file.name)
					return (
						<box
							key={`${row.index}:${row.file.name}`}
							flexDirection="row"
							height={1}
							paddingLeft={1}
							paddingRight={1}
							onMouseDown={handleMouseDown}
							backgroundColor={isSelected ? colors.selectedBg : colors.background}
						>
							<TextLine width={innerWidth} bg={isSelected ? colors.selectedBg : undefined} fg={isSelected ? colors.selectedText : colors.text}>
								{showMatches ? (
									<MatchedCell text={truncated} width={nameWidth} query={pickerQuery} matchIndexes={row.matchIndexes ?? []} />
								) : (
									<span fg={isSelected ? colors.selectedText : colors.text}>{fitCell(truncated, nameWidth)}</span>
								)}
								<span fg={colors.muted}> {fitCell(stats, statsWidth, "right")}</span>
							</TextLine>
						</box>
					)
				})
			)}
			{blankRows > 0
				? Array.from({ length: blankRows }, (_, index) => (
						<PaddedRow key={`diff-file-panel-blank-${index}`}>
							<PlainLine text={fitCell("", innerWidth)} />
						</PaddedRow>
					))
				: null}
			<box width={width} flexDirection="row" paddingLeft={1} paddingRight={1}>
				<HintRow items={hintItems} />
			</box>
		</box>
	)
}
