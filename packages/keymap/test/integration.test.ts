import { describe, expect, test } from "bun:test"
import { command, createDispatcher, Keymap, parseKey } from "../src/index.ts"

interface DiffState {
	readonly lines: string[]
	readonly scrollBy: (delta: number) => void
}

interface DetailState {
	readonly log: string[]
	readonly scrollDetailBy: (delta: number) => void
}

interface AppCtx {
	readonly view: "list" | "diff" | "detail"
	readonly modal: boolean
	readonly hasSelection: boolean
	readonly diff: DiffState
	readonly detail: DetailState
	readonly log: string[]
	readonly closeModal: () => void
	readonly merge: () => void
	readonly refresh: () => void
}

const makeAppCtx = (overrides: Partial<AppCtx> = {}): AppCtx => {
	const ctx: AppCtx = {
		view: "list",
		modal: false,
		hasSelection: false,
		diff: {
			lines: [],
			scrollBy: (delta) => {
				ctx.diff.lines.push(`scroll:${delta}`)
			},
		},
		detail: {
			log: [],
			scrollDetailBy: (delta) => {
				ctx.detail.log.push(`scroll:${delta}`)
			},
		},
		log: [],
		closeModal: () => {
			ctx.log.push("close")
		},
		merge: () => {
			ctx.log.push("merge")
		},
		refresh: () => {
			ctx.log.push("refresh")
		},
		...overrides,
	}
	return ctx
}

describe("integration — compositional API", () => {
	test("a sub-keymap defined over its own state lifts cleanly into the app", () => {
		const diffKm: Keymap<DiffState> = Keymap.union(
			command({ id: "diff.up", title: "Up", keys: ["k", "up"], run: (s) => s.scrollBy(-1) }),
			command({ id: "diff.down", title: "Down", keys: ["j", "down"], run: (s) => s.scrollBy(1) }),
		)

		const appKm: Keymap<AppCtx> = diffKm.contramapMaybe((a) => a.view === "diff" ? a.diff : null)

		let appCtx = makeAppCtx({ view: "list" })
		const dispatcher = createDispatcher(appKm, () => appCtx)

		// Not in diff: keys are ignored
		expect(dispatcher.dispatch(parseKey("k")).kind).toBe("ignored")

		// Switch to diff: now active
		appCtx = makeAppCtx({ view: "diff" })
		dispatcher.dispatch(parseKey("k"))
		dispatcher.dispatch(parseKey("j"))
		expect(appCtx.diff.lines).toEqual(["scroll:-1", "scroll:1"])
	})

	test("multiple sub-keymaps share the same key without collision when scopes are exclusive", () => {
		const diffKm: Keymap<DiffState> = command({ id: "x", title: "X", keys: ["k"], run: (s) => s.scrollBy(-1) })
		const detailKm: Keymap<DetailState> = command({ id: "x", title: "X", keys: ["k"], run: (s) => s.scrollDetailBy(-1) })

		const appKm = Keymap.union(
			diffKm.contramapMaybe<AppCtx>((a) => a.view === "diff" ? a.diff : null),
			detailKm.contramapMaybe<AppCtx>((a) => a.view === "detail" ? a.detail : null),
		)

		const collisions: number[] = []
		let appCtx = makeAppCtx({ view: "diff" })
		const dispatcher = createDispatcher(appKm, () => appCtx, {
			onCollision: (_, bindings) => collisions.push(bindings.length),
		})

		dispatcher.dispatch(parseKey("k"))
		expect(appCtx.diff.lines).toEqual(["scroll:-1"])
		expect(appCtx.detail.log).toEqual([])
		expect(collisions).toEqual([])  // when conditions disambiguate

		appCtx = makeAppCtx({ view: "detail" })
		dispatcher.dispatch(parseKey("k"))
		expect(appCtx.detail.log).toEqual(["scroll:-1"])
	})

	test("global commands and modal commands compose at the app level", () => {
		const globalKm: Keymap<AppCtx> = Keymap.union(
			command({ id: "pull.refresh", title: "Refresh", keys: ["r"], run: (s) => s.refresh() }),
			command({
				id: "pull.merge",
				title: "Merge",
				keys: ["m"],
				enabled: (s) => s.hasSelection ? true : "Select a pull request first.",
				run: (s) => s.merge(),
			}),
		)

		const modalKm: Keymap<AppCtx> = command<AppCtx>({
			id: "modal.cancel",
			title: "Cancel",
			keys: ["escape"],
			when: (s) => s.modal,
			run: (s) => s.closeModal(),
		})

		const appKm = Keymap.union(globalKm, modalKm)

		const ctx = makeAppCtx()
		const dispatcher = createDispatcher(appKm, () => ctx)

		// idle: r works
		dispatcher.dispatch(parseKey("r"))
		expect(ctx.log).toEqual(["refresh"])

		// merge disabled with reason
		const result = dispatcher.dispatch(parseKey("m"))
		expect(result.kind).toBe("disabled")

		// modal not active: escape ignored
		expect(dispatcher.dispatch(parseKey("escape")).kind).toBe("ignored")
	})

	test("Keymap.active gives palette/footer view of currently runnable bindings", () => {
		const km = Keymap.union(
			command<AppCtx>({ id: "global", title: "Global", keys: ["r"], run: () => {} }),
			command<AppCtx>({
				id: "modal-only",
				title: "Modal",
				keys: ["x"],
				when: (s) => s.modal,
				run: () => {},
			}),
			command<AppCtx>({
				id: "needs-selection",
				title: "Merge",
				keys: ["m"],
				enabled: (s) => s.hasSelection ? true : "Select first.",
				run: () => {},
			}),
		)

		expect(km.active(makeAppCtx()).map((b) => b.meta!.id)).toEqual(["global"])
		expect(km.active(makeAppCtx({ modal: true })).map((b) => b.meta!.id)).toEqual(["global", "modal-only"])
		expect(km.active(makeAppCtx({ hasSelection: true })).map((b) => b.meta!.id))
			.toEqual(["global", "needs-selection"])
	})

	test("prefix builds leader-key sub-keymaps", () => {
		const tools = Keymap.union(
			command<AppCtx>({ id: "tools.refresh", title: "Refresh", keys: ["r"], run: (s) => s.refresh() }),
			command<AppCtx>({ id: "tools.merge", title: "Merge", keys: ["m"], run: (s) => s.merge() }),
		).prefix("space")

		const ctx = makeAppCtx({ hasSelection: true })
		const dispatcher = createDispatcher(tools, () => ctx)

		// "r" alone is unbound (everything's space-prefixed)
		expect(dispatcher.dispatch(parseKey("r")).kind).toBe("ignored")

		// "space r" runs refresh
		dispatcher.dispatch(parseKey("space"))
		dispatcher.dispatch(parseKey("r"))
		expect(ctx.log).toEqual(["refresh"])
	})
})
