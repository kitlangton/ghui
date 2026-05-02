import { describe, expect, test } from "bun:test"
import { type Binding, isBindingActive } from "../src/binding.ts"
import { Keymap } from "../src/keymap.ts"
import { formatSequence, parseBinding } from "../src/keys.ts"

interface CtxA {
	readonly flag: boolean
	readonly counter: { value: number }
}

interface CtxB {
	readonly inner: CtxA | null
}

const incBy = (delta: number) => (ctx: CtxA) => {
	ctx.counter.value += delta
}

const makeKm = (delta: number, key = "x"): Keymap<CtxA> =>
	new Keymap([{ sequence: parseBinding(key), action: incBy(delta) }])

const ctxA = (flag = true): CtxA => ({ flag, counter: { value: 0 } })

// Behavioral equivalence: dispatch each binding's action against the same context
// and check observable effects match.
const sameBehavior = <C>(left: Keymap<C>, right: Keymap<C>, ctx: () => C) => {
	expect(left.bindings).toHaveLength(right.bindings.length)
	for (let i = 0; i < left.bindings.length; i++) {
		const l = left.bindings[i]!
		const r = right.bindings[i]!
		expect(formatSequence(l.sequence)).toEqual(formatSequence(r.sequence))
		// Both bindings: invoke when/enabled/action against fresh contexts; observe effects equal.
		const lc = ctx()
		const rc = ctx()
		const lActive = isBindingActive(l, lc)
		const rActive = isBindingActive(r, rc)
		expect(lActive).toEqual(rActive)
		if (lActive === true && rActive === true) {
			l.action(lc)
			r.action(rc)
			expect(lc).toEqual(rc)
		}
	}
}

describe("Keymap.empty", () => {
	test("has no bindings", () => {
		expect(Keymap.empty<CtxA>().bindings).toEqual([])
	})
})

describe("Keymap.union — monoid", () => {
	test("left identity: union(empty, km) ~ km", () => {
		const km = makeKm(1)
		sameBehavior(Keymap.union(Keymap.empty<CtxA>(), km), km, ctxA)
	})

	test("right identity: union(km, empty) ~ km", () => {
		const km = makeKm(1)
		sameBehavior(Keymap.union(km, Keymap.empty<CtxA>()), km, ctxA)
	})

	test("associative: union(union(a,b),c) ~ union(a,union(b,c))", () => {
		const a = makeKm(1, "a")
		const b = makeKm(2, "b")
		const c = makeKm(3, "c")
		sameBehavior(
			Keymap.union(Keymap.union(a, b), c),
			Keymap.union(a, Keymap.union(b, c)),
			ctxA,
		)
	})

	test("instance method matches static", () => {
		const a = makeKm(1, "a")
		const b = makeKm(2, "b")
		expect(a.union(b).bindings).toEqual(Keymap.union(a, b).bindings)
	})
})

describe("Keymap.contramap — contravariant functor laws", () => {
	test("identity: km.contramap(id) ~ km", () => {
		const km = makeKm(1)
		const lifted = km.contramap((c: CtxA) => c)
		sameBehavior(lifted, km, ctxA)
	})

	test("composition: contramap(g).contramap(f) ~ contramap(c => g(f(c)))", () => {
		// Set up types so we can compose
		interface CtxC {
			readonly nested: CtxB
		}
		const baseKm = makeKm(1, "x")
		const fCtoB = (c: CtxC): CtxB => c.nested
		const gBtoA = (b: CtxB): CtxA => b.inner ?? ctxA()

		const stepwise = baseKm.contramap(gBtoA).contramap(fCtoB)
		const direct = baseKm.contramap((c: CtxC) => gBtoA(fCtoB(c)))

		const ctxC = (): CtxC => ({ nested: { inner: ctxA() } })
		sameBehavior(stepwise, direct, ctxC)
	})

	test("preserves action under projection", () => {
		const km = makeKm(5)
		const lifted = km.contramap((b: CtxB) => b.inner ?? ctxA())
		const ctx: CtxB = { inner: ctxA() }
		// Active and runs:
		expect(isBindingActive(lifted.bindings[0]!, ctx)).toBe(true)
		lifted.bindings[0]!.action(ctx)
		expect(ctx.inner!.counter.value).toBe(5)
	})
})

