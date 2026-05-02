import { beforeEach, describe, expect, test } from "bun:test"
import { command } from "../src/command.ts"
import { type Clock, createDispatcher } from "../src/dispatcher.ts"
import { Keymap } from "../src/keymap.ts"
import { parseKey } from "../src/keys.ts"

interface Ctx {
	readonly modal: boolean
	readonly enabledMerge: boolean
	readonly log: string[]
}

const press = (dispatcher: ReturnType<typeof createDispatcher<Ctx>>, key: string) =>
	dispatcher.dispatch(parseKey(key))

class FakeClock implements Clock {
	private nextHandle = 1
	private readonly timers = new Map<number, { fireAt: number; fn: () => void }>()
	private now = 0

	setTimeout(fn: () => void, ms: number) {
		const handle = this.nextHandle++
		this.timers.set(handle, { fireAt: this.now + ms, fn })
		return handle
	}

	clearTimeout(handle: unknown) {
		this.timers.delete(handle as number)
	}

	advance(ms: number) {
		this.now += ms
		const due = [...this.timers].filter(([_, t]) => t.fireAt <= this.now)
		for (const [handle, { fn }] of due) {
			this.timers.delete(handle)
			fn()
		}
	}
}

let ctx: Ctx
const setCtx = (next: Partial<Ctx>) => {
	ctx = { ...ctx, ...next }
}
beforeEach(() => {
	ctx = { modal: false, enabledMerge: true, log: [] }
})

describe("createDispatcher — single-stroke", () => {
	test("dispatches the bound binding", () => {
		const km = command<Ctx>({ id: "refresh", title: "Refresh", keys: ["r"], run: (s) => s.log.push("refresh") })
		const dispatcher = createDispatcher(km, () => ctx)
		expect(press(dispatcher, "r").kind).toBe("ran")
		expect(ctx.log).toEqual(["refresh"])
	})

	test("unbound key is ignored", () => {
		const dispatcher = createDispatcher(Keymap.empty<Ctx>(), () => ctx)
		expect(press(dispatcher, "r").kind).toBe("ignored")
	})

	test("multiple keys on one command — all match", () => {
		const km = command<Ctx>({ id: "down", title: "Down", keys: ["j", "down"], run: (s) => s.log.push("down") })
		const dispatcher = createDispatcher(km, () => ctx)
		press(dispatcher, "j")
		press(dispatcher, "down")
		expect(ctx.log).toEqual(["down", "down"])
	})
})

describe("createDispatcher — gating", () => {
	test("when=false → invisible to dispatch", () => {
		const km = command<Ctx>({
			id: "modal-only",
			title: "Modal",
			keys: ["m"],
			when: (s) => s.modal,
			run: (s) => s.log.push("ran"),
		})
		const dispatcher = createDispatcher(km, () => ctx)
		expect(press(dispatcher, "m").kind).toBe("ignored")
		setCtx({ modal: true })
		expect(press(dispatcher, "m").kind).toBe("ran")
	})

	test("enabled=false → invisible", () => {
		const km = command<Ctx>({
			id: "merge",
			title: "Merge",
			keys: ["m"],
			enabled: () => false,
			run: (s) => s.log.push("ran"),
		})
		const dispatcher = createDispatcher(km, () => ctx)
		expect(press(dispatcher, "m").kind).toBe("ignored")
	})

	test("enabled with reason → reported as disabled", () => {
		const km = command<Ctx>({
			id: "merge",
			title: "Merge",
			keys: ["m"],
			enabled: (s) => s.enabledMerge ? true : "Select a pull request first.",
			run: (s) => s.log.push("ran"),
		})
		const dispatcher = createDispatcher(km, () => ctx)
		setCtx({ enabledMerge: false })
		const result = press(dispatcher, "m")
		expect(result.kind).toBe("disabled")
		if (result.kind === "disabled") expect(result.reason).toBe("Select a pull request first.")
		expect(ctx.log).toEqual([])
	})

	test("context read fresh on every dispatch", () => {
		const km = command<Ctx>({
			id: "x",
			title: "X",
			keys: ["x"],
			when: (s) => s.modal,
			run: (s) => s.log.push("ran"),
		})
		const dispatcher = createDispatcher(km, () => ctx)
		press(dispatcher, "x")
		setCtx({ modal: true })
		press(dispatcher, "x")
		setCtx({ modal: false })
		press(dispatcher, "x")
		expect(ctx.log).toEqual(["ran"])
	})
})

describe("createDispatcher — sequences", () => {
	test("two-stroke binding fires after both strokes", () => {
		const km = command<Ctx>({ id: "top", title: "Top", keys: ["g g"], run: (s) => s.log.push("top") })
		const dispatcher = createDispatcher(km, () => ctx)
		expect(press(dispatcher, "g").kind).toBe("pending")
		expect(press(dispatcher, "g").kind).toBe("ran")
		expect(ctx.log).toEqual(["top"])
	})

	test("non-matching mid-sequence → re-dispatch fresh", () => {
		const km = Keymap.union(
			command<Ctx>({ id: "top", title: "Top", keys: ["g g"], run: () => {} }),
			command<Ctx>({ id: "refresh", title: "Refresh", keys: ["r"], run: (s) => s.log.push("refresh") }),
		)
		const dispatcher = createDispatcher(km, () => ctx)
		press(dispatcher, "g")
		expect(press(dispatcher, "r").kind).toBe("ran")
		expect(ctx.log).toEqual(["refresh"])
		expect(dispatcher.getPending()).toEqual([])
	})

	test("clearPending drops a pending sequence", () => {
		const km = command<Ctx>({ id: "top", title: "Top", keys: ["g g"], run: () => {} })
		const dispatcher = createDispatcher(km, () => ctx)
		press(dispatcher, "g")
		dispatcher.clearPending()
		expect(dispatcher.getPending()).toEqual([])
	})
})

