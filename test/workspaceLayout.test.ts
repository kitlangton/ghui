import { describe, expect, it } from "vitest"
import { computeLayout } from "../src/workspace/layout.js"

describe("computeLayout", () => {
	it("treats terminals < 100 cols as narrow (single pane)", () => {
		const layout = computeLayout({ terminalWidth: 80, terminalHeight: 40, showWorkspaceTabs: true })
		expect(layout.isWideLayout).toBe(false)
		expect(layout.leftPaneWidth).toBe(layout.contentWidth)
		expect(layout.rightPaneWidth).toBe(layout.contentWidth)
	})

	it("splits at 100 cols exactly", () => {
		const layout = computeLayout({ terminalWidth: 100, terminalHeight: 40, showWorkspaceTabs: true })
		expect(layout.isWideLayout).toBe(true)
		expect(layout.leftPaneWidth + layout.rightPaneWidth + layout.splitGap).toBe(100)
	})

	it("honours minimum pane widths under squeeze", () => {
		const layout = computeLayout({ terminalWidth: 100, terminalHeight: 40, showWorkspaceTabs: true })
		expect(layout.leftPaneWidth).toBeGreaterThanOrEqual(44)
		expect(layout.rightPaneWidth).toBeGreaterThanOrEqual(28)
	})

	it("subtracts more vertical space when workspace tabs are shown", () => {
		const tabbed = computeLayout({ terminalWidth: 120, terminalHeight: 40, showWorkspaceTabs: true })
		const untabbed = computeLayout({ terminalWidth: 120, terminalHeight: 40, showWorkspaceTabs: false })
		expect(untabbed.wideBodyHeight).toBe(tabbed.wideBodyHeight + 2)
	})

	it("dividerJunctionAt tracks the left pane width", () => {
		const layout = computeLayout({ terminalWidth: 120, terminalHeight: 40, showWorkspaceTabs: true })
		expect(layout.dividerJunctionAt).toBe(layout.leftPaneWidth)
	})

	it("clamps fullscreenContentWidth to >= 24 even on tiny terminals", () => {
		const layout = computeLayout({ terminalWidth: 10, terminalHeight: 10, showWorkspaceTabs: false })
		expect(layout.fullscreenContentWidth).toBeGreaterThanOrEqual(24)
		expect(layout.wideBodyHeight).toBeGreaterThanOrEqual(8)
	})
})
