import { describe, expect, test } from "bun:test"
import type { RunJob, WorkflowRunDetails } from "../src/domain.js"
import { conclusionLabel, failureRowIndices, flattenRunRows, formatDuration, parseJobLog, runGlyph, runGlyphKind } from "../src/ui/runs/runsRows.js"

const date = (iso: string) => new Date(iso)

describe("runGlyphKind", () => {
	test("maps completed conclusions", () => {
		expect(runGlyphKind("completed", "success")).toBe("success")
		expect(runGlyphKind("completed", "failure")).toBe("failure")
		expect(runGlyphKind("completed", "timed_out")).toBe("failure")
		expect(runGlyphKind("completed", "cancelled")).toBe("cancelled")
		expect(runGlyphKind("completed", "skipped")).toBe("skipped")
		expect(runGlyphKind("completed", "neutral")).toBe("neutral")
		expect(runGlyphKind("completed", null)).toBe("neutral")
	})

	test("maps non-completed statuses regardless of conclusion", () => {
		expect(runGlyphKind("in_progress", null)).toBe("in-progress")
		expect(runGlyphKind("queued", null)).toBe("queued")
	})

	test("glyphs", () => {
		expect(runGlyph("completed", "success")).toBe("✓")
		expect(runGlyph("completed", "failure")).toBe("✗")
		expect(runGlyph("in_progress", null)).toBe("●")
		expect(runGlyph("queued", null)).toBe("○")
	})
})

describe("conclusionLabel", () => {
	test("status-driven for non-completed", () => {
		expect(conclusionLabel("queued", null)).toBe("queued")
		expect(conclusionLabel("in_progress", null)).toBe("in progress")
	})
	test("conclusion for completed", () => {
		expect(conclusionLabel("completed", "success")).toBe("success")
		expect(conclusionLabel("completed", null)).toBe("completed")
	})
})

describe("formatDuration", () => {
	const now = date("2026-01-01T00:05:00Z")
	test("seconds", () => {
		expect(formatDuration(date("2026-01-01T00:00:00Z"), date("2026-01-01T00:00:48Z"), now)).toBe("48s")
	})
	test("minutes and seconds", () => {
		expect(formatDuration(date("2026-01-01T00:00:00Z"), date("2026-01-01T00:01:41Z"), now)).toBe("1m41s")
	})
	test("whole minutes", () => {
		expect(formatDuration(date("2026-01-01T00:00:00Z"), date("2026-01-01T00:02:00Z"), now)).toBe("2m")
	})
	test("uses now when not completed", () => {
		expect(formatDuration(date("2026-01-01T00:04:00Z"), null, now)).toBe("1m")
	})
	test("dash when no start", () => {
		expect(formatDuration(null, null, now)).toBe("—")
	})
})

const job = (name: string, conclusion: RunJob["conclusion"], steps: RunJob["steps"]): RunJob => ({
	id: name.length,
	name,
	status: "completed",
	conclusion,
	startedAt: date("2026-01-01T00:00:00Z"),
	completedAt: date("2026-01-01T00:01:00Z"),
	url: "",
	steps,
})

const run: WorkflowRunDetails = {
	id: 1,
	number: 1,
	attempt: 1,
	workflowName: "CI",
	displayTitle: "t",
	event: "push",
	headBranch: "main",
	headSha: "abc",
	status: "completed",
	conclusion: "failure",
	url: "",
	createdAt: date("2026-01-01T00:00:00Z"),
	startedAt: date("2026-01-01T00:00:00Z"),
	updatedAt: date("2026-01-01T00:01:00Z"),
	jobs: [
		job("lint", "success", [{ number: 1, name: "Run lint", status: "completed", conclusion: "success", startedAt: null, completedAt: null }]),
		job("test", "failure", [
			{ number: 1, name: "install", status: "completed", conclusion: "success", startedAt: null, completedAt: null },
			{ number: 2, name: "run test", status: "completed", conclusion: "failure", startedAt: null, completedAt: null },
		]),
	],
}

describe("flattenRunRows", () => {
	test("interleaves job header rows with their step rows", () => {
		const rows = flattenRunRows(run)
		expect(rows.map((r) => (r.kind === "job" ? `job:${r.job.name}` : `step:${r.step.name}`))).toEqual(["job:lint", "step:Run lint", "job:test", "step:install", "step:run test"])
	})

	test("failureRowIndices points at the failing job and failing step", () => {
		const rows = flattenRunRows(run)
		// indices: 0 job:lint, 1 step, 2 job:test (failure), 3 step install, 4 step run test (failure)
		expect(failureRowIndices(rows)).toEqual([2, 4])
	})
})

describe("parseJobLog", () => {
	const raw = [
		"build\tUNKNOWN STEP\t\uFEFF2026-01-01T00:00:00.0000000Z ##[group]Runner",
		"build\tUNKNOWN STEP\t2026-01-01T00:00:01.5000000Z \x1b[32mok\x1b[0m\t^[[36;1mdone^[[0m",
		"build\tUNKNOWN STEP\t2026-01-01T00:00:03Z ##[error]Process completed with exit code 1.",
		"",
	].join("\n")
	const setup = { startedAt: date("2026-01-01T00:00:00Z"), completedAt: date("2026-01-01T00:00:01Z") }
	const tests = { startedAt: date("2026-01-01T00:00:02Z"), completedAt: null }

	test("selects a step by time window, strips BOM, timestamps and ANSI", () => {
		expect(parseJobLog(raw, setup)).toEqual(["##[group]Runner", "ok  done"])
		expect(parseJobLog(raw, tests)).toEqual(["##[error]Process completed with exit code 1."])
		expect(parseJobLog(raw, { startedAt: null, completedAt: null })).toEqual([])
	})

	test("null step keeps the whole job", () => {
		expect(parseJobLog(raw, null)).toHaveLength(3)
		expect(parseJobLog("", null)).toEqual([])
	})
})
