import { describe, expect, test } from "bun:test"
import {
	formatStroke,
	parseBinding,
	parseKey,
	sequenceMatches,
	sequenceStartsWith,
	strokeMatches,
} from "../src/keys.ts"

describe("parseKey", () => {
	test("plain key", () => {
		expect(parseKey("r")).toEqual({ key: "r", ctrl: false, shift: false, meta: false })
	})

	test("modifier+key", () => {
		expect(parseKey("ctrl+p")).toEqual({ key: "p", ctrl: true, shift: false, meta: false })
		expect(parseKey("shift+g")).toEqual({ key: "g", ctrl: false, shift: true, meta: false })
		expect(parseKey("meta+left")).toEqual({ key: "left", ctrl: false, shift: false, meta: true })
	})

	test("multiple modifiers", () => {
		expect(parseKey("ctrl+shift+p")).toEqual({ key: "p", ctrl: true, shift: true, meta: false })
	})

	test("case insensitive modifiers, lowercased key", () => {
		expect(parseKey("Ctrl+P")).toEqual({ key: "p", ctrl: true, shift: false, meta: false })
	})

	test("special key names pass through", () => {
		expect(parseKey("escape").key).toBe("escape")
		expect(parseKey("return").key).toBe("return")
		expect(parseKey("pageup").key).toBe("pageup")
	})
})

describe("parseBinding", () => {
	test("single stroke", () => {
		expect(parseBinding("r")).toHaveLength(1)
		expect(parseBinding("r")[0]!.key).toBe("r")
	})

	test("two-stroke sequence", () => {
		const seq = parseBinding("g g")
		expect(seq).toHaveLength(2)
		expect(seq.every((s) => s.key === "g")).toBe(true)
	})

	test("sequence with modifiers", () => {
		const seq = parseBinding("ctrl+x ctrl+c")
		expect(seq).toHaveLength(2)
		expect(seq[0]).toEqual({ key: "x", ctrl: true, shift: false, meta: false })
		expect(seq[1]).toEqual({ key: "c", ctrl: true, shift: false, meta: false })
	})

	test("trims and collapses whitespace", () => {
		expect(parseBinding("  g    g  ")).toHaveLength(2)
	})

	test("empty input is zero-length sequence", () => {
		expect(parseBinding("")).toHaveLength(0)
	})
})

describe("strokeMatches", () => {
	test("identical strokes match", () => {
		expect(strokeMatches(parseKey("r"), parseKey("r"))).toBe(true)
	})

	test("different keys don't match", () => {
		expect(strokeMatches(parseKey("r"), parseKey("s"))).toBe(false)
	})

	test("modifier difference matters", () => {
		expect(strokeMatches(parseKey("r"), parseKey("ctrl+r"))).toBe(false)
	})
})

describe("sequenceMatches", () => {
	test("equal sequences match", () => {
		expect(sequenceMatches(parseBinding("g g"), parseBinding("g g"))).toBe(true)
	})

	test("different lengths don't match", () => {
		expect(sequenceMatches(parseBinding("g"), parseBinding("g g"))).toBe(false)
	})
})

describe("sequenceStartsWith", () => {
	test("empty prefix always matches", () => {
		expect(sequenceStartsWith(parseBinding("g g"), [])).toBe(true)
	})

	test("partial prefix is a continuation", () => {
		expect(sequenceStartsWith(parseBinding("g g"), parseBinding("g"))).toBe(true)
	})

	test("non-matching prefix is not a continuation", () => {
		expect(sequenceStartsWith(parseBinding("g g"), parseBinding("h"))).toBe(false)
	})

	test("longer prefix than sequence is false", () => {
		expect(sequenceStartsWith(parseBinding("g"), parseBinding("g g"))).toBe(false)
	})

	test("equal-length matching counts as starts-with", () => {
		expect(sequenceStartsWith(parseBinding("g g"), parseBinding("g g"))).toBe(true)
	})
})

describe("formatStroke", () => {
	test("plain key", () => {
		expect(formatStroke(parseKey("r"))).toBe("r")
	})

	test("modifier order: ctrl, shift, meta", () => {
		expect(formatStroke(parseKey("ctrl+r"))).toBe("ctrl+r")
		expect(formatStroke(parseKey("shift+r"))).toBe("shift+r")
		expect(formatStroke(parseKey("meta+r"))).toBe("meta+r")
		expect(formatStroke(parseKey("shift+meta+ctrl+r"))).toBe("ctrl+shift+meta+r")
	})
})
