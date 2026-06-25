import { useEffect, useEffectEvent, type MutableRefObject } from "react"

export interface UseIdleRefreshInput {
	readonly enabled: boolean
	readonly lastRefreshAtRef: MutableRefObject<number>
	readonly idleAfterMs: number
	readonly jitterMs: number
	readonly onRefresh: (minimumAgeMs: number) => void
	/**
	 * Bumped externally each time the underlying refresh completes so the
	 * effect reschedules from the new "now" instead of the original mount.
	 */
	readonly refreshGeneration: number | undefined
}

/**
 * Schedules a one-shot timeout to refresh pull requests after the configured
 * idle period (with jitter), restarting whenever a new refresh completes or
 * the terminal regains focus.
 */
export const useIdleRefresh = ({ enabled, lastRefreshAtRef, idleAfterMs, jitterMs, onRefresh, refreshGeneration }: UseIdleRefreshInput): void => {
	const refresh = useEffectEvent(onRefresh)
	useEffect(() => {
		if (!enabled) return
		const lastRefreshAt = lastRefreshAtRef.current || Date.now()
		const ageMs = Date.now() - lastRefreshAt
		const delayMs = Math.max(0, idleAfterMs - ageMs) + Math.floor(Math.random() * jitterMs)
		const timeout = globalThis.setTimeout(() => {
			refresh(idleAfterMs)
		}, delayMs)
		return () => globalThis.clearTimeout(timeout)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabled, refreshGeneration])
}
