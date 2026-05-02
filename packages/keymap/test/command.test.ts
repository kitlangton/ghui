import { describe, expect, test } from "bun:test"
import { command } from "../src/command.ts"
import { formatSequence } from "../src/keys.ts"

interface Ctx {
	readonly hasSelection: boolean
	readonly log: string[]
}

describe("command()", () => {
	test("single key produces one binding", () => {
		const km = command<Ctx>({ id: "refresh", keys: ["r"], run: (s) => s.log.push("ran") })
		expect(km.bindings).toHaveLength(1)
		expect(formatSequence(km.bindings[0]!.sequence)).toBe("r")
	})

	test("multiple keys produce multiple bindings sharing meta and action", () => {
		const km = command<Ctx>({ id: "down", keys: ["j", "down"], run: (s) => s.log.push("ran") })
		expect(km.bindings).toHaveLength(2)
		expect(km.bindings[0]!.meta).toEqual(km.bindings[1]!.meta!)
		expect(km.bindings[0]!.action).toBe(km.bindings[1]!.action)
	})

	test("meta carries id, title, description, group", () => {
		const km = command<Ctx>({
			id: "x",
			title: "X",
			description: "Does X",
			group: "Tools",
			keys: ["x"],
			run: () => {},
		})
		expect(km.bindings[0]!.meta).toEqual({
			id: "x",
			title: "X",
			description: "Does X",
			group: "Tools",
		})
	})

	test("when and enabled passed through", () => {
		const km = command<Ctx>({
			id: "merge",
			keys: ["m"],
			when: (s) => s.hasSelection,
			enabled: (s) => s.log.length === 0 ? true : "Already ran.",
			run: () => {},
		})
		expect(km.bindings[0]!.when).toBeDefined()
		expect(km.bindings[0]!.enabled).toBeDefined()
	})

	test("string-form keys works as single binding", () => {
		const km = command<Ctx>({ id: "x", keys: "r", run: () => {} })
		expect(km.bindings).toHaveLength(1)
		expect(formatSequence(km.bindings[0]!.sequence)).toBe("r")
	})

	test("commands without id (palette-only suppressed) still produce bindings", () => {
		const km = command<Ctx>({ keys: ["x"], run: () => {} })
		expect(km.bindings).toHaveLength(1)
		expect(km.bindings[0]!.meta).toBeUndefined()
	})

	test("composes via union and contramap", () => {
		const km = command<Ctx>({ id: "r", keys: ["r"], run: (s) => s.log.push("r") })
			.union(command<Ctx>({ id: "s", keys: ["s"], run: (s) => s.log.push("s") }))
		expect(km.bindings).toHaveLength(2)
	})
})
