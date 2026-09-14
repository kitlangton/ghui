import type { RunConclusion, RunJob, RunStatus, RunStep, WorkflowRunDetails } from "../../domain.js"

// Pure helpers for the runs view: status glyphs, durations, and the flattened
// job/step row model the detail view navigates. No React, no atoms — unit-tested.

export type RunGlyphKind = "success" | "failure" | "in-progress" | "queued" | "cancelled" | "skipped" | "neutral"

export const runGlyphKind = (status: RunStatus, conclusion: RunConclusion): RunGlyphKind => {
	if (status !== "completed") return status === "in_progress" ? "in-progress" : "queued"
	switch (conclusion) {
		case "success":
			return "success"
		case "failure":
		case "timed_out":
		case "action_required":
			return "failure"
		case "cancelled":
		case "stale":
			return "cancelled"
		case "skipped":
			return "skipped"
		default:
			return "neutral"
	}
}

export const RUN_GLYPH: Record<RunGlyphKind, string> = {
	success: "✓",
	failure: "✗",
	"in-progress": "●",
	queued: "○",
	cancelled: "⊘",
	skipped: "·",
	neutral: "·",
}

export const runGlyph = (status: RunStatus, conclusion: RunConclusion): string => RUN_GLYPH[runGlyphKind(status, conclusion)]

const isFailureKind = (kind: RunGlyphKind): boolean => kind === "failure" || kind === "cancelled"

export const conclusionLabel = (status: RunStatus, conclusion: RunConclusion): string => {
	if (status === "queued") return "queued"
	if (status === "in_progress") return "in progress"
	return conclusion ?? "completed"
}

// Duration between two timestamps (or from start to now if not finished), as a
// compact "1m41s" / "48s" string. Returns "—" when unknown.
export const formatDuration = (startedAt: Date | null, completedAt: Date | null, now: Date = new Date()): string => {
	if (!startedAt) return "—"
	const end = completedAt ?? now
	const seconds = Math.max(0, Math.round((end.getTime() - startedAt.getTime()) / 1000))
	if (seconds < 60) return `${seconds}s`
	const minutes = Math.floor(seconds / 60)
	const rest = seconds % 60
	return rest === 0 ? `${minutes}m` : `${minutes}m${rest}s`
}

// === Flattened detail rows ===

export interface RunJobRow {
	readonly kind: "job"
	readonly job: RunJob
	readonly glyph: string
	readonly glyphKind: RunGlyphKind
}

export interface RunStepRow {
	readonly kind: "step"
	readonly job: RunJob
	readonly step: RunStep
	readonly glyph: string
	readonly glyphKind: RunGlyphKind
	readonly key: string
}

export type RunDetailRow = RunJobRow | RunStepRow

export const stepRowKey = (job: RunJob, step: RunStep): string => `${job.id}:${step.number}`

// Each job becomes a header row followed by its step rows. The list is the
// navigable surface for view B.
export const flattenRunRows = (run: WorkflowRunDetails): readonly RunDetailRow[] => {
	const rows: RunDetailRow[] = []
	for (const job of run.jobs) {
		const jobKind = runGlyphKind(job.status, job.conclusion)
		rows.push({ kind: "job", job, glyph: RUN_GLYPH[jobKind], glyphKind: jobKind })
		for (const step of job.steps) {
			const stepKind = runGlyphKind(step.status, step.conclusion)
			rows.push({ kind: "step", job, step, glyph: RUN_GLYPH[stepKind], glyphKind: stepKind, key: stepRowKey(job, step) })
		}
	}
	return rows
}

// Indices of failure rows, for n/p navigation.
export const failureRowIndices = (rows: readonly RunDetailRow[]): readonly number[] => rows.flatMap((row, index) => (isFailureKind(row.glyphKind) ? [index] : []))

// === Job log ===

// `gh run view --job <id> --log` prints `job\tstep\t<ISO timestamp> <text>` per
// line. Current gh (2.98) can no longer name the step ("UNKNOWN STEP"), so a step
// is selected by its time window instead: step times from `--json jobs` are
// second-resolution and line up with the log timestamps.
// Lines logged in a boundary second land in both adjacent steps; acceptable.
const LOG_TIMESTAMP = /^\uFEFF?(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d+)?Z ?/
// gh prints ESC as the two characters `^[`; raw ESC is also handled. Built via
// fromCharCode because a literal control char trips no-control-regex.
const ANSI = new RegExp(`(?:${String.fromCharCode(27)}|\\^\\[)\\[[0-9;]*[A-Za-z]`, "g")

export interface LogWindow {
	readonly startedAt: Date | null
	readonly completedAt: Date | null
}

export const parseJobLog = (raw: string, step: LogWindow | null): readonly string[] => {
	// Compare at whole seconds: log stamps are truncated to seconds below, and step
	// times may carry milliseconds (mock fixtures do).
	const seconds = (date: Date) => Math.floor(date.getTime() / 1000) * 1000
	const from = step ? (step.startedAt ? seconds(step.startedAt) : Number.POSITIVE_INFINITY) : Number.NEGATIVE_INFINITY
	const to = step?.completedAt ? seconds(step.completedAt) + 1000 : Number.POSITIVE_INFINITY
	const lines: string[] = []
	for (const line of raw.split("\n")) {
		const first = line.indexOf("\t")
		const second = first === -1 ? -1 : line.indexOf("\t", first + 1)
		if (second === -1) continue
		const text = line.slice(second + 1)
		const stamp = LOG_TIMESTAMP.exec(text)
		if (step) {
			const at = stamp ? Date.parse(`${stamp[1]}Z`) : Number.NaN
			if (!(at >= from && at < to)) continue
		}
		lines.push((stamp ? text.slice(stamp[0].length) : text).replace(ANSI, "").replaceAll("\t", "  "))
	}
	return lines
}
