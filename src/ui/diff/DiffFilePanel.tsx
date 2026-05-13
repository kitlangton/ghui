import { colors } from "../colors.js"
import { type DiffFilePatch, diffFileStats, diffFileStatsText } from "../diff.js"
import type { ChangedFileSearchResult } from "../modals/shared.js"
import { Divider, fitCell, MatchedCell, PaddedRow, PlainLine, TextLine } from "../primitives.js"

interface DiffFilePanelProps {
	readonly files: readonly DiffFilePatch[]
	readonly currentFileIndex: number
	readonly width: number
	readonly height: number
	readonly pickerActive: boolean
	readonly pickerQuery: string
	readonly pickerSelectedIndex: number
	readonly pickerResults: readonly ChangedFileSearchResult[]
}

// Docked left-rail file list for the diff full-view. Renders in two modes:
//
//   1. Passive — picker inactive. Shows every file, highlights the one the
//      diff is currently scrolled to.
//   2. Picker — picker active (changedFilesModalActive). Shows a query line
//      at the top, the filtered/scored result set, and tracks the picker's
//      own selection cursor.
//
// The component is presentational: the parent decides which mode to render
// by passing `pickerActive` + the matching slice of state.
export const DiffFilePanel = ({ files, currentFileIndex, width, height, pickerActive, pickerQuery, pickerSelectedIndex, pickerResults }: DiffFilePanelProps) => {
	const innerWidth = Math.max(8, width - 2)
	// Two header rows (title + divider) and, in picker mode, a query + divider
	// pair. Subtract them to find how many list rows we can paint.
	const overhead = pickerActive ? 4 : 2
	const visibleRows = Math.max(1, height - overhead)
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
					const matchedCellProps = row.matchIndexes ? { matchIndexes: row.matchIndexes } : {}
					const rowProps = isSelected ? { backgroundColor: colors.selectedBg } : {}
					return (
						<PaddedRow key={`${row.index}:${row.file.name}`} {...rowProps}>
							<TextLine width={innerWidth} bg={isSelected ? colors.selectedBg : undefined} fg={isSelected ? colors.selectedText : colors.text}>
								<MatchedCell text={row.file.name} width={nameWidth} query={pickerActive ? pickerQuery : ""} {...matchedCellProps} />
								<span fg={colors.muted}> {fitCell(stats, statsWidth, "right")}</span>
							</TextLine>
						</PaddedRow>
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
		</box>
	)
}
