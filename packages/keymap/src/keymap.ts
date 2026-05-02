import { type Binding, isBindingActive } from "./binding.ts"
import { type ParsedStroke, parseBinding } from "./keys.ts"

const liftBinding = <C, C2>(binding: Binding<C>, project: (c2: C2) => C): Binding<C2> => ({
	sequence: binding.sequence,
	...(binding.when ? { when: (c2: C2) => binding.when!(project(c2)) } : {}),
	...(binding.enabled ? { enabled: (c2: C2) => binding.enabled!(project(c2)) } : {}),
	action: (c2) => binding.action(project(c2)),
	...(binding.meta ? { meta: binding.meta } : {}),
})

const liftBindingMaybe = <C, C2>(
	binding: Binding<C>,
	project: (c2: C2) => C | null,
): Binding<C2> => {
	const inScope = (c2: C2): C | null => project(c2)
	return {
		sequence: binding.sequence,
		when: (c2: C2) => {
			const c = inScope(c2)
			if (c === null) return false
			return binding.when ? binding.when(c) : true
		},
		...(binding.enabled
			? {
				enabled: (c2: C2) => {
					const c = inScope(c2)
					if (c === null) return false
					return binding.enabled!(c)
				},
			}
			: {}),
		action: (c2: C2) => {
			const c = inScope(c2)
			if (c !== null) binding.action(c)
		},
		...(binding.meta ? { meta: binding.meta } : {}),
	}
}

/**
 * A Keymap is a value: an immutable collection of bindings parametric in its
 * context type C. Combinators close over Keymap — they always return a Keymap.
 *
 * - Contravariant in C via `contramap` / `contramapMaybe`: lift a Keymap<Sub>
 *   into a Keymap<Whole> by projecting Whole → Sub.
 * - Monoid under `union` with `Keymap.empty()` as identity.
 * - `restrict` AND-merges a predicate into every binding's `when`.
 * - `prefix` prepends a stroke (or sequence) to every binding — leader keys.
 */
export class Keymap<C> {
	readonly bindings: readonly Binding<C>[]

	constructor(bindings: readonly Binding<C>[]) {
		this.bindings = bindings
	}

	static empty<C>(): Keymap<C> {
		return new Keymap<C>([])
	}

	static of<C>(...bindings: readonly Binding<C>[]): Keymap<C> {
		return new Keymap<C>(bindings)
	}

	static union<C>(...keymaps: readonly Keymap<C>[]): Keymap<C> {
		return new Keymap<C>(keymaps.flatMap((k) => k.bindings))
	}

	union(...keymaps: readonly Keymap<C>[]): Keymap<C> {
		return Keymap.union(this, ...keymaps)
	}

	contramap<C2>(project: (ctx: C2) => C): Keymap<C2> {
		return new Keymap<C2>(this.bindings.map((b) => liftBinding(b, project)))
	}

	contramapMaybe<C2>(project: (ctx: C2) => C | null): Keymap<C2> {
		return new Keymap<C2>(this.bindings.map((b) => liftBindingMaybe(b, project)))
	}

	restrict(predicate: (ctx: C) => boolean): Keymap<C> {
		return new Keymap<C>(this.bindings.map((b) => ({
			...b,
			when: b.when ? (ctx: C) => predicate(ctx) && b.when!(ctx) : predicate,
		})))
	}

	prefix(stroke: string | ParsedStroke): Keymap<C> {
		const prepend = typeof stroke === "string" ? parseBinding(stroke) : [stroke]
		return new Keymap<C>(this.bindings.map((b) => ({
			...b,
			sequence: [...prepend, ...b.sequence],
		})))
	}

	filter(predicate: (binding: Binding<C>) => boolean): Keymap<C> {
		return new Keymap<C>(this.bindings.filter(predicate))
	}

	active(ctx: C): readonly Binding<C>[] {
		return this.bindings.filter((b) => isBindingActive(b, ctx) === true)
	}
}
