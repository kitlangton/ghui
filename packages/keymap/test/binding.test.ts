import { describe, expect, test } from "bun:test"
import { type Binding, isBindingActive } from "../src/binding.ts"
import { parseBinding } from "../src/keys.ts"

interface Ctx {
	readonly modal: boolean
	readonly hasSelection: boolean
}

const make = (overrides: Partial<Binding<Ctx>> = {}): Binding<Ctx> => ({
	sequence: parseBinding("x"),
	action: () => {},
	...overrides,
})

describe("isBindingActive", () => {
	test("no when, no enabled → true", () => {
		expect(isBindingActive(make(), { modal: false, hasSelection: false })).toBe(true)
	})

	test("when=false → out of scope", () => {
		const binding = make({ when: (c) => c.modal })
		expect(isBindingActive(binding, { modal: false, hasSelection: false })).toBe("out of scope")
	})

	test("when=true, no enabled → true", () => {
		const binding = make({ when: (c) => c.modal })
		expect(isBindingActive(binding, { modal: true, hasSelection: false })).toBe(true)
	})

	test("enabled=false → 'disabled'", () => {
		const binding = make({ enabled: () => false })
		expect(isBindingActive(binding, { modal: false, hasSelection: false })).toBe("disabled")
	})

	test("enabled returns reason string → reason", () => {
		const binding = make({ enabled: (c) => c.hasSelection ? true : "Select first." })
		expect(isBindingActive(binding, { modal: false, hasSelection: false })).toBe("Select first.")
		expect(isBindingActive(binding, { modal: false, hasSelection: true })).toBe(true)
	})
})
