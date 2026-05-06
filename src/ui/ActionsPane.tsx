import { TextAttributes } from "@opentui/core"
import type { WorkflowJob, WorkflowJobDependency, WorkflowRun, WorkflowStep } from "../domain.js"
import { colors } from "./colors.js"
import { Divider, fitCell, Filler, ModalFrame, PaddedRow, PlainLine, TextLine } from "./primitives.js"
import { shortRepoName } from "./pullRequests.js"
import { renderWorkflowGraph } from "./workflowGraph.js"

type ActionsLevel = "runs" | "jobs" | "logs"
type ActionsBarSegment = { readonly text: string; readonly fg: string; readonly bold?: boolean }

const PASSING = new Set(["success", "neutral", "skipped"])
const ESC = String.fromCharCode(27)

const isControlChar = (code: number) => (code >= 0 && code <= 9) || (code >= 11 && code <= 31) || code === 127

const stateIcon = (status: WorkflowJob["status"], conclusion: WorkflowJob["conclusion"]) => {
	if (status === "completed") {
		if (conclusion === "skipped" || conclusion === "cancelled") return "○"
		if (conclusion && PASSING.has(conclusion)) return "✓"
		if (conclusion) return "✗"
		return "·"
	}
	if (status === "in_progress") return "●"
	if (status === "queued") return "○"
	return "·"
}

const stateColor = (status: WorkflowJob["status"], conclusion: WorkflowJob["conclusion"]) => {
	if (status === "completed") {
		if (conclusion === "skipped" || conclusion === "cancelled") return colors.muted
		if (conclusion && PASSING.has(conclusion)) return colors.status.passing
		if (conclusion) return colors.status.failing
		return colors.muted
	}
	if (status === "in_progress") return colors.status.pending
	if (status === "queued") return colors.muted
	return colors.muted
}

const sanitizeLogLine = (line: string) => {
	let output = ""
	for (let index = 0; index < line.length; index++) {
		const char = line[index]
		if (char === ESC && line[index + 1] === "[") {
			index += 2
			while (index < line.length) {
				const code = line.charCodeAt(index)
				if (code >= 64 && code <= 126) break
				index += 1
			}
			continue
		}
		if (!isControlChar(line.charCodeAt(index))) output += char
	}
	return output
}

const stripTimestampPrefix = (line: string) => {
	const match = /^\d{4}-\d{2}-\d{2}T\S+Z\s+(.*)$/.exec(line)
	return (match?.[1] ?? line).trimStart()
}

export interface ParsedLogStep {
	readonly name: string
	readonly status: WorkflowStep["status"]
	readonly conclusion: WorkflowStep["conclusion"]
	readonly lines: readonly string[]
}

export type ActionsLogRow =
	| {
			readonly kind: "step"
			readonly stepIndex: number
			readonly expanded: boolean
	  }
	| {
			readonly kind: "line"
			readonly stepIndex: number
			readonly lineIndex: number
			readonly chunkIndex: number
			readonly line: string
	  }

