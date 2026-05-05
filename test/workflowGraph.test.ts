import { describe, expect, test } from "bun:test"
import type { WorkflowJob, WorkflowJobDependency } from "../src/domain.js"
import { renderWorkflowGraph, workflowGraphMaxScrollOffset } from "../src/ui/workflowGraph.js"

const makeJob = (name: string, status: WorkflowJob["status"] = "completed", conclusion: WorkflowJob["conclusion"] = "success"): WorkflowJob => ({
	id: Math.random(),
	name,
	status,
	conclusion,
	startedAt: null,
	completedAt: null,
	steps: [],
})

const makeDep = (id: string, name: string, needs: string[] = []): WorkflowJobDependency => ({ id, name, needs })

const renderText = (deps: readonly WorkflowJobDependency[], jobs: readonly WorkflowJob[], width = 200) => {
	const rows = renderWorkflowGraph({ dependencies: deps, jobs, contentWidth: width, scrollOffset: 0 })
	return rows.map((row) => row.segments.map((seg) => seg.text).join("")).map((line) => line.trimEnd())
}

const renderJoined = (deps: readonly WorkflowJobDependency[], jobs: readonly WorkflowJob[], width = 200) => renderText(deps, jobs, width).join("\n")

describe("renderWorkflowGraph", () => {
	test("empty inputs returns empty", () => {
		expect(renderWorkflowGraph({ dependencies: [], jobs: [], contentWidth: 80, scrollOffset: 0 })).toEqual([])
	})

	test("single plain node", () => {
		const deps = [makeDep("lint", "lint")]
		const jobs = [makeJob("lint")]
		const lines = renderText(deps, jobs)
		expect(lines.length).toBe(1)
		expect(lines[0]).toContain("✓ lint")
	})

	test("linear pipeline A → B → C", () => {
		const deps = [makeDep("a", "A"), makeDep("b", "B", ["a"]), makeDep("c", "C", ["b"])]
		const jobs = [makeJob("A"), makeJob("B"), makeJob("C")]
		const lines = renderText(deps, jobs)
		expect(lines.length).toBe(1)
		// Should have connectors between columns
		const line = lines[0]!
		expect(line).toContain("✓ A")
		expect(line).toContain("✓ B")
		expect(line).toContain("✓ C")
		expect(line).toContain("━")
	})

	test("fan-out: A → B, A → C", () => {
		const deps = [makeDep("a", "A"), makeDep("b", "B", ["a"]), makeDep("c", "C", ["a"])]
		const jobs = [makeJob("A"), makeJob("B"), makeJob("C")]
		const lines = renderText(deps, jobs)
		expect(lines.length).toBe(2)
		// Both B and C should appear
		const text = lines.join("\n")
		expect(text).toContain("✓ B")
		expect(text).toContain("✓ C")
	})

	test("fan-in: A → C, B → C", () => {
		const deps = [makeDep("a", "A"), makeDep("b", "B"), makeDep("c", "C", ["a", "b"])]
		const jobs = [makeJob("A"), makeJob("B"), makeJob("C")]
		const lines = renderText(deps, jobs)
		expect(lines.length).toBe(2)
		const text = lines.join("\n")
		expect(text).toContain("✓ A")
		expect(text).toContain("✓ B")
		expect(text).toContain("✓ C")
	})

	test("sub-jobs grouped into box node", () => {
		const deps = [makeDep("build", "Build"), makeDep("deploy", "Deploy", ["build"])]
		const jobs = [makeJob("Build"), makeJob("Deploy / Deploy (dev)"), makeJob("Deploy / Deploy (prod)"), makeJob("Deploy / Deploy (stage)")]
		const lines = renderText(deps, jobs)
		// Should have box with 3 children (height = 5: top + 3 children + bottom)
		// Plus Build is 1 row. Total height = max(1, 5) = 5
		expect(lines.length).toBe(5)
		const text = lines.join("\n")
		// Box should have border characters
		expect(text).toContain("┌")
		expect(text).toContain("┘")
		expect(text).toContain("Deploy (dev)")
		expect(text).toContain("Deploy (prod)")
		expect(text).toContain("Deploy (stage)")
		// Parent prefix should be stripped from child names
		expect(text).not.toContain("Deploy / Deploy")
	})

	test("sub-job aggregate status: any failure → ✗", () => {
		const deps = [makeDep("test", "Test")]
		const jobs = [makeJob("Test / Test (unit)", "completed", "success"), makeJob("Test / Test (integration)", "completed", "failure")]
		const lines = renderText(deps, jobs)
		const text = lines.join("\n")
		// Aggregate should show failure icon
		expect(text).toContain("✗ Test")
	})

	test("sub-job aggregate status: all success → ✓", () => {
		const deps = [makeDep("test", "Test")]
		const jobs = [makeJob("Test / Test (unit)", "completed", "success"), makeJob("Test / Test (integration)", "completed", "success")]
		const lines = renderText(deps, jobs)
		const text = lines.join("\n")
		expect(text).toContain("✓ Test")
	})

	test("sub-job aggregate status: any in_progress → ●", () => {
		const deps = [makeDep("test", "Test")]
		const jobs = [makeJob("Test / Test (unit)", "completed", "success"), makeJob("Test / Test (integration)", "in_progress", null)]
		const lines = renderText(deps, jobs)
		const text = lines.join("\n")
		expect(text).toContain("● Test")
	})

	test("per-column widths: columns have different widths", () => {
		const deps = [makeDep("a", "Short"), makeDep("b", "A Much Longer Name Here", ["a"])]
		const jobs = [makeJob("Short"), makeJob("A Much Longer Name Here")]
		const lines = renderText(deps, jobs)
		const line = lines[0]!
		// The first column should not be padded to the width of the second
		// "✓ Short" is 7 chars; "✓ A Much Longer Name Here" is 27 chars
		// With per-column widths, the gap should start around column 10 (min width)
		// NOT at column 27
		const gapIndex = line.indexOf("━")
		expect(gapIndex).toBeLessThan(27)
	})

	test("multi-gap edge: A (col 0) → D (col 3)", () => {
		const deps = [makeDep("a", "A"), makeDep("b", "B", ["a"]), makeDep("c", "C", ["b"]), makeDep("d", "D", ["a", "c"])]
		const jobs = [makeJob("A"), makeJob("B"), makeJob("C"), makeJob("D")]
		const lines = renderText(deps, jobs)
		// D depends on A (spans 3 gaps) and C (spans 1 gap)
		// Should render connector lines across intermediate gaps
		const text = lines.join("\n")
		expect(text).toContain("✓ A")
		expect(text).toContain("✓ D")
	})

	test("no dependencies: all jobs as independent roots", () => {
		const deps: WorkflowJobDependency[] = []
		const jobs = [makeJob("lint"), makeJob("test"), makeJob("build")]
		const lines = renderText(deps, jobs)
		// All three should appear, all in column 0
		expect(lines.length).toBe(3)
		const text = lines.join("\n")
		expect(text).toContain("✓ lint")
		expect(text).toContain("✓ test")
		expect(text).toContain("✓ build")
	})

	test("scroll offset clips the output", () => {
		const deps = [makeDep("a", "A"), makeDep("b", "B", ["a"])]
		const jobs = [makeJob("A"), makeJob("B")]
		const noScroll = renderWorkflowGraph({ dependencies: deps, jobs, contentWidth: 80, scrollOffset: 0 })
		const scrolled = renderWorkflowGraph({ dependencies: deps, jobs, contentWidth: 80, scrollOffset: 5 })
		const noScrollText = noScroll[0]?.segments.map((seg) => seg.text).join("") ?? ""
		const scrolledText = scrolled[0]?.segments.map((seg) => seg.text).join("") ?? ""
		// Scrolled output should not start with the same chars
		expect(scrolledText).not.toBe(noScrollText)
	})

	test("maxScrollOffset is non-negative", () => {
		const deps = [makeDep("a", "A"), makeDep("b", "B", ["a"])]
		const jobs = [makeJob("A"), makeJob("B")]
		const maxOffset = workflowGraphMaxScrollOffset({ dependencies: deps, jobs, contentWidth: 80 })
		expect(maxOffset).toBeGreaterThanOrEqual(0)
	})

	test("glue workflow: complex fan-out with sub-jobs", () => {
		const deps = [
			makeDep("extract", "Extract Glue jobs from labels"),
			makeDep("preview", "Preview Glue jobs", ["extract"]),
			makeDep("cleanup", "Cleanup preview Glue jobs", ["extract"]),
			makeDep("release", "Release Glue jobs", ["cleanup"]),
			makeDep("prod-gate", "Glue prod deploy gate", ["extract", "preview", "cleanup", "release"]),
		]
		const jobs = [
			makeJob("Extract Glue jobs from labels"),
			makeJob("Preview Glue jobs", "queued", null),
			// cleanup has sub-jobs
			makeJob("Cleanup preview Glue jobs / Release Glue jobs (dev)"),
			makeJob("Cleanup preview Glue jobs / Release Glue jobs (prod)"),
			makeJob("Cleanup preview Glue jobs / Release Glue jobs (stage)"),
			// release has sub-jobs
			makeJob("Release Glue jobs / Release Glue jobs (dev)", "completed", "failure"),
			// prod gate
			makeJob("Glue prod deploy gate", "completed", "failure"),
		]
		const lines = renderText(deps, jobs)
		const text = lines.join("\n")

		// Should have box nodes for cleanup and release
		expect(text).toContain("┌")
		expect(text).toContain("Release Glue jobs (dev)")
		expect(text).toContain("Release Glue jobs (prod)")
		expect(text).toContain("Release Glue jobs (stage)")
		// Should NOT show the full "Cleanup preview Glue jobs / Release Glue jobs (dev)"
		expect(text).not.toContain("Cleanup preview Glue jobs / ")
		// Plain nodes should appear
		expect(text).toContain("Extract Glue jobs from labels")
		expect(text).toContain("Preview Glue jobs")
		expect(text).toContain("Glue prod deploy gate")
		// Cleanup box should show aggregate success (all 3 sub-jobs succeeded)
		expect(text).toContain("✓ Cleanup preview Glue jobs")
		// Release box should show aggregate failure (sub-job failed)
		expect(text).toContain("✗ Release Glue jobs")

		// The Preview row should have ┗ (arriving from extract above) and ┛ (turning up toward prod-gate)
		const previewLine = lines.find((line) => line.includes("Preview Glue jobs"))
		expect(previewLine).toBeDefined()
		expect(previewLine).toContain("┗")
		expect(previewLine).toContain("┛")

		// Preview's line should be continuous (horizontal pass-through fills empty column)
		expect(previewLine).toContain("━━━━━━━━━━━━━━━━━━━")

		// Transitive reduction: no direct horizontal from extract to prod-gate at Y=0
		// Gap 0 should show ┓ (down only, no rightward horizontal), not ┳
		const firstLine = lines[0]!
		expect(firstLine).toContain("┓")
		expect(firstLine).not.toContain("┳")

		// Gap 1 between boxes at Y=0 should have no horizontal pass-through (three spaces)
		// The cleanup→release connection should be a single clean line (┏ and ┛, no ┻)
		expect(text).not.toContain("┻")
	})

	test("transitive reduction removes redundant edges", () => {
		// A → B → C → D, plus A → C and A → D (both redundant)
		const deps = [makeDep("a", "A"), makeDep("b", "B", ["a"]), makeDep("c", "C", ["b"]), makeDep("d", "D", ["c", "a", "b"])]
		const jobs = [makeJob("A"), makeJob("B"), makeJob("C"), makeJob("D")]
		const lines = renderText(deps, jobs)
		const text = lines.join("\n")
		// Should still show all nodes
		expect(text).toContain("✓ A")
		expect(text).toContain("✓ B")
		expect(text).toContain("✓ C")
		expect(text).toContain("✓ D")
		// Should be a simple linear chain (1 row) since redundant edges are removed
		expect(lines.length).toBe(1)
	})

	test("reference rendering: fan-out one-to-three", () => {
		const deps = [makeDep("a", "Build"), makeDep("b", "Unit Tests", ["a"]), makeDep("c", "Integration Tests", ["a"]), makeDep("d", "E2E Tests", ["a"])]
		const jobs = [makeJob("Build"), makeJob("Unit Tests"), makeJob("Integration Tests"), makeJob("E2E Tests")]
		expect(renderJoined(deps, jobs)).toBe("✓ Build━━━━┳━✓ E2E Tests\n" + "           ┣━✓ Integration Tests\n" + "           ┗━✓ Unit Tests")
	})

	test("reference rendering: fan-in three-to-one", () => {
		const deps = [makeDep("a", "Lint"), makeDep("b", "Test"), makeDep("c", "Typecheck"), makeDep("d", "Deploy", ["a", "b", "c"])]
		const jobs = [makeJob("Lint"), makeJob("Test"), makeJob("Typecheck"), makeJob("Deploy")]
		expect(renderJoined(deps, jobs)).toBe("✓ Lint━━━━━━┳━✓ Deploy\n✓ Test━━━━━━┫\n✓ Typecheck━┛")
	})

	test("reference rendering: diamond", () => {
		const deps = [makeDep("a", "Build"), makeDep("b", "Test Linux", ["a"]), makeDep("c", "Test macOS", ["a"]), makeDep("d", "Publish", ["b", "c"])]
		const jobs = [makeJob("Build"), makeJob("Test Linux"), makeJob("Test macOS"), makeJob("Publish")]
		expect(renderJoined(deps, jobs)).toBe("✓ Build━━━━┳━✓ Test Linux━┳━✓ Publish\n           ┗━✓ Test macOS━┛")
	})

	test("reference rendering: matrix box node", () => {
		const deps = [makeDep("build", "Build"), makeDep("test", "Test", ["build"]), makeDep("deploy", "Deploy", ["test"])]
		const jobs = [makeJob("Build"), makeJob("Test / Test (node-18)"), makeJob("Test / Test (node-20)"), makeJob("Test / Test (node-22)"), makeJob("Deploy")]
		expect(renderJoined(deps, jobs)).toBe(
			"✓ Build━━━━┓ ┌ ✓ Test ──────────┐ ┏━✓ Deploy\n" +
				"           ┃ │ ✓ Test (node-18) │ ┃\n" +
				"           ┗━│ ✓ Test (node-20) │━┛\n" +
				"             │ ✓ Test (node-22) │\n" +
				"             └──────────────────┘",
		)
	})

	test("reference rendering: sequential boxes with single clean bridge", () => {
		const deps = [makeDep("lint", "Lint"), makeDep("test", "Test", ["lint"]), makeDep("deploy", "Deploy", ["test"])]
		const jobs = [
			makeJob("Lint / Lint (eslint)"),
			makeJob("Lint / Lint (prettier)"),
			makeJob("Test / Test (unit)"),
			makeJob("Test / Test (integration)", "completed", "failure"),
			makeJob("Deploy"),
		]
		expect(renderJoined(deps, jobs)).toBe(
			"┌ ✓ Lint ───────────┐   ┌ ✗ Test ──────────────┐ ┏━✓ Deploy\n" +
				"│ ✓ Lint (eslint)   │   │ ✗ Test (integration) │ ┃\n" +
				"│ ✓ Lint (prettier) │━━━│ ✓ Test (unit)        │━┛\n" +
				"└───────────────────┘   └──────────────────────┘",
		)
	})

	test("reference rendering: cancelled and skipped jobs stay grey", () => {
		const deps = [makeDep("build", "Build"), makeDep("deploy", "Deploy", ["build"])]
		const jobs = [
			makeJob("Build"),
			makeJob("Deploy / Deploy (staging)", "completed", "success"),
			makeJob("Deploy / Deploy (production)", "completed", "cancelled"),
			makeJob("Deploy / Deploy (canary)", "completed", "skipped"),
		]
		expect(renderJoined(deps, jobs)).toBe(
			"✓ Build━━━━┓ ┌ ○ Deploy ─────────────┐\n" +
				"           ┃ │ ○ Deploy (canary)     │\n" +
				"           ┗━│ ○ Deploy (production) │\n" +
				"             │ ✓ Deploy (staging)    │\n" +
				"             └───────────────────────┘",
		)
	})

	test("reference rendering: full glue workflow keeps continuous preview line", () => {
		const deps = [
			makeDep("extract", "Extract Glue jobs from labels"),
			makeDep("preview", "Preview Glue jobs", ["extract"]),
			makeDep("cleanup", "Cleanup preview Glue jobs", ["extract"]),
			makeDep("release", "Release Glue jobs", ["cleanup"]),
			makeDep("prod-gate", "Glue prod deploy gate", ["extract", "preview", "cleanup", "release"]),
		]
		const jobs = [
			makeJob("Extract Glue jobs from labels"),
			makeJob("Preview Glue jobs", "queued", null),
			makeJob("Cleanup preview Glue jobs / Release Glue jobs (dev)"),
			makeJob("Cleanup preview Glue jobs / Release Glue jobs (prod)"),
			makeJob("Cleanup preview Glue jobs / Release Glue jobs (stage)"),
			makeJob("Release Glue jobs / Release Glue jobs (dev)", "completed", "failure"),
			makeJob("Glue prod deploy gate", "completed", "failure"),
		]
		expect(renderJoined(deps, jobs)).toBe(
			"✓ Extract Glue jobs from labels━┓ ┌ ✓ Cleanup preview Glue jobs ┐   ┌ ✗ Release Glue jobs ──────┐ ┏━✗ Glue prod deploy gate\n" +
				"                                ┃ │ ✓ Release Glue jobs (dev)   │ ┏━│ ✗ Release Glue jobs (dev) │━┫\n" +
				"                                ┣━│ ✓ Release Glue jobs (prod)  │━┛ └───────────────────────────┘ ┃\n" +
				"                                ┃ │ ✓ Release Glue jobs (stage) │                                 ┃\n" +
				"                                ┃ └─────────────────────────────┘                                 ┃\n" +
				"                                ┗━○ Preview Glue jobs━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛",
		)
	})
})
