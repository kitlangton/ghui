import { type Command, isCommandActive } from "./commands.ts"
import { type ParsedStroke, parseBinding, sequenceMatches, sequenceStartsWith } from "./keys.ts"

export type DispatchResult<S> =
	| { readonly kind: "ran"; readonly command: Command<S> }
	| { readonly kind: "pending"; readonly sequence: readonly ParsedStroke[] }
	| { readonly kind: "disabled"; readonly command: Command<S>; readonly reason: string }
	| { readonly kind: "ignored" }

export interface Clock {
	setTimeout(fn: () => void, ms: number): unknown
	clearTimeout(handle: unknown): void
}

export interface DispatcherOptions {
	readonly disambiguationTimeoutMs?: number
	readonly clock?: Clock
}

export interface Dispatcher<S> {
	readonly dispatch: (stroke: ParsedStroke) => DispatchResult<S>
	readonly getPending: () => readonly ParsedStroke[]
	readonly clearPending: () => void
	readonly onPendingChange: (listener: (pending: readonly ParsedStroke[]) => void) => () => void
}

interface CompiledCommand<S> {
	readonly command: Command<S>
	readonly sequences: readonly (readonly ParsedStroke[])[]
}

const compile = <S>(commands: readonly Command<S>[]): readonly CompiledCommand<S>[] =>
	commands.map((command) => ({
		command,
		sequences: (command.keys ?? []).map(parseBinding).filter((seq) => seq.length > 0),
	}))

const defaultClock: Clock = {
	setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
	clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
}

export const createDispatcher = <S>(
	commands: readonly Command<S>[],
	getState: () => S,
	options: DispatcherOptions = {},
): Dispatcher<S> => {
	const compiled = compile(commands)
	const timeoutMs = options.disambiguationTimeoutMs ?? 500
	const clock = options.clock ?? defaultClock

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

	const findMatches = (sequence: readonly ParsedStroke[], state: S) => {
		const exact: CompiledCommand<S>[] = []
		const continuing: CompiledCommand<S>[] = []
		for (const compiledCommand of compiled) {
			const status = isCommandActive(compiledCommand.command, state)
			// Disabled-with-reason is still a match (so we can report the reason);
			// out-of-scope and silently-disabled are invisible.
			const visibleAsBinding = status === true || (typeof status === "string" && status !== "out of scope" && status !== "disabled")
			let exactSeen = false
			let continuingSeen = false
			for (const seq of compiledCommand.sequences) {
				if (sequenceMatches(seq, sequence)) exactSeen = true
				else if (sequenceStartsWith(seq, sequence)) continuingSeen = true
			}
			if (!visibleAsBinding) continue
			if (exactSeen) exact.push(compiledCommand)
			if (continuingSeen) continuing.push(compiledCommand)
		}
		return { exact, continuing }
	}

	const tryRun = (command: Command<S>, state: S): DispatchResult<S> => {
		const status = isCommandActive(command, state)
		if (status === true) {
			command.run(state)
			return { kind: "ran", command }
		}
		return { kind: "disabled", command, reason: status }
	}

	const dispatch = (stroke: ParsedStroke): DispatchResult<S> => {
		const state = getState()
		const next = [...pending, stroke]
		const { exact, continuing } = findMatches(next, state)

		if (exact.length === 0 && continuing.length === 0) {
			const hadPending = pending.length > 0
			clearPending()
			if (hadPending) return dispatch(stroke)
			return { kind: "ignored" }
		}

		if (exact.length > 0 && continuing.length === 0) {
			clearPending()
			return tryRun(exact[0]!.command, state)
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
		const exactCommand = exact[0]!.command
		clearTimer()
		timer = clock.setTimeout(() => {
			timer = null
			setPending([])
			tryRun(exactCommand, getState())
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
