import { useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import { createDispatcher, type Dispatcher, type DispatcherOptions } from "./dispatcher.ts"
import type { ParsedStroke } from "./keys.ts"
import type { Keymap } from "./keymap.ts"

export type KeySubscribe = (handler: (stroke: ParsedStroke) => void) => () => void

/**
 * Mounts a Keymap. Subscribes to host key events through `subscribe`, dispatches
 * each into the keymap, and reads `ctx` fresh on every dispatch.
 *
 * `keymap` is captured at first render. To change the active keymap, recompute
 * its identity in a parent (e.g. `useMemo(() => buildKeymap(flag), [flag])`).
 */
export const useKeymap = <C>(
	keymap: Keymap<C>,
	ctx: C,
	subscribe: KeySubscribe,
	options?: DispatcherOptions,
): Dispatcher<C> => {
	const ctxRef = useRef(ctx)
	ctxRef.current = ctx

	const dispatcher = useMemo(
		() => createDispatcher(keymap, () => ctxRef.current, options),
		// keymap captured once by design; users opt into reactive changes
		// by recomputing the keymap value in a parent useMemo.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[],
	)

	useEffect(() => subscribe((stroke) => dispatcher.dispatch(stroke)), [dispatcher, subscribe])

	return dispatcher
}

export const usePendingSequence = <C>(dispatcher: Dispatcher<C>): readonly ParsedStroke[] =>
	useSyncExternalStore(
		(callback) => dispatcher.onPendingChange(callback),
		dispatcher.getPending,
		dispatcher.getPending,
	)