describe("Keymap.contramapMaybe — partial contramap", () => {
	test("null projection makes binding inactive", () => {
		const km = makeKm(1)
		const lifted = km.contramapMaybe((b: CtxB) => b.inner)
		expect(isBindingActive(lifted.bindings[0]!, { inner: null })).toBe("out of scope")
	})

	test("non-null projection passes through", () => {
		const km = makeKm(1)
		const lifted = km.contramapMaybe((b: CtxB) => b.inner)
		const ctx: CtxB = { inner: ctxA() }
		expect(isBindingActive(lifted.bindings[0]!, ctx)).toBe(true)
		lifted.bindings[0]!.action(ctx)
		expect(ctx.inner!.counter.value).toBe(1)
	})

	test("inner when still applies", () => {
		const km = new Keymap<CtxA>([{
			sequence: parseBinding("x"),
			when: (c) => c.flag,
			action: incBy(1),
		}])
		const lifted = km.contramapMaybe((b: CtxB) => b.inner)
		expect(isBindingActive(lifted.bindings[0]!, { inner: { flag: false, counter: { value: 0 } } })).toBe("out of scope")
		expect(isBindingActive(lifted.bindings[0]!, { inner: { flag: true, counter: { value: 0 } } })).toBe(true)
	})

	test("null context never invokes inner action", () => {
		let called = false
		const km = new Keymap<CtxA>([{
			sequence: parseBinding("x"),
			action: () => { called = true },
		}])
		const lifted = km.contramapMaybe((b: CtxB) => b.inner)
		lifted.bindings[0]!.action({ inner: null })
		expect(called).toBe(false)
	})
})

describe("Keymap.restrict", () => {
	test("AND-merges with existing when", () => {
		const km = new Keymap<CtxA>([{
			sequence: parseBinding("x"),
			when: (c) => c.flag,
			action: incBy(1),
		}])
		const restricted = km.restrict((c) => c.counter.value === 0)

		// flag=true, value=0 → both pass
		expect(isBindingActive(restricted.bindings[0]!, ctxA(true))).toBe(true)
		// flag=false → restrict passes but inner when fails
		expect(isBindingActive(restricted.bindings[0]!, ctxA(false))).toBe("out of scope")
		// value=1 → restrict fails
		expect(isBindingActive(restricted.bindings[0]!, { flag: true, counter: { value: 1 } })).toBe("out of scope")
	})

	test("idempotent for same predicate", () => {
		const km = makeKm(1)
		const pred = (c: CtxA) => c.flag
		const once = km.restrict(pred)
		const twice = km.restrict(pred).restrict(pred)
		sameBehavior(once, twice, ctxA)
	})
})

describe("Keymap.prefix", () => {
	test("prepends single stroke", () => {
		const km = makeKm(1, "g")
		const prefixed = km.prefix("space")
		expect(formatSequence(prefixed.bindings[0]!.sequence)).toBe("space g")
	})

	test("prepends multi-stroke prefix", () => {
		const km = makeKm(1, "x")
		const prefixed = km.prefix("ctrl+x ctrl+c")
		expect(formatSequence(prefixed.bindings[0]!.sequence)).toBe("ctrl+x ctrl+c x")
	})

	test("composes: prefix(a).prefix(b) === prefix(b a)", () => {
		const km = makeKm(1, "x")
		const stepwise = km.prefix("g").prefix("space")
		const direct = km.prefix("space g")
		expect(formatSequence(stepwise.bindings[0]!.sequence))
			.toBe(formatSequence(direct.bindings[0]!.sequence))
	})
})

describe("Keymap.active", () => {
	test("returns only bindings that are runnable now", () => {
		const km = new Keymap<CtxA>([
			{ sequence: parseBinding("a"), action: () => {}, when: (c) => c.flag },
			{ sequence: parseBinding("b"), action: () => {} },
			{ sequence: parseBinding("c"), action: () => {}, enabled: () => "Select first." },
		])
		const ids = km.active(ctxA(true)).map((b) => formatSequence(b.sequence))
		expect(ids).toEqual(["a", "b"])
	})
})

describe("Keymap meta survives all combinators", () => {
	const meta: Binding<CtxA>["meta"] = { id: "x", title: "Test", group: "Test" }
	const km = new Keymap<CtxA>([{ sequence: parseBinding("x"), action: incBy(1), meta }])

	test("contramap preserves meta", () => {
		expect(km.contramap((b: CtxB) => b.inner ?? ctxA()).bindings[0]!.meta).toEqual(meta)
	})
	test("contramapMaybe preserves meta", () => {
		expect(km.contramapMaybe((b: CtxB) => b.inner).bindings[0]!.meta).toEqual(meta)
	})
	test("restrict preserves meta", () => {
		expect(km.restrict(() => true).bindings[0]!.meta).toEqual(meta)
	})
	test("prefix preserves meta", () => {
		expect(km.prefix("space").bindings[0]!.meta).toEqual(meta)
	})
})
