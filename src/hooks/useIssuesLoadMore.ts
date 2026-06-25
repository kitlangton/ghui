import { useAtom, useAtomSet } from "@effect/atom-react"
import { type MutableRefObject, useRef } from "react"
import { config } from "../config.js"
import { errorMessage } from "../errors.js"
import { type IssueView, issueViewToListInput } from "../issueViews.js"
import { itemQueueCacheViewer } from "../item/queue.js"
import { nextIssueLoadAfterPage } from "../issueCache.js"
import type { IssueLoad } from "../issueLoad.js"
import { pullRequestPageSize } from "../services/runtime.js"
import { listIssuePageAtom, loadingMoreIssueKeyAtom, writeIssueQueueAtom } from "../ui/issues/atoms.js"

export interface UseIssuesLoadMoreInput {
	readonly activeIssueView: IssueView
	readonly currentIssueCacheKey: string
	readonly issueLoad: IssueLoad | null
	readonly hasMoreIssues: boolean
	readonly issueFetchInFlight: boolean
	readonly username: string | null
	readonly refreshGenerationRef: MutableRefObject<number>
	readonly flashNotice: (message: string) => void
	readonly setIssueQueueLoadCache: (next: (prev: Partial<Record<string, IssueLoad>>) => Partial<Record<string, IssueLoad>>) => void
}

export interface UseIssuesLoadMoreResult {
	readonly loadMoreIssues: () => boolean
	readonly isLoadingMoreIssues: boolean
	readonly resetLoadingMoreIssues: () => void
}

const LOAD_MORE_TIMEOUT_MS = 15_000

/**
 * Issue load-more state machine. Mirrors `useLoadMore` for PRs:
 *   - `inFlightKeyRef` is the synchronous "is a fetch in flight" lock so
 *     same-tick triggers can't race.
 *   - `refreshGenerationRef` drops responses from views the user has
 *     navigated away from.
 *   - 15s timeout surfaces a hanging GraphQL response as a flash notice
 *     instead of wedging the spinner.
 */
export const useIssuesLoadMore = ({
	activeIssueView,
	currentIssueCacheKey,
	issueLoad,
	hasMoreIssues,
	issueFetchInFlight,
	username,
	refreshGenerationRef,
	flashNotice,
	setIssueQueueLoadCache,
}: UseIssuesLoadMoreInput): UseIssuesLoadMoreResult => {
	const loadIssuePage = useAtomSet(listIssuePageAtom, { mode: "promise" })
	const writeIssueQueue = useAtomSet(writeIssueQueueAtom, { mode: "promise" })
	const inFlightKeyRef = useRef<string | null>(null)
	const [loadingMoreKey, setLoadingMoreKey] = useAtom(loadingMoreIssueKeyAtom)
	const isLoadingMoreIssues = loadingMoreKey === currentIssueCacheKey

	const loadMoreIssues = (): boolean => {
		if (inFlightKeyRef.current !== null) return false
		if (issueFetchInFlight) return false
		if (!issueLoad || !hasMoreIssues || !issueLoad.endCursor) return false
		const remaining = config.prFetchLimit - issueLoad.data.length
		if (remaining <= 0) return false
		const cacheKey = currentIssueCacheKey
		const generation = refreshGenerationRef.current
		inFlightKeyRef.current = cacheKey
		setLoadingMoreKey(cacheKey)
		const fetchPromise = loadIssuePage(issueViewToListInput(activeIssueView, issueLoad.endCursor, Math.min(pullRequestPageSize, remaining)))
		let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null
		const timeoutPromise = new Promise<never>((_, reject) => {
			timeoutId = globalThis.setTimeout(() => reject(new Error(`Load more issues timed out after ${LOAD_MORE_TIMEOUT_MS / 1000}s`)), LOAD_MORE_TIMEOUT_MS)
		})
		void Promise.race([fetchPromise, timeoutPromise])
			.then((page) => {
				if (generation !== refreshGenerationRef.current) return
				// TOCTOU fix — see useLoadMore.ts for the longer note.
				let persistedLoad: IssueLoad | null = null
				setIssueQueueLoadCache((current) => {
					const currentLoad = current[cacheKey]
					if (!currentLoad) return current
					persistedLoad = nextIssueLoadAfterPage(currentLoad, page, config.prFetchLimit)
					return { ...current, [cacheKey]: persistedLoad }
				})
				if (!persistedLoad) return
				const viewer = itemQueueCacheViewer(activeIssueView, username)
				if (viewer) void writeIssueQueue({ viewer, load: persistedLoad }).catch(() => {})
			})
			.catch((error) => {
				flashNotice(errorMessage(error))
			})
			.finally(() => {
				if (timeoutId !== null) globalThis.clearTimeout(timeoutId)
				if (inFlightKeyRef.current === cacheKey) inFlightKeyRef.current = null
				setLoadingMoreKey((current) => (current === cacheKey ? null : current))
			})
		return true
	}

	const resetLoadingMoreIssues = () => {
		inFlightKeyRef.current = null
		setLoadingMoreKey(null)
	}

	return { loadMoreIssues, isLoadingMoreIssues, resetLoadingMoreIssues }
}