describe("createDispatcher — ambiguous sequences", () => {
	test("'g' and 'g g' both bound: timeout commits to single g", () => {
		const km = Keymap.union(
			command<Ctx>({ id: "single", title: "Single", keys: ["g"], run: (s) => s.log.push("single") }),
			command<Ctx>({ id: "top", title: "Top", keys: ["g g"], run: (s) => s.log.push("top") }),
		)
		const clock = new FakeClock()
		const dispatcher = createDispatcher(km, () => ctx, { clock, disambiguationTimeoutMs: 500 })
		press(dispatcher, "g")
		expect(ctx.log).toEqual([])
		clock.advance(501)
		expect(ctx.log).toEqual(["single"])
	})

	test("'g' and 'g g' both bound: second g runs the sequence", () => {
		const km = Keymap.union(
			command<Ctx>({ id: "single", title: "Single", keys: ["g"], run: (s) => s.log.push("single") }),
			command<Ctx>({ id: "top", title: "Top", keys: ["g g"], run: (s) => s.log.push("top") }),
		)
		const clock = new FakeClock()
		const dispatcher = createDispatcher(km, () => ctx, { clock })
		press(dispatcher, "g")
		press(dispatcher, "g")
		expect(ctx.log).toEqual(["top"])
	})
})

describe("createDispatcher — composition", () => {
	test("contramapMaybe-lifted keymap dispatches only when projection succeeds", () => {
		interface DiffState {
			readonly lines: number[]
		}
		interface AppCtx {
			readonly inDiff: boolean
			readonly diff: DiffState
			readonly log: string[]
		}
		const diffKm = command<DiffState>({ id: "scroll", title: "Scroll", keys: ["k"], run: (s) => s.lines.push(1) })
		const appKm = diffKm.contramapMaybe<AppCtx>((app) => app.inDiff ? app.diff : null)

		let appCtx: AppCtx = { inDiff: false, diff: { lines: [] }, log: [] }
		const dispatcher = createDispatcher(appKm, () => appCtx)

		// Not in diff: ignored
		expect(dispatcher.dispatch(parseKey("k")).kind).toBe("ignored")
		expect(appCtx.diff.lines).toEqual([])

		// In diff: runs against projected state
		appCtx = { ...appCtx, inDiff: true }
		expect(dispatcher.dispatch(parseKey("k")).kind).toBe("ran")
		expect(appCtx.diff.lines).toEqual([1])
	})

	test("union of differently-scoped sub-keymaps composes cleanly", () => {
		interface DiffState { readonly log: string[] }
		interface DetailState { readonly log: string[] }
		interface AppCtx {
			readonly view: "diff" | "detail" | "list"
			readonly diff: DiffState
			readonly detail: DetailState
		}
		const diffKm = command<DiffState>({ id: "diff.x", title: "Diff X", keys: ["x"], run: (s) => s.log.push("diff") })
		const detailKm = command<DetailState>({ id: "detail.x", title: "Detail X", keys: ["x"], run: (s) => s.log.push("detail") })

		const appKm = Keymap.union(
			diffKm.contramapMaybe<AppCtx>((a) => a.view === "diff" ? a.diff : null),
			detailKm.contramapMaybe<AppCtx>((a) => a.view === "detail" ? a.detail : null),
		)

		let appCtx: AppCtx = { view: "list", diff: { log: [] }, detail: { log: [] } }
		const dispatcher = createDispatcher(appKm, () => appCtx)

		expect(dispatcher.dispatch(parseKey("x")).kind).toBe("ignored")

		appCtx = { ...appCtx, view: "diff" }
		dispatcher.dispatch(parseKey("x"))
		expect(appCtx.diff.log).toEqual(["diff"])
		expect(appCtx.detail.log).toEqual([])

		appCtx = { ...appCtx, view: "detail" }
		dispatcher.dispatch(parseKey("x"))
		expect(appCtx.detail.log).toEqual(["detail"])
	})

	test("collisions invoke onCollision callback", () => {
		const km = Keymap.union(
			command<Ctx>({ id: "a", title: "A", keys: ["x"], run: (s) => s.log.push("a") }),
			command<Ctx>({ id: "b", title: "B", keys: ["x"], run: (s) => s.log.push("b") }),
		)
		const seen: number[] = []
		const dispatcher = createDispatcher(km, () => ctx, {
			onCollision: (_seq, bindings) => seen.push(bindings.length),
		})
		press(dispatcher, "x")
		expect(seen).toEqual([2])
		expect(ctx.log).toEqual(["a"])
	})
})

describe("createDispatcher — pending notifications", () => {
	test("subscribers see pending changes", () => {
		const km = command<Ctx>({ id: "top", title: "Top", keys: ["g g"], run: () => {} })
		const dispatcher = createDispatcher(km, () => ctx)
		const events: number[] = []
		const off = dispatcher.onPendingChange((p) => events.push(p.length))
		press(dispatcher, "g")
		press(dispatcher, "g")
		off()
		press(dispatcher, "g")
		expect(events).toEqual([1, 0])
	})
})
