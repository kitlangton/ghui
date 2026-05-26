import { describe, expect, test } from "bun:test"
import { computeModalLayouts } from "../src/workspace/modalLayouts.ts"

describe("computeModalLayouts", () => {
	test("keeps every modal inside narrow terminal bounds", () => {
		const layouts = computeModalLayouts({ contentWidth: 30, terminalHeight: 12, longestLabelName: 48, longestDiffFileName: 72, changedFilesModalActive: true })

		for (const rect of Object.values(layouts)) {
			expect(rect.left).toBeGreaterThanOrEqual(0)
			expect(rect.top).toBeGreaterThanOrEqual(0)
			expect(rect.width).toBeLessThanOrEqual(30)
			expect(rect.height).toBeLessThanOrEqual(12)
		}
	})
})
