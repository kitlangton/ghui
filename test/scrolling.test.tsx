import { beforeAll, describe, expect, test } from "bun:test"
import { act } from "react"

// Quiet React's "update outside act" warnings from atom-driven loading frames and
// timers we can't synchronously enclose. Real correctness is asserted via captured
// frames below.
//
// We also guard against React's "Cannot update a component while rendering a
// different component" warning, but allow the known-benign App-on-App case.
// That case is a cross-test atom-react timing artifact: tests run back-to-back
// in the same process, the previous RegistryProvider defers `registry.dispose()`
// by 500ms, and any in-flight runtime-atom Effect from the prior test can fire
// listeners that schedule updates on the prior App fiber while the current App
// is rendering. Both fibers report as "App". App is the root component in
// production, so this scenario cannot occur outside the test runner. If a real
// setState-during-render bug ever lands (e.g. a child component subscribes and
// the warning involves a non-App fiber), this guard will still catch it.
const originalConsoleError = console.error
console.error = (...args: unknown[]) => {
	const first = args[0]
	if (typeof first === "string" && first.includes("inside a test was not wrapped in act")) return
	if (typeof first === "string" && first.includes("Cannot update a component")) {
		if (args[1] === "App" && args[2] === "App") return
		throw new Error(first)
	}
	originalConsoleError(...args)
}

// Set env before any App-side module is loaded. Static imports above are intentionally
// limited to test-only modules — App is dynamically imported.
process.env.GHUI_MOCK_PR_COUNT = "80"
process.env.GHUI_MOCK_REPO_COUNT = "4"
process.env.GHUI_PR_PAGE_SIZE = "100"

const loadApp = async () => {
	const { createTestRenderer } = await import("@opentui/core/testing")
	const { createRoot } = await import("@opentui/react")
	const { RegistryProvider } = await import("@effect/atom-react")
	const { App } = await import("../src/App.tsx")
	return { createTestRenderer, createRoot, RegistryProvider, App }
}

let cached: Awaited<ReturnType<typeof loadApp>> | null = null
beforeAll(async () => {
	// @ts-expect-error — globalThis.IS_REACT_ACT_ENVIRONMENT
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	cached = await loadApp()
})

const stepFrame = async (renderOnce: () => Promise<void>) => {
	await act(async () => {
		await renderOnce()
		await new Promise<void>((resolve) => setTimeout(resolve, 1))
	})
}

const settle = async (renderOnce: () => Promise<void>, predicate: () => boolean, attempts = 60) => {
	for (let i = 0; i < attempts; i++) {
		await stepFrame(renderOnce)
		if (predicate()) return true
	}
	return false
}

const setupApp = async (cols = 100, rows = 20) => {
	if (!cached) cached = await loadApp()
	const { createTestRenderer, createRoot, RegistryProvider, App } = cached
	const setup = await createTestRenderer({ width: cols, height: rows })
	const root = createRoot(setup.renderer)
	act(() => {
		root.render(
			<RegistryProvider>
				<App />
			</RegistryProvider>,
		)
	})
	const ready = await settle(setup.renderOnce, () => setup.captureCharFrame().includes("Mock PR"))
	if (!ready) throw new Error("App never rendered mock PRs:\n" + setup.captureCharFrame())
	return setup
}

