import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useCallback, useMemo } from "react"
import { Cause } from "effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { errorMessage } from "../errors.js"
import type { PullRequestItem, WorkflowRun, WorkflowRunDetails } from "../domain.js"
import type { RunsViewCtx } from "../keymap/runsView.js"
import { openUrlAtom } from "../services/systemAtoms.js"
import {
	initialRunLogView,
	jobLogKey,
	logScrollAtom,
	openLogAtom,
	pullRequestRunsFor,
	runDetailKey,
	runDetailSelectionAtom,
	runsFullViewAtom,
	runsKey,
	runsListSelectionAtom,
	selectedRunIdAtom,
	workflowJobLogFor,
	workflowRunDetailsFor,
} from "../ui/runs/atoms.js"
import { failureRowIndices, flattenRunRows, parseJobLog, type RunDetailRow } from "../ui/runs/runsRows.js"

const clamp = (value: number, max: number) => Math.max(0, Math.min(value, Math.max(0, max)))

type ResultState<A> = { readonly status: "loading" } | { readonly status: "error"; readonly message: string } | { readonly status: "ready"; readonly value: A }

const toState = <A, E>(result: AsyncResult.AsyncResult<A, E>, describeError: (error: unknown) => string = () => "Failed to load runs"): ResultState<A> => {
	if (AsyncResult.isSuccess(result)) return { status: "ready", value: result.value }
	if (AsyncResult.isFailure(result)) return { status: "error", message: describeError(Cause.squash(result.cause)) }
	return { status: "loading" }
}

export interface RunsViewModel {
	readonly ctx: RunsViewCtx
	readonly runsFullView: boolean
	readonly inDetail: boolean
	readonly runsState: ResultState<readonly WorkflowRun[]>
	readonly detailState: ResultState<WorkflowRunDetails> | null
	readonly runsSelection: number
	readonly detailSelection: number
	readonly detailRows: readonly RunDetailRow[]
	// Log sub-mode (view C): a job's log, optionally narrowed to one step.
	readonly inLog: boolean
	readonly logState: ResultState<string> | null
	readonly logLines: readonly string[]
	readonly logScroll: number
	readonly logTitle: string
	// Mouse wheel over the log body.
	readonly scrollLog: (delta: number) => void
	// Click-to-select then act on a row (run row → open run; detail row → no-op extra).
	readonly selectRow: (index: number) => void
	readonly activateRow: (index: number) => void
}

/**
 * Owns all runs-view atom state + navigation. Self-contained so the runs feature
 * lives in one module rather than threaded through the app-shell God-hook. Reads
 * the runs/detail family atoms (which auto-suspend) and exposes the keymap ctx
 * plus the data the pane renders.
 */