export const parseActionsLogSteps = (rawLog: string, steps: readonly WorkflowStep[]): readonly ParsedLogStep[] => {
	const normalizedLines = rawLog.split("\n").map(sanitizeLogLine)
	const groups: Array<{ name: string; lines: string[] }> = []
	let activeGroup: { name: string; lines: string[] } | null = null
	let fallbackLines: string[] = []

	for (const line of normalizedLines) {
		const stripped = stripTimestampPrefix(line)
		const groupMatch = /^##\[group\](.*)$/.exec(stripped)
		if (groupMatch) {
			if (activeGroup) groups.push(activeGroup)
			activeGroup = { name: (groupMatch[1] ?? "step").trim() || "step", lines: [] }
			continue
		}
		if (stripped.startsWith("##[endgroup]")) {
			if (activeGroup) {
				groups.push(activeGroup)
				activeGroup = null
			}
			continue
		}

		if (activeGroup) {
			activeGroup.lines.push(line)
		} else if (groups.length > 0) {
			groups[groups.length - 1]!.lines.push(line)
		} else {
			fallbackLines.push(line)
		}
	}

	if (activeGroup) groups.push(activeGroup)
	if (groups.length > 0 && fallbackLines.length > 0) {
		groups[0]!.lines.unshift(...fallbackLines)
	}

	if (groups.length === 0) {
		const name = steps[0]?.name ?? "log"
		const step = steps[0]
		return [{ name, status: step?.status ?? "completed", conclusion: step?.conclusion ?? null, lines: fallbackLines }]
	}

	const stepByName = new Map(steps.map((step) => [step.name.toLowerCase(), step] as const))
	return groups.map((group, index) => {
		const mapped = stepByName.get(group.name.toLowerCase()) ?? steps[index] ?? null
		return {
			name: group.name,
			status: mapped?.status ?? "completed",
			conclusion: mapped?.conclusion ?? null,
			lines: group.lines,
		} satisfies ParsedLogStep
	})
}
export const buildActionsLogRows = ({
	steps,
	expandedStepIndex,
	wrapMode,
	contentWidth,
}: {
	readonly steps: readonly ParsedLogStep[]
	readonly expandedStepIndex: number | null
	readonly wrapMode: boolean
	readonly contentWidth: number
}): readonly ActionsLogRow[] => {
	const rows: ActionsLogRow[] = []
	const wrapWidth = Math.max(1, contentWidth - 2)
	for (let index = 0; index < steps.length; index++) {
		const expanded = expandedStepIndex === index
		rows.push({ kind: "step", stepIndex: index, expanded })
		if (!expanded) continue
		const lines = steps[index]?.lines ?? []
		for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
			const line = lines[lineIndex] ?? ""
			if (!wrapMode) {
				rows.push({ kind: "line", stepIndex: index, lineIndex, chunkIndex: 0, line })
				continue
			}
			if (line.length === 0) {
				rows.push({ kind: "line", stepIndex: index, lineIndex, chunkIndex: 0, line: "" })
				continue
			}
			let chunkIndex = 0
			for (let start = 0; start < line.length; start += wrapWidth) {
				rows.push({
					kind: "line",
					stepIndex: index,
					lineIndex,
					chunkIndex,
					line: line.slice(start, start + wrapWidth),
				})
				chunkIndex += 1
			}
		}
	}
	return rows
}

const renderHighlightedLine = (line: string, contentWidth: number, query: string): readonly ActionsBarSegment[] => {
	const fitted = fitCell(line, contentWidth)
	const needle = query.trim().toLowerCase()
	if (needle.length === 0) return [{ text: fitted, fg: colors.text }]
	const index = fitted.toLowerCase().indexOf(needle)
	if (index < 0) return [{ text: fitted, fg: colors.text }]
	const end = Math.min(fitted.length, index + needle.length)
	const segments: ActionsBarSegment[] = []
	if (index > 0) segments.push({ text: fitted.slice(0, index), fg: colors.text })
	segments.push({ text: fitted.slice(index, end), fg: colors.accent, bold: true })
	if (end < fitted.length) segments.push({ text: fitted.slice(end), fg: colors.text })
	return segments
}