const detailPaneNumber = (frame: string) => {
	for (const line of frame.split("\n")) {
		const trimmed = line.trim()
		const match = trimmed.match(/#(\d{4,})\s+mock-branch-/)
		if (match) return Number.parseInt(match[1]!, 10)
	}
	return null
}

const leftPaneNumbers = (frame: string) => {
	const numbers: number[] = []
	for (const line of frame.split("\n")) {
		const match = line.match(/#(\d{4,})\s+Mock PR/)
		if (match) numbers.push(Number.parseInt(match[1]!, 10))
	}
	return numbers
}

// Returns the screen-row index (0-based) where `prNumber` appears as a left-pane row.
// Left-pane rows have the literal form: `#1234 Mock PR 1234:`.
const leftPaneRowOf = (frame: string, prNumber: number) => {
	const lines = frame.split("\n")
	const needle = new RegExp(`#${prNumber}\\s+Mock PR ${prNumber}:`)
	for (let i = 0; i < lines.length; i++) {
		if (needle.test(lines[i]!)) return i
	}
	return null
}

const press = async (
	mockInput: { pressArrow: (d: "up" | "down" | "left" | "right") => void; pressKey: (k: string, m?: { shift?: boolean }) => void },
	renderOnce: () => Promise<void>,
	key: { kind: "arrow"; dir: "up" | "down" | "left" | "right" } | { kind: "key"; name: string; shift?: boolean },
	settleFrames = 2,
) => {
	await act(async () => {
		if (key.kind === "arrow") mockInput.pressArrow(key.dir)
		else mockInput.pressKey(key.name, { shift: key.shift })
	})
	for (let i = 0; i < settleFrames; i++) await stepFrame(renderOnce)
}

// Mock allocates PRs as `index` ranging 0..N-1 where:
//   repository = `mock-org/repo-${index % repoCount}`
//   number     = 1000 + index
// The UI groups by repo then flattens. So flat-visible index `i` (0..N-1) maps to:
//   group       = Math.floor(i / prsPerRepo)
//   localOffset = i % prsPerRepo
//   underlying mock-index = group + localOffset * repoCount
//   number      = 1000 + (group + localOffset * repoCount)
const PRS_PER_REPO = 20
const REPO_COUNT = 4
const numberFromIndex = (flatIndex: number) => {
	const group = Math.floor(flatIndex / PRS_PER_REPO)
	const local = flatIndex % PRS_PER_REPO
	return 1000 + group + local * REPO_COUNT
}

describe("PR list scrolling", () => {
	test("initial selection points at first PR", async () => {
		const { captureCharFrame, renderer } = await setupApp(100, 20)
		expect(detailPaneNumber(captureCharFrame())).toBe(numberFromIndex(0))
		renderer.destroy()
	})

	test("details show comments summary in header without inlining comment bodies", async () => {
		const { captureCharFrame, renderOnce, renderer } = await setupApp(120, 24)
		const loaded = await settle(renderOnce, () => {
			const frame = captureCharFrame()
			return frame.includes("Line B") && frame.includes("Comments") && frame.includes("press c to view all")
		})
		expect(loaded).toBe(true)
		const frame = captureCharFrame()
		expect(frame.indexOf("Comments")).toBeLessThan(frame.indexOf("Line B"))
		expect(frame).not.toContain("Top-level discussion")
		renderer.destroy()
	})

	test("diff arrows preserve left/right side preference across minimized context rows", async () => {
		const { captureCharFrame, mockInput, renderOnce, renderer } = await setupApp(120, 24)
		await press(mockInput, renderOnce, { kind: "key", name: "d" }, 4)
		const loaded = await settle(renderOnce, () => captureCharFrame().includes("src/mockDiff.ts"))
		expect(loaded).toBe(true)

		await press(mockInput, renderOnce, { kind: "arrow", dir: "left" })
		await press(mockInput, renderOnce, { kind: "arrow", dir: "down" })
		expect(captureCharFrame()).toContain("← -2")

		await press(mockInput, renderOnce, { kind: "arrow", dir: "down" })
		await press(mockInput, renderOnce, { kind: "arrow", dir: "down" })
		expect(captureCharFrame()).toContain("← -4")

		await press(mockInput, renderOnce, { kind: "arrow", dir: "right" })
		expect(captureCharFrame()).toContain("→ +4")
		renderer.destroy()
	})

	test("each down/up moves selection by exactly one", async () => {
		const { mockInput, renderOnce, captureCharFrame, renderer } = await setupApp(100, 20)
		const trail: number[] = []
		for (let i = 0; i < 6; i++) {
			await press(mockInput, renderOnce, { kind: "arrow", dir: "down" })
			trail.push(detailPaneNumber(captureCharFrame())!)
		}
		expect(trail).toEqual([numberFromIndex(1), numberFromIndex(2), numberFromIndex(3), numberFromIndex(4), numberFromIndex(5), numberFromIndex(6)])
		for (let i = 0; i < 3; i++) {
			await press(mockInput, renderOnce, { kind: "arrow", dir: "up" })
		}
		expect(detailPaneNumber(captureCharFrame())).toBe(numberFromIndex(3))
		renderer.destroy()
	})

	test("each j/k moves selection by exactly one", async () => {
		const { mockInput, renderOnce, captureCharFrame, renderer } = await setupApp(100, 20)
		await press(mockInput, renderOnce, { kind: "key", name: "j" })
		expect(detailPaneNumber(captureCharFrame())).toBe(numberFromIndex(1))
		await press(mockInput, renderOnce, { kind: "key", name: "j" })
		expect(detailPaneNumber(captureCharFrame())).toBe(numberFromIndex(2))
		await press(mockInput, renderOnce, { kind: "key", name: "k" })
		expect(detailPaneNumber(captureCharFrame())).toBe(numberFromIndex(1))
		renderer.destroy()
	})

	test("rapid down keys advance one row each, no skips", async () => {
		const { mockInput, renderOnce, captureCharFrame, renderer } = await setupApp(100, 20)
		for (let i = 0; i < 30; i++) {
			await press(mockInput, renderOnce, { kind: "arrow", dir: "down" }, 1)
		}
		expect(detailPaneNumber(captureCharFrame())).toBe(numberFromIndex(30))
		expect(leftPaneNumbers(captureCharFrame())).toContain(numberFromIndex(30))
		renderer.destroy()
	})

	test("selected row stays inside the visible left pane with margin", async () => {
		// Body height for the left scrollbox is wideBodyHeight = max(8, terminalHeight - 4) = 16 here.
		// Header lines occupy rows 0..2 (header + divider + section title). Content scrollbox spans
		// roughly screen rows 3..18. Scroll-off margin is 2.
		const TERMINAL_ROWS = 20
		const BODY_TOP = 2 // first row of the body area
		const BODY_BOTTOM = TERMINAL_ROWS - 2 // last row before footer
		const SCROLL_OFF = 2

		const { mockInput, renderOnce, captureCharFrame, renderer } = await setupApp(100, TERMINAL_ROWS)

		for (let i = 0; i < 18; i++) {
			await press(mockInput, renderOnce, { kind: "arrow", dir: "down" }, 1)
		}
		const frame = captureCharFrame()
		const selected = detailPaneNumber(frame)
		expect(selected).toBe(numberFromIndex(18))
		const row = leftPaneRowOf(frame, selected!)
		expect(row).not.toBeNull()
		// Selection should be inside the visible body, with margin from top/bottom.
		expect(row!).toBeGreaterThanOrEqual(BODY_TOP + SCROLL_OFF - 1)
		expect(row!).toBeLessThanOrEqual(BODY_BOTTOM - SCROLL_OFF + 1)
		renderer.destroy()
	})

	test("Shift+G jumps to last and reveals it", async () => {
		const { mockInput, renderOnce, captureCharFrame, renderer } = await setupApp(100, 20)
		await press(mockInput, renderOnce, { kind: "key", name: "G", shift: true }, 4)
		const frame = captureCharFrame()
		expect(detailPaneNumber(frame)).toBe(numberFromIndex(79))
		expect(leftPaneNumbers(frame)).toContain(numberFromIndex(79))
		renderer.destroy()
	})

	test("gg jumps back to first and reveals it", async () => {
		const { mockInput, renderOnce, captureCharFrame, renderer } = await setupApp(100, 20)
		// First go to bottom.
		await press(mockInput, renderOnce, { kind: "key", name: "G", shift: true }, 4)
		expect(detailPaneNumber(captureCharFrame())).toBe(numberFromIndex(79))
		// Then gg back to top.
		await press(mockInput, renderOnce, { kind: "key", name: "g" }, 1)
		await press(mockInput, renderOnce, { kind: "key", name: "g" }, 4)
		const frame = captureCharFrame()
		expect(detailPaneNumber(frame)).toBe(numberFromIndex(0))
		expect(leftPaneNumbers(frame)).toContain(numberFromIndex(0))
		renderer.destroy()
	})

	test("burst of down keys without intermediate renders advances exactly that many rows", async () => {
		// This simulates auto-repeat: many keypresses arrive before React can render.
		const { mockInput, renderOnce, captureCharFrame, renderer } = await setupApp(100, 20)
		await act(async () => {
			for (let i = 0; i < 20; i++) mockInput.pressArrow("down")
		})
		// Now flush — selectedIndex should be exactly 20 (one step per press).
		for (let i = 0; i < 6; i++) await stepFrame(renderOnce)
		expect(detailPaneNumber(captureCharFrame())).toBe(numberFromIndex(20))
		expect(leftPaneNumbers(captureCharFrame())).toContain(numberFromIndex(20))
		renderer.destroy()
	})

	test("after refresh, pressing down still advances by one (no jump)", async () => {
		const { mockInput, renderOnce, captureCharFrame, renderer } = await setupApp(100, 20)

		// Walk down a bit so selection is mid-list.
		for (let i = 0; i < 12; i++) await press(mockInput, renderOnce, { kind: "arrow", dir: "down" }, 1)
		const beforeRefresh = detailPaneNumber(captureCharFrame())
		expect(beforeRefresh).toBe(numberFromIndex(12))

		// Refresh.
		await press(mockInput, renderOnce, { kind: "key", name: "r" }, 6)
		expect(detailPaneNumber(captureCharFrame())).toBe(beforeRefresh)

		// Single down should advance by one.
		await press(mockInput, renderOnce, { kind: "arrow", dir: "down" }, 2)
		expect(detailPaneNumber(captureCharFrame())).toBe(numberFromIndex(13))
		// And up returns to where we were.
		await press(mockInput, renderOnce, { kind: "arrow", dir: "up" }, 2)
		expect(detailPaneNumber(captureCharFrame())).toBe(numberFromIndex(12))
		renderer.destroy()
	})

	test("alternating j/k bursts net out to zero displacement", async () => {
		const { mockInput, renderOnce, captureCharFrame, renderer } = await setupApp(100, 20)
		await act(async () => {
			for (let i = 0; i < 30; i++) {
				mockInput.pressKey("j")
				mockInput.pressKey("k")
			}
		})
		for (let i = 0; i < 6; i++) await stepFrame(renderOnce)
		expect(detailPaneNumber(captureCharFrame())).toBe(numberFromIndex(0))
		renderer.destroy()
	})

	test("arrow keys do not double-scroll: selection still moves one row at a time mid-list", async () => {
		// Regression: ScrollBox is focusable by default. If we don't disable that, arrow keys
		// scroll the scrollbox itself in addition to advancing selectedIndex via useKeyboard,
		// which makes the list "jump wildly" on long lists.
		const { mockInput, renderOnce, captureCharFrame, renderer } = await setupApp(100, 20)

		// Walk down 25 rows so the list is mid-scroll.
		for (let i = 0; i < 25; i++) await press(mockInput, renderOnce, { kind: "arrow", dir: "down" }, 1)
		expect(detailPaneNumber(captureCharFrame())).toBe(numberFromIndex(25))

		// One more press → exactly one PR step in the detail pane.
		await press(mockInput, renderOnce, { kind: "arrow", dir: "down" }, 2)
		expect(detailPaneNumber(captureCharFrame())).toBe(numberFromIndex(26))

		// And the row right above the selected should still be the previous PR (no skip).
		const frame = captureCharFrame()
		const selectedRow = leftPaneRowOf(frame, numberFromIndex(26))
		expect(selectedRow).not.toBeNull()
		const lines = frame.split("\n")
		const above = lines[selectedRow! - 1]!
		expect(above).toMatch(new RegExp(`#${numberFromIndex(25)}\\s+Mock PR`))
		renderer.destroy()
	})

	test("] jumps to next group, [ to previous", async () => {
		const { mockInput, renderOnce, captureCharFrame, renderer } = await setupApp(100, 20)
		// 80 PRs / 4 repos = 20 PRs per group; group starts at flat indices 0, 20, 40, 60.
		await press(mockInput, renderOnce, { kind: "key", name: "]" }, 3)
		expect(detailPaneNumber(captureCharFrame())).toBe(numberFromIndex(20))

		await press(mockInput, renderOnce, { kind: "key", name: "]" }, 3)
		expect(detailPaneNumber(captureCharFrame())).toBe(numberFromIndex(40))

		await press(mockInput, renderOnce, { kind: "key", name: "[" }, 3)
		expect(detailPaneNumber(captureCharFrame())).toBe(numberFromIndex(20))
		renderer.destroy()
	})
})
