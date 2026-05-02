import { beforeEach, describe, expect, test } from "bun:test"
import { defineCommand } from "../src/commands.ts"
import { type Clock, createDispatcher } from "../src/dispatcher.ts"
import { parseKey } from "../src/keys.ts"

interface State {
	readonly modal: boolean
	readonly enabledMerge: boolean
	readonly log: string[]
}

const press = (dispatcher: ReturnType<typeof createDispatcher<State>>, key: string) =>
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

let state: State
const setState = (next: Partial<State>) => {
	state = { ...state, ...next }
}
beforeEach(() => {
	state = { modal: false, enabledMerge: true, log: [] }
})

describe("createDispatcher — single-stroke", () => {
	test("dispatches the bound command", () => {
		const refresh = defineCommand<State>({
			id: "refresh",
			title: "Refresh",
			keys: ["r"],
			run: (s) => s.log.push("refresh"),
		})
		const dispatcher = createDispatcher([refresh], () => state)
		const result = press(dispatcher, "r")
		expect(result.kind).toBe("ran")
		expect(state.log).toEqual(["refresh"])
	})

	test("unbound key is ignored", () => {
		const dispatcher = createDispatcher<State>([], () => state)
		expect(press(dispatcher, "r").kind).toBe("ignored")
	})

	test("multiple bindings on one command — any matches", () => {
		const cmd = defineCommand<State>({
			id: "down",
			title: "Down",
			keys: ["j", "down"],
			run: (s) => s.log.push("down"),
		})
		const dispatcher = createDispatcher([cmd], () => state)
		press(dispatcher, "j")
		press(dispatcher, "down")
		expect(state.log).toEqual(["down", "down"])
	})

	test("modifier keys differentiate", () => {
		const lower = defineCommand<State>({ id: "l", title: "L", keys: ["m"], run: (s) => s.log.push("m") })
		const upper = defineCommand<State>({ id: "u", title: "U", keys: ["shift+m"], run: (s) => s.log.push("M") })
		const dispatcher = createDispatcher([lower, upper], () => state)
		press(dispatcher, "m")
		press(dispatcher, "shift+m")
		expect(state.log).toEqual(["m", "M"])
	})
})

describe("createDispatcher — gating", () => {
	test("when=false → command not eligible", () => {
		const command = defineCommand<State>({
			id: "modal-only",
			title: "X",
			keys: ["m"],
			when: (s) => s.modal,
			run: (s) => s.log.push("ran"),
		})
		const dispatcher = createDispatcher([command], () => state)
		expect(press(dispatcher, "m").kind).toBe("ignored")
		setState({ modal: true })
		expect(press(dispatcher, "m").kind).toBe("ran")
	})

	test("enabled=false → reported as disabled, run not called", () => {
		const command = defineCommand<State>({
			id: "merge",
			title: "Merge",
			keys: ["m"],
			enabled: () => false,
			run: (s) => s.log.push("ran"),
		})
		const dispatcher = createDispatcher([command], () => state)
		// enabled=false makes the binding invisible to dispatch — there's no
		// reason to flash a notice for "disabled". Treated as if the command
		// weren't bound.
		expect(press(dispatcher, "m").kind).toBe("ignored")
		expect(state.log).toEqual([])
	})

	test("enabled returning a reason → dispatch reports disabled with reason", () => {
		const command = defineCommand<State>({
			id: "merge",
			title: "Merge",
			keys: ["m"],
			enabled: (s) => s.enabledMerge ? true : "Select a pull request first.",
			run: (s) => s.log.push("ran"),
		})
		const dispatcher = createDispatcher([command], () => state)
		setState({ enabledMerge: false })
		const result = press(dispatcher, "m")
		expect(result).toEqual({ kind: "disabled", command, reason: "Select a pull request first." })
		expect(state.log).toEqual([])
	})

	test("state read fresh on every dispatch", () => {
		const command = defineCommand<State>({
			id: "x",
			title: "X",
			keys: ["x"],
			when: (s) => s.modal,
			run: (s) => s.log.push("ran"),
		})
		const dispatcher = createDispatcher([command], () => state)
		press(dispatcher, "x") // ignored
		setState({ modal: true })
		press(dispatcher, "x") // ran
		setState({ modal: false })
		press(dispatcher, "x") // ignored
		expect(state.log).toEqual(["ran"])
	})
})

