import { type MouseEvent, type ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useEffect, useRef } from "react"
import type { PullRequestItem, WorkflowRun, WorkflowRunDetails } from "../../domain.js"
import { colors } from "../colors.js"
import { centerCell, Divider, fitCell, Filler, PaddedRow, PlainLine, TextLine } from "../primitives.js"
import { shortRepoName } from "../pullRequests.js"
import { conclusionLabel, formatDuration, type RunDetailRow, type RunGlyphKind, runGlyph, runGlyphKind, stepRowKey } from "./runsRows.js"

// A selectable, clickable row whose background spans the full pane width (the
// box carries the width + bg; the inner TextLine adopts the same bg so text and
// fill match). Mouse-down selects; a second handler activates on the App side.
const RunRow = ({
	selected,
	width,
	onSelect,
	onActivate,
	children,
}: {
	selected: boolean
	width: number
	onSelect: () => void
	onActivate: () => void
	children: React.ReactNode
}) => (
	<box width={width} flexDirection="column" {...(selected ? { backgroundColor: colors.selectedBg } : {})} onMouseDown={selected ? onActivate : onSelect}>
		<TextLine width={width} bg={selected ? colors.selectedBg : undefined}>
			{children}
		</TextLine>
	</box>
)

type ResultState<A> = { readonly status: "loading" } | { readonly status: "error"; readonly message: string } | { readonly status: "ready"; readonly value: A }

const GLYPH_COLOR: Record<RunGlyphKind, string> = {
	success: colors.status.passing,
	failure: colors.status.failing,
	"in-progress": colors.status.pending,
	queued: colors.muted,
	cancelled: colors.status.failing,
	skipped: colors.muted,
	neutral: colors.muted,
}