export const ActionsPane = ({
	repository,
	number,
	level,
	workflowRuns,
	selectedRunIndex,
	selectedJobIndex,
	selectedRunJobs,
	selectedRunDependencies,
	selectedJobLog,
	selectedStepIndex,
	expandedStepIndex,
	graphScrollOffset,
	logScrollOffset,
	logWrapMode,
	logHorizontalScroll,
	logFilterQuery,
	logFilterDraft,
	logFilterActive,
	graphModalActive,
	graphModalVerticalScroll,
	contentWidth,
	paneWidth,
	height,
	loading,
	loadingIndicator,
	error,
}: {
	repository: string
	number: number
	level: ActionsLevel
	workflowRuns: readonly WorkflowRun[]
	selectedRunIndex: number
	selectedJobIndex: number
	selectedRunJobs: readonly WorkflowJob[]
	selectedRunDependencies: readonly WorkflowJobDependency[]
	selectedJobLog: string
	selectedStepIndex: number
	expandedStepIndex: number | null
	graphScrollOffset: number
	logScrollOffset: number
	logWrapMode: boolean
	logHorizontalScroll: number
	logFilterQuery: string
	logFilterDraft: string
	logFilterActive: boolean
	graphModalActive: boolean
	graphModalVerticalScroll: number
	contentWidth: number
	paneWidth: number
	height: number
	loading: boolean
	loadingIndicator: string
	error: string | null
}) => {
	const selectedRun = workflowRuns[selectedRunIndex] ?? null
	const selectedJob = selectedRunJobs[selectedJobIndex] ?? null
	const headerRight = loading ? `${loadingIndicator} syncing` : error ? "error" : level === "logs" ? "logs" : level === "jobs" ? "jobs" : "runs"
	const left = `Actions #${number}  ${shortRepoName(repository)}`
	const gap = Math.max(1, contentWidth - left.length - headerRight.length)
	const bodyHeight = Math.max(1, height - 2)

	if (level === "logs") {
		const steps = parseActionsLogSteps(selectedJobLog, selectedJob?.steps ?? [])
		const rows = buildActionsLogRows({
			steps,
			expandedStepIndex,
			wrapMode: logWrapMode,
			contentWidth,
		})
		const clampedRowIndex = rows.length === 0 ? 0 : Math.max(0, Math.min(rows.length - 1, selectedStepIndex))
		const expandedStep = expandedStepIndex === null ? null : (steps[expandedStepIndex] ?? null)
		const lines = expandedStep?.lines ?? []
		const activeFilterText = logFilterActive ? logFilterDraft : logFilterQuery
		const normalizedFilter = activeFilterText.trim().toLowerCase()
		const matchCount = normalizedFilter.length === 0 ? 0 : lines.reduce((count, line) => (line.toLowerCase().includes(normalizedFilter) ? count + 1 : count), 0)
		const showFilterBar = logFilterActive || logFilterQuery.length > 0
		const jobHeaderRows = selectedJob ? 1 : 0
		const filterBarRows = showFilterBar ? 1 : 0
		const logHeight = Math.max(1, bodyHeight - jobHeaderRows - filterBarRows)
		const top = Math.max(0, Math.min(logScrollOffset, Math.max(0, rows.length - logHeight)))
		const visible = rows.slice(top, top + logHeight)
		const filterPrefix = logFilterActive ? "filter> " : "/ "
		const filterValue = activeFilterText.length > 0 ? activeFilterText : "type to highlight..."
		const matchLabel = normalizedFilter.length === 0 ? "" : matchCount === 1 ? "1 match" : `${matchCount} matches`
		const modeLabel = logWrapMode ? "wrap" : `x:${logHorizontalScroll}`
		const statusLabel = matchLabel.length > 0 ? `${modeLabel}  ${matchLabel}` : modeLabel
		const leftFilterText = `${filterPrefix}${filterValue}`
		const leftWidth = Math.max(1, contentWidth - (statusLabel.length > 0 ? statusLabel.length + 1 : 0))
		const leftFilterCell = fitCell(leftFilterText, leftWidth)
		const prefixCell = fitCell(filterPrefix, Math.min(filterPrefix.length, leftFilterCell.length))
		const valueCell = leftFilterCell.slice(prefixCell.length)
		const rightFilterCell = fitCell(statusLabel, contentWidth - leftWidth, "right")
		return (
			<box flexDirection="column" width={paneWidth} height={height}>
				<PaddedRow>
					<TextLine>
						<span fg={colors.count} attributes={TextAttributes.BOLD}>
							{left}
						</span>
						<span fg={colors.muted}>{" ".repeat(gap)}</span>
						<span fg={colors.muted}>{headerRight}</span>
					</TextLine>
				</PaddedRow>
				<Divider width={paneWidth} />
				<box flexDirection="column" height={bodyHeight}>
					{selectedJob ? (
						<PaddedRow>
							<TextLine>
								<span fg={stateColor(selectedJob.status, selectedJob.conclusion)}>{stateIcon(selectedJob.status, selectedJob.conclusion)}</span>
								<span>{` ${selectedJob.name}`}</span>
							</TextLine>
						</PaddedRow>
					) : null}
					{showFilterBar ? (
						<PaddedRow backgroundColor={colors.selectedBg}>
							<TextLine>
								<span fg={colors.count}>{prefixCell}</span>
								<span fg={logFilterActive ? colors.text : colors.accent}>{valueCell}</span>
								{rightFilterCell.length > 0 ? <span fg={matchCount > 0 ? colors.status.passing : colors.status.failing}>{rightFilterCell}</span> : null}
							</TextLine>
						</PaddedRow>
					) : null}
					{visible.length > 0
						? visible.map((row, index) => {
								const absoluteIndex = top + index
								const selected = absoluteIndex === clampedRowIndex
								if (row.kind === "step") {
									const step = steps[row.stepIndex]
									if (!step) return null
									const disclosure = row.expanded ? "▾" : "▸"
									const status = stateIcon(step.status, step.conclusion)
									return (
										<PaddedRow key={`log-step-${row.stepIndex}`} {...(selected ? { backgroundColor: colors.selectedBg } : {})}>
											<TextLine>
												<span fg={selected ? colors.selectedText : colors.muted}>{`${disclosure} `}</span>
												<span fg={stateColor(step.status, step.conclusion)}>{status}</span>
												<span fg={selected ? colors.selectedText : colors.text}>{fitCell(` ${step.name}`, Math.max(1, contentWidth - 4))}</span>
											</TextLine>
										</PaddedRow>
									)
								}
								const visibleLine = logWrapMode ? row.line : row.line.slice(logHorizontalScroll)
								const indented = `  ${visibleLine}`
								const segments = renderHighlightedLine(indented, contentWidth, activeFilterText)
								return (
									<PaddedRow key={`log-line-${row.stepIndex}-${row.lineIndex}-${row.chunkIndex}`} {...(selected ? { backgroundColor: colors.selectedBg } : {})}>
										<TextLine>
											{segments.map((segment, segmentIndex) => (
												<span key={`log-${absoluteIndex}-${segmentIndex}`} fg={segment.fg} {...(segment.bold ? { attributes: TextAttributes.BOLD } : {})}>
													{segment.text}
												</span>
											))}
										</TextLine>
									</PaddedRow>
								)
							})
						: [<Filler key="actions-log-empty" rows={logHeight} prefix="actions-log-empty" />]}
				</box>
			</box>
		)
	}

	if (level === "jobs") {
		const listHeight = Math.max(1, bodyHeight - (selectedRun ? 1 : 0))
		const top = Math.max(0, Math.min(selectedJobIndex - Math.floor(listHeight / 2), Math.max(0, selectedRunJobs.length - listHeight)))
		const visible = selectedRunJobs.slice(top, top + listHeight)

		const modalWidth = Math.max(30, paneWidth - 4)
		const modalContentWidth = Math.max(1, modalWidth - 2)
		const modalGraph = renderWorkflowGraph({
			dependencies: selectedRunDependencies,
			jobs: selectedRunJobs,
			contentWidth: modalContentWidth,
			scrollOffset: graphScrollOffset,
		})
		const modalGraphRows = modalGraph.length
		const modalHeight = Math.min(Math.max(5, modalGraphRows + 4), height - 4)
		const modalLeft = Math.floor((paneWidth - modalWidth) / 2)
		const modalTop = Math.floor((height - modalHeight) / 2)
		const modalInnerHeight = Math.max(1, modalHeight - 2)
		const modalTitleRows = selectedRun ? 1 : 0
		const modalDividerRows = selectedRun ? 1 : 0
		const modalGraphHeight = Math.max(1, modalInnerHeight - modalTitleRows - modalDividerRows)
		const modalTopRow = Math.max(0, Math.min(graphModalVerticalScroll, Math.max(0, modalGraph.length - modalGraphHeight)))
		const modalVisibleGraph = modalGraph.slice(modalTopRow, modalTopRow + modalGraphHeight)
		const modalJunctionRows = selectedRun ? [modalTitleRows] : []

		return (
			<box flexDirection="column" width={paneWidth} height={height}>
				<PaddedRow>
					<TextLine>
						<span fg={colors.count} attributes={TextAttributes.BOLD}>
							{left}
						</span>
						<span fg={colors.muted}>{" ".repeat(gap)}</span>
						<span fg={colors.muted}>{headerRight}</span>
					</TextLine>
				</PaddedRow>
				<Divider width={paneWidth} />
				<box flexDirection="column" height={bodyHeight}>
					{selectedRun ? (
						<PaddedRow>
							<TextLine>
								<span fg={colors.accent} attributes={TextAttributes.BOLD}>
									{selectedRun.name}
								</span>
							</TextLine>
						</PaddedRow>
					) : null}
					{visible.length > 0
						? visible.map((job, index) => {
								const absoluteIndex = top + index
								const selected = absoluteIndex === selectedJobIndex
								return (
									<PaddedRow key={job.id} {...(selected ? { backgroundColor: colors.selectedBg } : {})}>
										<TextLine>
											<span fg={stateColor(job.status, job.conclusion)}>{stateIcon(job.status, job.conclusion)}</span>
											<span fg={selected ? colors.selectedText : colors.text}>{` ${fitCell(job.name, Math.max(8, contentWidth - 2))}`}</span>
										</TextLine>
									</PaddedRow>
								)
							})
						: [<Filler key="actions-jobs-empty" rows={listHeight} prefix="actions-jobs-empty" />]}
				</box>
				{graphModalActive ? (
					<ModalFrame left={modalLeft} top={modalTop} width={modalWidth} height={modalHeight} junctionRows={modalJunctionRows}>
						{selectedRun ? <PlainLine text={fitCell(`Dependency graph  ${selectedRun.name}`, modalContentWidth)} fg={colors.accent} bold /> : null}
						{selectedRun ? <PlainLine text={"─".repeat(modalContentWidth)} fg={colors.separator} /> : null}
						{modalVisibleGraph.map((line, index) => (
							<box key={`modal-graph-${index}`} paddingLeft={0}>
								<TextLine>
									{line.segments.map((segment, segmentIndex) => (
										<span key={`mg-${index}-${segmentIndex}`} fg={segment.fg}>
											{segment.text}
										</span>
									))}
								</TextLine>
							</box>
						))}
						{modalVisibleGraph.length < modalGraphHeight
							? Array.from({ length: modalGraphHeight - modalVisibleGraph.length }, (_, index) => <PlainLine key={`modal-graph-pad-${index}`} text=" " fg={colors.muted} />)
							: null}
					</ModalFrame>
				) : null}
			</box>
		)
	}

	const listHeight = bodyHeight
	const top = Math.max(0, Math.min(selectedRunIndex - Math.floor(listHeight / 2), Math.max(0, workflowRuns.length - listHeight)))
	const visible = workflowRuns.slice(top, top + listHeight)
	return (
		<box flexDirection="column" width={paneWidth} height={height}>
			<PaddedRow>
				<TextLine>
					<span fg={colors.count} attributes={TextAttributes.BOLD}>
						{left}
					</span>
					<span fg={colors.muted}>{" ".repeat(gap)}</span>
					<span fg={colors.muted}>{headerRight}</span>
				</TextLine>
			</PaddedRow>
			<Divider width={paneWidth} />
			<box flexDirection="column" height={bodyHeight}>
				{visible.length > 0
					? visible.map((run, index) => {
							const absoluteIndex = top + index
							const selected = absoluteIndex === selectedRunIndex
							return (
								<PaddedRow key={run.id} {...(selected ? { backgroundColor: colors.selectedBg } : {})}>
									<TextLine>
										<span fg={stateColor(run.status, run.conclusion)}>{stateIcon(run.status, run.conclusion)}</span>
										<span fg={selected ? colors.selectedText : colors.text}>{` ${fitCell(run.name, Math.max(8, contentWidth - 2))}`}</span>
									</TextLine>
								</PaddedRow>
							)
						})
					: [<Filler key="actions-runs-empty" rows={bodyHeight} prefix="actions-runs-empty" />]}
			</box>
		</box>
	)
}