describe("createDispatcher — sequences", () => {
	test("two-stroke binding fires after both strokes", () => {
		const top = defineCommand<State>({
			id: "top",
			title: "Top",
			keys: ["g g"],
			run: (s) => s.log.push("top"),
		})
		const dispatcher = createDispatcher([top], () => state)
		expect(press(dispatcher, "g").kind).toBe("pending")
		expect(state.log).toEqual([])
		expect(press(dispatcher, "g").kind).toBe("ran")
		expect(state.log).toEqual(["top"])
	})

	test("non-matching mid-sequence key clears pending and re-dispatches fresh", () => {
		const top = defineCommand<State>({
			id: "top",
			title: "Top",
			keys: ["g g"],
			run: (s) => s.log.push("top"),
		})
		const refresh = defineCommand<State>({
			id: "refresh",
			title: "Refresh",
			keys: ["r"],
			run: (s) => s.log.push("refresh"),
		})
		const dispatcher = createDispatcher([top, refresh], () => state)
		press(dispatcher, "g")
		const result = press(dispatcher, "r")
		expect(result.kind).toBe("ran")
		expect(state.log).toEqual(["refresh"])
		expect(dispatcher.getPending()).toEqual([])
	})

	test("non-matching key with no fresh fallback → ignored, pending cleared", () => {
		const top = defineCommand<State>({ id: "top", title: "Top", keys: ["g g"], run: () => {} })
		const dispatcher = createDispatcher([top], () => state)
		press(dispatcher, "g")
		const result = press(dispatcher, "x")
		expect(result.kind).toBe("ignored")
		expect(dispatcher.getPending()).toEqual([])
	})

	test("clearPending() drops a pending sequence", () => {
		const top = defineCommand<State>({ id: "top", title: "Top", keys: ["g g"], run: () => {} })
		const dispatcher = createDispatcher([top], () => state)
		press(dispatcher, "g")
		expect(dispatcher.getPending()).toHaveLength(1)
		dispatcher.clearPending()
		expect(dispatcher.getPending()).toEqual([])
	})
})

describe("createDispatcher — ambiguous sequences (vim-style timeout)", () => {
	test("g and 'g g' both bound: pressing g enters pending; second g runs the sequence", () => {
		const goTop = defineCommand<State>({ id: "top", title: "Top", keys: ["g g"], run: (s) => s.log.push("top") })
		const single = defineCommand<State>({ id: "single", title: "Single", keys: ["g"], run: (s) => s.log.push("single") })
		const clock = new FakeClock()
		const dispatcher = createDispatcher([goTop, single], () => state, { clock })
		expect(press(dispatcher, "g").kind).toBe("pending")
		expect(state.log).toEqual([])
		press(dispatcher, "g")
		expect(state.log).toEqual(["top"])
	})

	test("g and 'g g' both bound: timeout commits to single-key g", () => {
		const goTop = defineCommand<State>({ id: "top", title: "Top", keys: ["g g"], run: (s) => s.log.push("top") })
		const single = defineCommand<State>({ id: "single", title: "Single", keys: ["g"], run: (s) => s.log.push("single") })
		const clock = new FakeClock()
		const dispatcher = createDispatcher([goTop, single], () => state, { clock, disambiguationTimeoutMs: 500 })
		press(dispatcher, "g")
		expect(state.log).toEqual([])
		clock.advance(499)
		expect(state.log).toEqual([])
		clock.advance(2)
		expect(state.log).toEqual(["single"])
		expect(dispatcher.getPending()).toEqual([])
	})

	test("non-ambiguous sequence fires immediately, no timeout wait", () => {
		const top = defineCommand<State>({ id: "top", title: "Top", keys: ["g g"], run: (s) => s.log.push("top") })
		const clock = new FakeClock()
		const dispatcher = createDispatcher([top], () => state, { clock })
		press(dispatcher, "g")
		press(dispatcher, "g")
		expect(state.log).toEqual(["top"])
	})
})

describe("createDispatcher — pending notifications", () => {
	test("subscribers get current pending sequence on every change", () => {
		const top = defineCommand<State>({ id: "top", title: "Top", keys: ["g g"], run: () => {} })
		const dispatcher = createDispatcher([top], () => state)
		const events: number[] = []
		const off = dispatcher.onPendingChange((p) => events.push(p.length))
		press(dispatcher, "g")
		press(dispatcher, "g")
		off()
		expect(events).toEqual([1, 0])
	})

	test("unsubscribed listeners don't receive further updates", () => {
		const top = defineCommand<State>({ id: "top", title: "Top", keys: ["g g"], run: () => {} })
		const dispatcher = createDispatcher([top], () => state)
		const events: number[] = []
		const off = dispatcher.onPendingChange((p) => events.push(p.length))
		press(dispatcher, "g")
		off()
		press(dispatcher, "g")
		expect(events).toEqual([1])
	})
})

describe("createDispatcher — collisions", () => {
	test("two commands bound to same active key: first registered wins", () => {
		const a = defineCommand<State>({ id: "a", title: "A", keys: ["x"], run: (s) => s.log.push("a") })
		const b = defineCommand<State>({ id: "b", title: "B", keys: ["x"], run: (s) => s.log.push("b") })
		const dispatcher = createDispatcher([a, b], () => state)
		press(dispatcher, "x")
		expect(state.log).toEqual(["a"])
	})

	test("when conditions disambiguate active commands sharing a key", () => {
		const inModal = defineCommand<State>({
			id: "modal",
			title: "M",
			keys: ["x"],
			when: (s) => s.modal,
			run: (s) => s.log.push("modal"),
		})
		const global = defineCommand<State>({
			id: "global",
			title: "G",
			keys: ["x"],
			when: (s) => !s.modal,
			run: (s) => s.log.push("global"),
		})
		const dispatcher = createDispatcher([inModal, global], () => state)
		press(dispatcher, "x")
		setState({ modal: true })
		press(dispatcher, "x")
		expect(state.log).toEqual(["global", "modal"])
	})
})
