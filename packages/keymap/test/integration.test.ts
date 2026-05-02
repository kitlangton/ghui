import { describe, expect, test } from "bun:test"
import {
	createDispatcher,
	defineCommand,
	getActiveCommands,
	parseKey,
	scope,
} from "../src/index.ts"

interface AppState {
	closeModalActive: boolean
	hasSelection: boolean
	pullRequestOpen: boolean
	log: string[]
	closeModal: () => void
	confirmClose: () => void
	merge: () => void
	refresh: () => void
}

const makeState = (): AppState => {
	const state: AppState = {
		closeModalActive: false,
		hasSelection: false,
		pullRequestOpen: true,
		log: [],
		closeModal: () => state.log.push("closeModal"),
		confirmClose: () => state.log.push("confirmClose"),
		merge: () => state.log.push("merge"),
		refresh: () => state.log.push("refresh"),
	}
	return state
}

describe("integration — README example surface", () => {
	test("defining and dispatching commands like the README", () => {
		const state = makeState()

		const closeModalCommands = scope<AppState>(
			(s) => s.closeModalActive,
			[
				defineCommand({
					id: "close-modal.cancel",
					title: "Cancel",
					keys: ["escape"],
					run: (s) => s.closeModal(),
				}),
				defineCommand({
					id: "close-modal.confirm",
					title: "Close pull request",
					keys: ["return"],
					run: (s) => s.confirmClose(),
				}),
			],
		)

		const refresh = defineCommand<AppState>({
			id: "pull.refresh",
			title: "Refresh pull requests",
			group: "Pull request",
			keys: ["r"],
			run: (s) => s.refresh(),
		})

		const merge = defineCommand<AppState>({
			id: "pull.merge",
			title: "Merge pull request",
			group: "Pull request",
			keys: ["m"],
			enabled: (s) => s.hasSelection ? true : "Select a pull request first.",
			run: (s) => s.merge(),
		})

		const allCommands = [...closeModalCommands, refresh, merge]
		const dispatcher = createDispatcher(allCommands, () => state)

		// modal closed → escape is unbound
		expect(dispatcher.dispatch(parseKey("escape")).kind).toBe("ignored")

		// open modal → escape now closes it
		state.closeModalActive = true
		expect(dispatcher.dispatch(parseKey("escape")).kind).toBe("ran")
		expect(state.log).toEqual(["closeModal"])

		// modal open: r is shadowed by the modal scope (no, actually — r is global, not scoped to modal)
		// r should still fire even with modal open, since it has no `when`
		expect(dispatcher.dispatch(parseKey("r")).kind).toBe("ran")
		expect(state.log).toEqual(["closeModal", "refresh"])

		// merge with no selection → disabled with reason
		const result = dispatcher.dispatch(parseKey("m"))
		expect(result.kind).toBe("disabled")
		if (result.kind === "disabled") expect(result.reason).toBe("Select a pull request first.")

		// merge with selection → ran
		state.hasSelection = true
		expect(dispatcher.dispatch(parseKey("m")).kind).toBe("ran")
		expect(state.log).toEqual(["closeModal", "refresh", "merge"])
	})

	test("getActiveCommands powers a palette without coupling to the dispatcher", () => {
		const state = makeState()
		const commands = [
			defineCommand<AppState>({
				id: "pull.refresh",
				title: "Refresh",
				group: "Pull request",
				keys: ["r"],
				run: () => {},
			}),
			defineCommand<AppState>({
				id: "modal.cancel",
				title: "Cancel",
				keys: ["escape"],
				when: (s) => s.closeModalActive,
				run: () => {},
			}),
			defineCommand<AppState>({
				id: "merge",
				title: "Merge",
				keys: ["m"],
				enabled: (s) => s.hasSelection ? true : "Select a pull request first.",
				run: () => {},
			}),
		]

		// idle: only refresh
		expect(getActiveCommands(commands, state).map((c) => c.id)).toEqual(["pull.refresh"])

		// modal open: refresh + modal.cancel
		state.closeModalActive = true
		expect(getActiveCommands(commands, state).map((c) => c.id)).toEqual(["pull.refresh", "modal.cancel"])

		// selection added: refresh + modal.cancel + merge
		state.hasSelection = true
		expect(getActiveCommands(commands, state).map((c) => c.id)).toEqual([
			"pull.refresh",
			"modal.cancel",
			"merge",
		])
	})

	test("commands without keys still appear in palette but don't bind", () => {
		const state = makeState()
		const command = defineCommand<AppState>({
			id: "palette-only",
			title: "Open settings",
			run: () => state.log.push("settings"),
		})
		const dispatcher = createDispatcher([command], () => state)
		expect(dispatcher.dispatch(parseKey("escape")).kind).toBe("ignored")
		expect(getActiveCommands([command], state).map((c) => c.id)).toEqual(["palette-only"])
	})
})
