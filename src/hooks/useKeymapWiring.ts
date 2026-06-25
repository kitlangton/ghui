import { useKeymap } from "@ghui/keymap/react"
import type { KeySubscribe } from "@ghui/keymap/react"
import { useMemo } from "react"
import { appKeymap } from "../keymap/all.js"
import { buildAppCtx, type BuildAppCtxInput } from "../keymap/contexts/appCtx.js"
import { useOpenTuiSubscribe } from "../keyboard/opentuiAdapter.js"
import { useTextInputDispatcher, type UseTextInputDispatcherInput } from "../ui/useTextInputDispatcher.js"

export interface UseKeymapWiringInput {
	readonly disabled: boolean
	readonly ctxInput: BuildAppCtxInput
	readonly textInput: Omit<UseTextInputDispatcherInput, "disabled">
}

/**
 * Builds the keymap context, binds the renderer's input stream to the
 * keymap, and routes per-modal text input — three calls that always
 * fire together. Lifts ~140 lines of orchestration out of App.tsx;
 * App.tsx now hands over two named bundles and lets this hook wire
 * them up.
 */
export const useKeymapWiring = ({ disabled, ctxInput, textInput }: UseKeymapWiringInput): void => {
	const subscribe = useOpenTuiSubscribe()
	const gatedSubscribe = useMemo<KeySubscribe>(() => (handler) => subscribe((stroke) => disabled || handler(stroke)), [disabled, subscribe])
	useKeymap(appKeymap, buildAppCtx(ctxInput), gatedSubscribe)
	useTextInputDispatcher({ ...textInput, disabled })
}
