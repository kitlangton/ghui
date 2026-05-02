import { useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import type { Command } from "./commands.ts"
import { createDispatcher, type Dispatcher, type DispatcherOptions } from "./dispatcher.ts"
import type { ParsedStroke } from "./keys.ts"

export type KeySubscribe = (handler: (stroke: ParsedStroke) => void) => () => void

/**
 * Mounts a keymap. Subscribes to host key events through `subscribe`, dispatches
 * each into the keymap, and reads `state` fresh on every dispatch.
 *
 * `commands` is captured at first render; mutating the array later has no effect.
 */
export const useKeymap = <S>(
	commands: readonly Command<S>[],
	state: S,
	subscribe: KeySubscribe,
	options?: DispatcherOptions,
): Dispatcher<S> => {
	const stateRef = useRef(state)
	stateRef.current = state

	const dispatcher = useMemo(
		() => createDispatcher(commands, () => stateRef.current, options),
		// commands captured once by design; options too
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[],
	)

	useEffect(() => subscribe((stroke) => dispatcher.dispatch(stroke)), [dispatcher, subscribe])

	return dispatcher
}

export const usePendingSequence = <S>(dispatcher: Dispatcher<S>): readonly ParsedStroke[] =>
	useSyncExternalStore(
		(callback) => dispatcher.onPendingChange(callback),
		dispatcher.getPending,
		dispatcher.getPending,
	)
