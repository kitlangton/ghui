import { describe, expect, test } from "bun:test"
import {
	type Command,
	defineCommand,
	getActiveCommands,
	isCommandActive,
	scope,
} from "../src/commands.ts"

interface State {
	readonly modal: boolean
	readonly hasSelection: boolean
}

const idle: State = { modal: false, hasSelection: false }
const inModal: State = { modal: true, hasSelection: false }
const withSelection: State = { modal: false, hasSelection: true }

describe("defineCommand", () => {
	test("returns the command unchanged", () => {
		const command = defineCommand({
			id: "test",
			title: "Test",
			keys: ["t"],
			run: () => {},
		})
		expect(command.id).toBe("test")
	})
})

describe("isCommandActive", () => {
	test("no when, no enabled → active", () => {
		const command = defineCommand<State>({ id: "x", title: "X", keys: ["x"], run: () => {} })
		expect(isCommandActive(command, idle)).toBe(true)
	})

	test("when returning false → inactive", () => {
		const command = defineCommand<State>({
			id: "x",
			title: "X",
			keys: ["x"],
			when: (s) => s.modal,
			run: () => {},
		})
		expect(isCommandActive(command, idle)).not.toBe(true)
		expect(isCommandActive(command, inModal)).toBe(true)
	})

	test("enabled returning false → disabled string", () => {
		const command = defineCommand<State>({
			id: "x",
			title: "X",
			keys: ["x"],
			enabled: () => false,
			run: () => {},
		})
		expect(typeof isCommandActive(command, idle)).toBe("string")
	})

	test("enabled returning a reason string → that string", () => {
		const command = defineCommand<State>({
			id: "merge",
			title: "Merge",
			keys: ["m"],
			enabled: (s) => s.hasSelection ? true : "Select a pull request first.",
			run: () => {},
		})
		expect(isCommandActive(command, idle)).toBe("Select a pull request first.")
		expect(isCommandActive(command, withSelection)).toBe(true)
	})
})

describe("scope", () => {
	test("merges when conditions with AND", () => {
		const inner = defineCommand<State>({
			id: "x",
			title: "X",
			keys: ["x"],
			when: (s) => s.hasSelection,
			run: () => {},
		})
		const [scoped] = scope<State>((s) => s.modal, [inner])
		expect(isCommandActive(scoped!, idle)).not.toBe(true)
		expect(isCommandActive(scoped!, inModal)).not.toBe(true)
		expect(isCommandActive(scoped!, withSelection)).not.toBe(true)
		expect(isCommandActive(scoped!, { modal: true, hasSelection: true })).toBe(true)
	})

	test("preserves command identity fields", () => {
		const inner = defineCommand<State>({ id: "x", title: "X", keys: ["x"], run: () => {} })
		const [scoped] = scope<State>(() => true, [inner])
		expect(scoped!.id).toBe("x")
		expect(scoped!.title).toBe("X")
		expect(scoped!.keys).toEqual(["x"])
	})
})

describe("getActiveCommands", () => {
	test("filters out scope-inactive commands", () => {
		const commands: readonly Command<State>[] = [
			defineCommand({ id: "always", title: "Always", run: () => {} }),
			defineCommand({ id: "modal-only", title: "Modal", when: (s) => s.modal, run: () => {} }),
		]
		expect(getActiveCommands(commands, idle).map((c) => c.id)).toEqual(["always"])
		expect(getActiveCommands(commands, inModal).map((c) => c.id)).toEqual(["always", "modal-only"])
	})

	test("filters out enabled === false", () => {
		const commands: readonly Command<State>[] = [
			defineCommand({ id: "alive", title: "Alive", run: () => {} }),
			defineCommand({ id: "dead", title: "Dead", enabled: () => false, run: () => {} }),
		]
		expect(getActiveCommands(commands, idle).map((c) => c.id)).toEqual(["alive"])
	})

	test("keeps commands with enabled returning a reason string (still bindable, just disabled)", () => {
		// Decision: getActiveCommands returns commands whose `when` passes AND
		// whose enabled is true. A reason string is treated like false here —
		// the command is in scope but currently unrunnable.
		const commands: readonly Command<State>[] = [
			defineCommand({ id: "merge", title: "Merge", enabled: () => "Select first.", run: () => {} }),
		]
		expect(getActiveCommands(commands, idle)).toEqual([])
	})
})
