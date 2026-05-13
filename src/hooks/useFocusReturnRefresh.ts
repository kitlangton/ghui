import { type MutableRefObject } from "react"
import { useTerminalFocus } from "../ui/useTerminalFocus.js"
import { useIdleRefresh } from "../ui/pullRequests/useIdleRefresh.js"

interface RendererFocusEvents {
	on: (event: "focus" | "blur", handler: () => void) => void
	off: (event: "focus" | "blur", handler: () => void) => void
}

export interface UseFocusReturnRefreshInput {
	readonly renderer: RendererFocusEvents
	readonly lastRefreshAtRef: MutableRefObject<number>
	readonly refreshGeneration: number | undefined
	readonly focusReturnMinMs: number
	readonly idleAfterMs: number
	readonly jitterMs: number
	readonly onRefresh: (minimumAgeMs: number) => void
}

export interface UseFocusReturnRefreshResult {
	readonly terminalFocused: boolean
	readonly terminalFocusedRef: MutableRefObject<boolean>
}

/**
 * Bundles the two auto-refresh behaviours:
 *   - refresh when the terminal regains focus after a blur (debounced by min age)
 *   - refresh after an idle period while focused (with jitter)
 *
 * Callers get back the focus state in both reactive (`terminalFocused`) and
 * ref (`terminalFocusedRef`) flavours.
 */
export const useFocusReturnRefresh = ({
	renderer,
	lastRefreshAtRef,
	refreshGeneration,
	focusReturnMinMs,
	idleAfterMs,
	jitterMs,
	onRefresh,
}: UseFocusReturnRefreshInput): UseFocusReturnRefreshResult => {
	const { terminalFocused, terminalFocusedRef } = useTerminalFocus({
		renderer,
		onFocusReturn: () => onRefresh(focusReturnMinMs),
	})

	useIdleRefresh({
		enabled: terminalFocused,
		lastRefreshAtRef,
		idleAfterMs,
		jitterMs,
		onRefresh,
		refreshGeneration,
	})

	return { terminalFocused, terminalFocusedRef }
}