export const useRunsView = (selectedPullRequest: PullRequestItem | null, halfPage: number): RunsViewModel => {
	const [runsFullView, setRunsFullView] = useAtom(runsFullViewAtom)
	const [selectedRunId, setSelectedRunId] = useAtom(selectedRunIdAtom)
	const [runsSelection, setRunsSelection] = useAtom(runsListSelectionAtom)
	const [detailSelection, setDetailSelection] = useAtom(runDetailSelectionAtom)
	const [openLog, setOpenLog] = useAtom(openLogAtom)
	const [logScroll, setLogScroll] = useAtom(logScrollAtom)
	const openUrl = useAtomSet(openUrlAtom, { mode: "promise" })

	const runsListKey = selectedPullRequest ? runsKey(selectedPullRequest) : null
	const runsResult = useAtomValue(pullRequestRunsFor(runsListKey ?? "\u0000\u0000"))
	const runsState = useMemo<ResultState<readonly WorkflowRun[]>>(() => toState(runsResult), [runsResult])
	const runs: readonly WorkflowRun[] = runsState.status === "ready" ? runsState.value : []

	const inDetail = selectedRunId !== null
	const detailAtomKey = selectedPullRequest && selectedRunId !== null ? runDetailKey(selectedPullRequest.repository, selectedRunId) : null
	const detailResult = useAtomValue(workflowRunDetailsFor(detailAtomKey ?? "\u0000\u0000"))
	const detailState = detailAtomKey ? toState(detailResult) : null
	const detailRun = detailState?.status === "ready" ? detailState.value : null
	const detailRows = useMemo(() => (detailRun ? flattenRunRows(detailRun) : []), [detailRun])

	const inLog = inDetail && openLog !== null
	const logAtomKey = selectedPullRequest && inLog ? jobLogKey(selectedPullRequest.repository, openLog.jobId) : null
	const logResult = useAtomValue(workflowJobLogFor(logAtomKey ?? "\u0000\u0000"))
	// Surface gh's own message here: "job … is still in progress" is the common case.
	const logState = logAtomKey ? toState(logResult, (error) => errorMessage(error) || "Failed to load log") : null
	const logText = logState?.status === "ready" ? logState.value : ""
	const logLines = useMemo(() => (inLog ? parseJobLog(logText, openLog.step) : []), [inLog, logText, openLog])
	const logTitle = openLog ? (openLog.step ? `${openLog.jobName} ▸ ${openLog.step.name}` : `${openLog.jobName} · full job log`) : ""

	const scrollLog = useCallback((delta: number) => setLogScroll((current) => clamp(current + delta, logLines.length - 1)), [logLines.length, setLogScroll])

	const closeLog = useCallback(() => {
		setOpenLog(null)
		setLogScroll(0)
	}, [setOpenLog, setLogScroll])

	const closeRunsView = useCallback(() => {
		setRunsFullView(false)
		setSelectedRunId(null)
		closeLog()
	}, [setRunsFullView, setSelectedRunId, closeLog])

	const backToList = useCallback(() => {
		setSelectedRunId(null)
		setDetailSelection(0)
		closeLog()
	}, [setSelectedRunId, setDetailSelection, closeLog])

	const handleEscape = useCallback(() => {
		if (inLog) closeLog()
		else if (inDetail) backToList()
		else closeRunsView()
	}, [inLog, inDetail, closeLog, backToList, closeRunsView])

	const moveSelection = useCallback(
		(delta: number) => {
			// Log scroll clamps to the last line (vim-style) rather than the last page;
			// the hook doesn't know the viewport height.
			if (inLog) setLogScroll((current) => clamp(current + delta, logLines.length - 1))
			else if (inDetail) setDetailSelection((current) => clamp(current + delta, detailRows.length - 1))
			else setRunsSelection((current) => clamp(current + delta, runs.length - 1))
		},
		[inLog, inDetail, logLines.length, detailRows.length, runs.length, setLogScroll, setDetailSelection, setRunsSelection],
	)

	const moveSelectionToBoundary = useCallback(
		(boundary: "first" | "last") => {
			if (inLog) setLogScroll(boundary === "first" ? 0 : Math.max(0, logLines.length - 1))
			else if (inDetail) setDetailSelection(boundary === "first" ? 0 : Math.max(0, detailRows.length - 1))
			else setRunsSelection(boundary === "first" ? 0 : Math.max(0, runs.length - 1))
		},
		[inLog, inDetail, logLines.length, detailRows.length, runs.length, setLogScroll, setDetailSelection, setRunsSelection],
	)

	const openRunAt = useCallback(
		(index: number) => {
			const run = runs[index]
			if (!run) return
			setSelectedRunId(run.id)
			setDetailSelection(0)
		},
		[runs, setSelectedRunId, setDetailSelection],
	)

	// Step row → that step's log; job row → the whole job's log. Opens on GitHub by
	// default; `runLogView: "inline"` renders it inside ghui instead.
	const openStepLogAt = useCallback(
		(index: number) => {
			const row = detailRows[index]
			if (!row) return
			if (initialRunLogView === "browser") {
				const url = row.kind === "step" ? row.job.url : detailRun?.url
				if (url) void openUrl(url)
				return
			}
			setOpenLog({ jobId: row.job.id, jobName: row.job.name, jobUrl: row.job.url, step: row.kind === "step" ? row.step : null })
			setLogScroll(0)
		},
		[detailRows, detailRun, openUrl, setOpenLog, setLogScroll],
	)

	// `enter` (or click-activate): open the focused run, or the focused step's log.
	const openSelected = useCallback(() => {
		if (inLog) return
		if (inDetail) openStepLogAt(detailSelection)
		else openRunAt(runsSelection)
	}, [inLog, inDetail, openStepLogAt, openRunAt, detailSelection, runsSelection])

	const jumpFailure = useCallback(
		(direction: 1 | -1) => {
			if (!inDetail || inLog) return
			const failures = failureRowIndices(detailRows)
			if (failures.length === 0) return
			const current = detailSelection
			const next =
				direction === 1 ? (failures.find((index) => index > current) ?? failures[0]!) : ([...failures].reverse().find((index) => index < current) ?? failures[failures.length - 1]!)
			setDetailSelection(next)
		},
		[inDetail, inLog, detailRows, detailSelection, setDetailSelection],
	)

	const openInBrowser = useCallback(() => {
		const url = inLog ? openLog.jobUrl : inDetail ? detailRun?.url : runs[runsSelection]?.url
		if (url) void openUrl(url)
	}, [inLog, openLog, inDetail, detailRun, runs, runsSelection, openUrl])

	// Mouse: first click selects the row, second (or click on the already-selected
	// row) activates it — opening a run, or a step's log in the browser.
	const selectRow = useCallback(
		(index: number) => {
			if (inLog) return
			if (inDetail) setDetailSelection(clamp(index, detailRows.length - 1))
			else setRunsSelection(clamp(index, runs.length - 1))
		},
		[inLog, inDetail, detailRows.length, runs.length, setDetailSelection, setRunsSelection],
	)

	const activateRow = useCallback(
		(index: number) => {
			if (inLog) return
			if (inDetail) openStepLogAt(index)
			else openRunAt(index)
		},
		[inLog, inDetail, openStepLogAt, openRunAt],
	)

	const refresh = useCallback(() => {
		// Family atoms refresh on re-read via setIdleTTL(0); nudging selection is
		// enough to re-trigger. A dedicated refresh is wired through the command.
	}, [])

	const ctx: RunsViewCtx = useMemo(
		() => ({
			halfPage,
			inDetail,
			handleEscape,
			moveSelection,
			moveSelectionToBoundary,
			openSelected,
			nextFailure: () => jumpFailure(1),
			previousFailure: () => jumpFailure(-1),
			refresh,
			openInBrowser,
		}),
		[halfPage, inDetail, handleEscape, moveSelection, moveSelectionToBoundary, openSelected, jumpFailure, refresh, openInBrowser],
	)

	return {
		ctx,
		runsFullView,
		inDetail,
		runsState,
		detailState,
		runsSelection: clamp(runsSelection, runs.length - 1),
		detailSelection: clamp(detailSelection, detailRows.length - 1),
		detailRows,
		inLog,
		logState,
		logLines,
		logScroll: clamp(logScroll, logLines.length - 1),
		logTitle,
		scrollLog,
		selectRow,
		activateRow,
	}
}
