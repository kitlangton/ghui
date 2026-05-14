import { describe, expect, it } from "vitest"
import { computeLayout, diffFilePanelWidthFor } from "../src/workspace/layout.js"

const noPanel = { showDiffFilePanel: false, diffFilePanelWidth: 0 } as const

describe("computeLayout", () => {
	it("treats terminals < 100 cols as narrow (single pane)", () => {
		const layout = computeLayout({ terminalWidth: 80, terminalHeight: 40, showWorkspaceTabs: true, ...noPanel })
		expect(layout.isWideLayout).toBe(false)
		expect(layout.leftPaneWidth).toBe(layout.contentWidth)
		expect(layout.rightPaneWidth).toBe(layout.contentWidth)
	})

	it("splits at 100 cols exactly", () => {
		const layout = computeLayout({ terminalWidth: 100, terminalHeight: 40, showWorkspaceTabs: true, ...noPanel })
		expect(layout.isWideLayout).toBe(true)
		expect(layout.leftPaneWidth + layout.rightPaneWidth + layout.splitGap).toBe(100)
	})

	it("honours minimum pane widths under squeeze", () => {
		const layout = computeLayout({ terminalWidth: 100, terminalHeight: 40, showWorkspaceTabs: true, ...noPanel })
		expect(layout.leftPaneWidth).toBeGreaterThanOrEqual(44)
		expect(layout.rightPaneWidth).toBeGreaterThanOrEqual(28)
	})

	it("subtracts more vertical space when workspace tabs are shown", () => {
		const tabbed = computeLayout({ terminalWidth: 120, terminalHeight: 40, showWorkspaceTabs: true, ...noPanel })
		const untabbed = computeLayout({ terminalWidth: 120, terminalHeight: 40, showWorkspaceTabs: false, ...noPanel })
		expect(untabbed.wideBodyHeight).toBe(tabbed.wideBodyHeight + 2)
	})

	it("dividerJunctionAt tracks the left pane width", () => {
		const layout = computeLayout({ terminalWidth: 120, terminalHeight: 40, showWorkspaceTabs: true, ...noPanel })
		expect(layout.dividerJunctionAt).toBe(layout.leftPaneWidth)
	})

	it("clamps fullscreenContentWidth to >= 24 even on tiny terminals", () => {
		const layout = computeLayout({ terminalWidth: 10, terminalHeight: 10, showWorkspaceTabs: false, ...noPanel })
		expect(layout.fullscreenContentWidth).toBeGreaterThanOrEqual(24)
		expect(layout.wideBodyHeight).toBeGreaterThanOrEqual(8)
	})

	it("subtracts the diff file panel + divider from the diff pane width", () => {
		const off = computeLayout({ terminalWidth: 150, terminalHeight: 40, showWorkspaceTabs: false, showDiffFilePanel: false, diffFilePanelWidth: 30 })
		const on = computeLayout({ terminalWidth: 150, terminalHeight: 40, showWorkspaceTabs: false, showDiffFilePanel: true, diffFilePanelWidth: 30 })
		expect(off.diffFilePanelEffectiveWidth).toBe(0)
		expect(off.diffPaneWidth).toBe(150)
		expect(on.diffFilePanelEffectiveWidth).toBe(30)
		// 150 (terminal) − 30 (panel) − 1 (divider) = 119
		expect(on.diffPaneWidth).toBe(119)
	})

	it("clamps the panel width so the diff keeps at least 60 cols", () => {
		const tight = computeLayout({ terminalWidth: 80, terminalHeight: 40, showWorkspaceTabs: false, showDiffFilePanel: true, diffFilePanelWidth: 40 })
		expect(tight.diffPaneWidth).toBeGreaterThanOrEqual(60)
		expect(tight.diffFilePanelEffectiveWidth + 1 + tight.diffPaneWidth).toBeLessThanOrEqual(tight.contentWidth)
	})
})

describe("diffFilePanelWidthFor", () => {
	it("clamps below the lower bound", () => {
		expect(diffFilePanelWidthFor(80)).toBe(28)
		expect(diffFilePanelWidthFor(120)).toBe(28)
	})

	it("scales linearly between the bounds", () => {
		expect(diffFilePanelWidthFor(150)).toBe(33)
		expect(diffFilePanelWidthFor(200)).toBe(44)
		expect(diffFilePanelWidthFor(250)).toBe(55)
	})

	it("clamps above the upper bound", () => {
		expect(diffFilePanelWidthFor(300)).toBe(60)
		expect(diffFilePanelWidthFor(500)).toBe(60)
	})
})
