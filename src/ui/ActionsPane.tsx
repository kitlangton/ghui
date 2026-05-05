import { TextAttributes } from "@opentui/core"
import type { WorkflowJob, WorkflowJobDependency, WorkflowRun, WorkflowStep } from "../domain.js"
import { colors } from "./colors.js"
import { Divider, fitCell, Filler, PaddedRow, TextLine } from "./primitives.js"
import { shortRepoName } from "./pullRequests.js"
import { renderWorkflowGraph } from "./workflowGraph.js"

type ActionsLevel = "runs" | "jobs" | "logs"

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

const renderStepsBar = ({
	steps,
	selectedStepIndex,
	contentWidth,
}: {
	readonly steps: readonly ParsedLogStep[]
	readonly selectedStepIndex: number
	readonly contentWidth: number
}) => {
	if (steps.length === 0) {
		return fitCell("No steps", contentWidth)
	}

	const clamped = Math.max(0, Math.min(steps.length - 1, selectedStepIndex))
	const leftArrow = clamped > 0 ? "◂" : " "
	const rightArrow = clamped < steps.length - 1 ? "▸" : " "
	const summary = steps.map((step, index) => `${index === clamped ? "●" : "·"}${stateIcon(step.status, step.conclusion)} ${step.name}`).join("  ")
	const detailed = `${leftArrow} ${summary} ${rightArrow}`
	if (detailed.length <= contentWidth) return fitCell(detailed, contentWidth)

	const current = steps[clamped]!
	const focused = `${leftArrow} ${stateIcon(current.status, current.conclusion)} ${current.name} (${clamped + 1}/${steps.length}) ${rightArrow}`
	return fitCell(focused, contentWidth)
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
	graphScrollOffset,
	logScrollOffset,
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
	graphScrollOffset: number
	logScrollOffset: number
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
		const clampedStepIndex = Math.max(0, Math.min(steps.length - 1, selectedStepIndex))
		const selectedStep = steps[clampedStepIndex] ?? null
		const lines = selectedStep?.lines ?? []
		const jobHeaderRows = selectedJob ? 1 : 0
		const stepBarRows = 1
		const logHeight = Math.max(1, bodyHeight - jobHeaderRows - stepBarRows)
		const top = Math.max(0, Math.min(logScrollOffset, Math.max(0, lines.length - logHeight)))
		const visible = lines.slice(top, top + logHeight)
		const stepBarText = renderStepsBar({ steps, selectedStepIndex: clampedStepIndex, contentWidth })
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
					<PaddedRow>
						<TextLine>
							<span fg={colors.muted}>{stepBarText}</span>
						</TextLine>
					</PaddedRow>
					{visible.length > 0
						? visible.map((line, index) => (
								<PaddedRow key={`log-${top + index}`}>
									<TextLine>
										<span fg={colors.text}>{fitCell(line, contentWidth)}</span>
									</TextLine>
								</PaddedRow>
							))
						: [<Filler key="actions-log-empty" rows={logHeight} prefix="actions-log-empty" />]}
				</box>
			</box>
		)
	}

	if (level === "jobs") {
		const graph = renderWorkflowGraph({
			dependencies: selectedRunDependencies,
			jobs: selectedRunJobs,
			contentWidth,
			scrollOffset: graphScrollOffset,
		})
		const graphMaxRows = Math.max(0, Math.min(8, bodyHeight - 2))
		const graphRows = graph.slice(0, graphMaxRows)
		const listHeight = Math.max(1, bodyHeight - graphRows.length - (graphRows.length > 0 ? 1 : 0))
		const top = Math.max(0, Math.min(selectedJobIndex - Math.floor(listHeight / 2), Math.max(0, selectedRunJobs.length - listHeight)))
		const visible = selectedRunJobs.slice(top, top + listHeight)
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
					{graphRows.map((line, index) => (
						<PaddedRow key={`graph-${index}`}>
							<TextLine>
								{line.segments.map((segment, segmentIndex) => (
									<span key={`graph-${index}-segment-${segmentIndex}`} fg={segment.fg}>
										{segment.text}
									</span>
								))}
							</TextLine>
						</PaddedRow>
					))}
					{graphRows.length > 0 ? <Divider width={paneWidth} /> : null}
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