const relativeAge = (date: Date | null, now: Date): string => {
	if (!date) return ""
	const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000))
	if (seconds < 60) return "just now"
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours}h ago`
	return `${Math.floor(hours / 24)}d ago`
}

export interface RunsPaneProps {
	readonly pullRequest: PullRequestItem
	readonly inDetail: boolean
	readonly runsState: ResultState<readonly WorkflowRun[]>
	readonly detailState: ResultState<WorkflowRunDetails> | null
	readonly runsSelection: number
	readonly detailSelection: number
	readonly detailRows: readonly RunDetailRow[]
	readonly inLog: boolean
	readonly logState: ResultState<string> | null
	readonly logLines: readonly string[]
	readonly logScroll: number
	readonly logTitle: string
	readonly onLogScroll: (delta: number) => void
	readonly onSelectRow: (index: number) => void
	readonly onActivateRow: (index: number) => void
	readonly contentWidth: number
	readonly height: number
	readonly loadingIndicator: string
	readonly showScrollbar: boolean
}

const HeaderLine = ({ left, right, width }: { left: string; right: string; width: number }) => {
	const gap = Math.max(1, width - left.length - right.length)
	return (
		<TextLine>
			<span fg={colors.accent} attributes={TextAttributes.BOLD}>
				{left}
			</span>
			<span>{" ".repeat(gap)}</span>
			<span fg={colors.muted}>{right}</span>
		</TextLine>
	)
}

const centeredMessage = (text: string, color: string, contentWidth: number, bodyHeight: number, key: string) => (
	<>
		<Filler rows={Math.max(0, Math.floor((bodyHeight - 1) / 2))} prefix={`${key}-top`} />
		<PlainLine text={centerCell(text, contentWidth)} fg={color} />
		<Filler rows={Math.max(0, Math.ceil((bodyHeight - 1) / 2))} prefix={`${key}-bottom`} />
	</>
)

const RunsList = ({
	runs,
	selection,
	paneWidth,
	now,
	onSelectRow,
	onActivateRow,
}: {
	runs: readonly WorkflowRun[]
	selection: number
	paneWidth: number
	now: Date
	onSelectRow: (index: number) => void
	onActivateRow: (index: number) => void
}) => {
	const nameWidth = Math.max(10, Math.floor(paneWidth * 0.34))
	const concWidth = 12
	const durWidth = 8
	const ageWidth = 10
	return (
		<box flexDirection="column">
			{runs.map((run, index) => {
				const selected = index === selection
				const reRun = run.attempt > 1 ? `re-run ${run.attempt}` : ""
				return (
					<RunRow key={run.id} selected={selected} width={paneWidth} onSelect={() => onSelectRow(index)} onActivate={() => onActivateRow(index)}>
						<span fg={selected ? colors.accent : colors.muted}>{selected ? "▸ " : "  "}</span>
						<span fg={GLYPH_COLOR[runGlyphKind(run.status, run.conclusion)]}>{runGlyph(run.status, run.conclusion)} </span>
						<span fg={colors.text} attributes={selected ? TextAttributes.BOLD : 0}>
							{fitCell(run.workflowName, nameWidth)}
						</span>
						<span fg={colors.muted}> {fitCell(conclusionLabel(run.status, run.conclusion), concWidth)}</span>
						<span fg={colors.muted}> {fitCell(formatDuration(run.startedAt, run.updatedAt, now), durWidth)}</span>
						<span fg={colors.muted}> {fitCell(relativeAge(run.createdAt, now), ageWidth)}</span>
						{reRun ? <span fg={colors.muted}> {reRun}</span> : null}
					</RunRow>
				)
			})}
		</box>
	)
}

const RunDetail = ({
	rows,
	selection,
	paneWidth,
	now,
	onSelectRow,
	onActivateRow,
}: {
	rows: readonly RunDetailRow[]
	selection: number
	paneWidth: number
	now: Date
	onSelectRow: (index: number) => void
	onActivateRow: (index: number) => void
}) => {
	const durWidth = 8
	return (
		<box flexDirection="column">
			{rows.map((row, index) => {
				const selected = index === selection
				const indent = row.kind === "step" ? "    " : ""
				const name = row.kind === "job" ? row.job.name : row.step.name
				const duration = row.kind === "job" ? formatDuration(row.job.startedAt, row.job.completedAt, now) : formatDuration(row.step.startedAt, row.step.completedAt, now)
				const nameWidth = Math.max(8, paneWidth - indent.length - 2 - durWidth - 1)
				return (
					<RunRow
						key={row.kind === "job" ? `job-${row.job.id}` : stepRowKey(row.job, row.step)}
						selected={selected}
						width={paneWidth}
						onSelect={() => onSelectRow(index)}
						onActivate={() => onActivateRow(index)}
					>
						<span fg={colors.muted}>{indent}</span>
						<span fg={GLYPH_COLOR[row.glyphKind]}>{row.glyph} </span>
						<span fg={row.kind === "job" ? colors.text : colors.muted} attributes={row.kind === "job" ? TextAttributes.BOLD : 0}>
							{fitCell(name, nameWidth)}
						</span>
						<span fg={colors.muted}>{fitCell(duration, durWidth, "right")}</span>
					</RunRow>
				)
			})}
		</box>
	)
}

const logLineColor = (line: string): string => {
	if (line.startsWith("##[error]")) return colors.error
	if (line.startsWith("##[warning]")) return colors.status.pending
	if (line.startsWith("##[group]") || line.startsWith("##[endgroup]")) return colors.accent
	return colors.text
}

const JobLog = ({ lines, scroll, height }: { lines: readonly string[]; scroll: number; height: number }) => (
	<box flexDirection="column">
		{lines.slice(scroll, scroll + height).map((line, index) => (
			<PlainLine key={scroll + index} text={` ${line}`} fg={logLineColor(line)} />
		))}
	</box>
)

export const PullRequestRunsPane = ({
	pullRequest,
	inDetail,
	runsState,
	detailState,
	runsSelection,
	detailSelection,
	detailRows,
	inLog,
	logState,
	logLines,
	logScroll,
	logTitle,
	onLogScroll,
	onSelectRow,
	onActivateRow,
	contentWidth,
	height,
	loadingIndicator,
	showScrollbar,
}: RunsPaneProps) => {
	const now = new Date()
	// Chrome above the body: header row + subline row + divider row = 3.
	const bodyHeight = Math.max(1, height - 3)
	// `contentWidth` is the padded text width (used inside PaddedRow); rows and the
	// divider span the full pane so the selected-row highlight reaches the border.
	const paneWidth = contentWidth + 2
	const title = `${shortRepoName(pullRequest.repository)} #${pullRequest.number}`

	const headerRight =
		inDetail && detailState?.status === "ready" ? `${detailState.value.event} → ${detailState.value.headBranch}` : `${pullRequest.headRefName} → ${pullRequest.baseRefName}`

	const subline = inLog
		? logTitle
		: inDetail && detailState?.status === "ready"
			? `${detailState.value.headSha.slice(0, 7)} · ${pullRequest.author}`
			: `runs for ${pullRequest.headRefOid.slice(0, 7)} · ${pullRequest.author}`

	// Every row is height 1, so row offset === selection index. Keep the focused
	// row inside the viewport on keyboard moves (j/k, ctrl-d/u, gg/G) — matching
	// the diff/comments panes.
	// The log view windows its own lines (`logScroll`), so it never needs the scrollbox.
	const rowCount = inLog ? 0 : inDetail ? detailRows.length : runsState.status === "ready" ? runsState.value.length : 0
	const selection = inDetail ? detailSelection : runsSelection
	const needsScroll = rowCount > bodyHeight
	const scrollboxRef = useRef<ScrollBoxRenderable | null>(null)
	useEffect(() => {
		if (!needsScroll) return
		const scrollbox = scrollboxRef.current
		if (!scrollbox) return
		const top = selection
		const bottom = selection + 1
		const viewportTop = scrollbox.scrollTop
		if (top < viewportTop) scrollbox.scrollTo({ x: 0, y: top })
		else if (bottom > viewportTop + bodyHeight) scrollbox.scrollTo({ x: 0, y: Math.max(0, bottom - bodyHeight) })
	}, [selection, needsScroll, bodyHeight, rowCount])

	// Wheel over the log: the log windows its own lines, so translate wheel
	// events into `logScroll` moves (same pattern as the command palette).
	const handleLogMouseScroll = (event: MouseEvent) => {
		if (!inLog || !event.scroll) return
		const delta = Math.max(1, Math.ceil(event.scroll.delta))
		const direction = event.scroll.direction === "down" || event.scroll.direction === "right" ? 1 : -1
		onLogScroll(direction * delta)
		event.preventDefault()
		event.stopPropagation()
	}

	const body = (() => {
		if (inLog) {
			if (!logState || logState.status === "loading") return centeredMessage(`${loadingIndicator} Loading log`, colors.muted, contentWidth, bodyHeight, "log-loading")
			if (logState.status === "error") return centeredMessage(logState.message, colors.error, contentWidth, bodyHeight, "log-error")
			if (logLines.length === 0) return centeredMessage("No log output", colors.muted, contentWidth, bodyHeight, "log-empty")
			return <JobLog lines={logLines} scroll={logScroll} height={bodyHeight} />
		}
		if (!inDetail) {
			if (runsState.status === "loading") return centeredMessage(`${loadingIndicator} Loading runs`, colors.muted, contentWidth, bodyHeight, "runs-loading")
			if (runsState.status === "error") return centeredMessage(runsState.message, colors.error, contentWidth, bodyHeight, "runs-error")
			if (runsState.value.length === 0) return centeredMessage("No workflow runs for this commit", colors.muted, contentWidth, bodyHeight, "no-runs")
			return <RunsList runs={runsState.value} selection={runsSelection} paneWidth={paneWidth} now={now} onSelectRow={onSelectRow} onActivateRow={onActivateRow} />
		}
		if (!detailState || detailState.status === "loading") return centeredMessage(`${loadingIndicator} Loading run`, colors.muted, contentWidth, bodyHeight, "run-loading")
		if (detailState.status === "error") return centeredMessage(detailState.message, colors.error, contentWidth, bodyHeight, "run-error")
		return <RunDetail rows={detailRows} selection={detailSelection} paneWidth={paneWidth} now={now} onSelectRow={onSelectRow} onActivateRow={onActivateRow} />
	})()

	return (
		<box flexDirection="column" height={height} backgroundColor={colors.background}>
			<PaddedRow>
				<HeaderLine left={title} right={headerRight} width={contentWidth} />
			</PaddedRow>
			<PaddedRow>
				<TextLine>
					<span fg={colors.muted}>{fitCell(subline, contentWidth)}</span>
				</TextLine>
			</PaddedRow>
			<Divider width={paneWidth} />
			<box height={bodyHeight} flexDirection="column" {...(inLog ? { onMouseScroll: handleLogMouseScroll } : {})}>
				{needsScroll ? (
					<scrollbox ref={scrollboxRef} focusable={false} flexGrow={1} verticalScrollbarOptions={{ visible: showScrollbar }}>
						{body}
					</scrollbox>
				) : (
					<box flexGrow={1} flexDirection="column">
						{body}
					</box>
				)}
			</box>
		</box>
	)
}
