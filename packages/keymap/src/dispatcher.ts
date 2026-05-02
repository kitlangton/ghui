import { type Binding, isBindingActive } from "./binding.ts"
import type { Keymap } from "./keymap.ts"
import { type ParsedStroke, sequenceMatches, sequenceStartsWith } from "./keys.ts"

export type DispatchResult<C> =
	| { readonly kind: "ran"; readonly binding: Binding<C> }
	| { readonly kind: "pending"; readonly sequence: readonly ParsedStroke[] }
	| { readonly kind: "disabled"; readonly binding: Binding<C>; readonly reason: string }
	| { readonly kind: "ignored" }

export interface Clock {
	setTimeout(fn: () => void, ms: number): unknown
	clearTimeout(handle: unknown): void
}

export interface DispatcherOptions {
	readonly disambiguationTimeoutMs?: number
	readonly clock?: Clock
	/** Called when two or more bindings collide on the same active sequence. */
	readonly onCollision?: (sequence: readonly ParsedStroke[], bindings: readonly Binding<unknown>[]) => void
}

export interface Dispatcher<C> {
	readonly dispatch: (stroke: ParsedStroke) => DispatchResult<C>
	readonly getPending: () => readonly ParsedStroke[]
	readonly clearPending: () => void
	readonly onPendingChange: (listener: (pending: readonly ParsedStroke[]) => void) => () => void
}

const defaultClock: Clock = {
	setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
	clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
}

export const createDispatcher = <C>(
	keymap: Keymap<C>,
	getContext: () => C,
	options: DispatcherOptions = {},
): Dispatcher<C> => {
	const bindings = keymap.bindings
	const timeoutMs = options.disambiguationTimeoutMs ?? 500
	const clock = options.clock ?? defaultClock
	const onCollision = options.onCollision

	let pending: readonly ParsedStroke[] = []
	let timer: unknown = null
	const listeners = new Set<(pending: readonly ParsedStroke[]) => void>()

	const setPending = (next: readonly ParsedStroke[]) => {
		if (next === pending) return
		pending = next
		for (const listener of listeners) listener(pending)
	}

	const clearTimer = () => {
		if (timer !== null) {
			clock.clearTimeout(timer)
			timer = null
		}
	}

	const clearPending = () => {
		clearTimer()
		setPending([])
	}

	const findMatches = (sequence: readonly ParsedStroke[], ctx: C) => {
		const exact: Binding<C>[] = []
		const continuing: Binding<C>[] = []
		for (const binding of bindings) {
			const status = isBindingActive(binding, ctx)
			const visibleAsBinding = status === true
				|| (typeof status === "string" && status !== "out of scope" && status !== "disabled")
			if (!visibleAsBinding) continue
			if (sequenceMatches(binding.sequence, sequence)) exact.push(binding)
			else if (sequenceStartsWith(binding.sequence, sequence)) continuing.push(binding)
		}
		return { exact, continuing }
	}

	const tryRun = (binding: Binding<C>, ctx: C): DispatchResult<C> => {
		const status = isBindingActive(binding, ctx)
		if (status === true) {
			binding.action(ctx)
			return { kind: "ran", binding }
		}
		return { kind: "disabled", binding, reason: status }
	}

	const dispatch = (stroke: ParsedStroke): DispatchResult<C> => {
		const ctx = getContext()
		const next = [...pending, stroke]
		const { exact, continuing } = findMatches(next, ctx)

		if (exact.length === 0 && continuing.length === 0) {
			const hadPending = pending.length > 0
			clearPending()
			if (hadPending) return dispatch(stroke)
			return { kind: "ignored" }
		}

		if (exact.length > 0 && continuing.length === 0) {
			clearPending()
			if (exact.length > 1 && onCollision) onCollision(next, exact as readonly Binding<unknown>[])
			return tryRun(exact[0]!, ctx)
		}

		if (exact.length === 0 && continuing.length > 0) {
			clearTimer()
			timer = clock.setTimeout(() => {
				timer = null
				setPending([])
			}, timeoutMs)
			setPending(next)
			return { kind: "pending", sequence: next }
		}

		// Ambiguous: there's an exact match AND a longer continuation.
		const exactBinding = exact[0]!
		clearTimer()
		timer = clock.setTimeout(() => {
			timer = null
			setPending([])
			tryRun(exactBinding, getContext())
		}, timeoutMs)
		setPending(next)
		return { kind: "pending", sequence: next }
	}

	return {
		dispatch,
		getPending: () => pending,
		clearPending,
		onPendingChange: (listener) => {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
	}
}
