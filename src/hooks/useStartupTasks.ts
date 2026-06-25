import { useEffect } from "react"
import { devLog } from "../devLog.js"
import type { IssueItem, PullRequestItem } from "../domain.js"
import type { RepoRollupRow } from "../services/CacheService.js"

interface PullRequestLoadShape {
	readonly fetchedAt?: Date | null
}

interface IssueLoadShape {
	readonly fetchedAt?: Date | null
}

export interface UseStartupTasksInput {
	readonly username: string | null
	readonly recentRepositories: readonly string[]
	readonly favoriteRepositories: Readonly<Record<string, boolean>>
	readonly detectedRepository: string | null
	readonly pullRequestLoad: PullRequestLoadShape | null
	readonly issueLoad: IssueLoadShape | null
	readonly currentQueueCacheKey: string
	readonly selectedIndex: number
	readonly persistQueueSelection: boolean
	readonly readRepoRollup: (username: string) => Promise<readonly RepoRollupRow[]>
	readonly setRepoRollup: (rows: readonly RepoRollupRow[]) => void
	readonly prewarmRepositoryDetails: (repositories: readonly string[]) => Promise<unknown>
	readonly pruneCache: () => Promise<unknown>
	readonly setQueueSelection: (next: (prev: Partial<Record<string, number>>) => Partial<Record<string, number>>) => void
	readonly issues: readonly IssueItem[]
	readonly pullRequests: readonly PullRequestItem[]
}

void {} as IssueItem | PullRequestItem | undefined

/**
 * Side-effects that fire on mount or in response to user-state changes:
 *   - Hydrate the cached repo rollup so the Repos tab renders before
 *     live PR/issue queries return.
 *   - Background-prewarm `repository_details` for the user's repo set.
 *   - One-shot cache prune at startup (keeps offline-only sessions bounded).
 *   - Persist queue selection per cache key so PR list scroll position
 *     restores when switching between views.
 */
export const useStartupTasks = ({
	username,
	recentRepositories,
	favoriteRepositories,
	detectedRepository,
	pullRequestLoad,
	issueLoad,
	currentQueueCacheKey,
	selectedIndex,
	persistQueueSelection,
	readRepoRollup,
	setRepoRollup,
	prewarmRepositoryDetails,
	pruneCache,
	setQueueSelection,
}: UseStartupTasksInput): void => {
	useEffect(() => {
		void pruneCache().catch((cause) => devLog("useStartupTasks:pruneCacheFailed", { cause: String(cause) }))
	}, [pruneCache])

	useEffect(() => {
		if (!username) return
		void readRepoRollup(username)
			.then((rows) => setRepoRollup(rows))
			.catch((cause) => devLog("useStartupTasks:readRepoRollupFailed", { username, cause: String(cause) }))
	}, [username, pullRequestLoad?.fetchedAt, issueLoad?.fetchedAt, readRepoRollup, setRepoRollup])

	useEffect(() => {
		if (!username) return
		const repositories = Array.from(new Set([...recentRepositories, ...Object.keys(favoriteRepositories), ...(detectedRepository ? [detectedRepository] : [])]))
		if (repositories.length === 0) return
		void prewarmRepositoryDetails(repositories).catch((cause) => devLog("useStartupTasks:prewarmFailed", { repositories, cause: String(cause) }))
	}, [username, recentRepositories, favoriteRepositories, detectedRepository, prewarmRepositoryDetails])

	useEffect(() => {
		if (!persistQueueSelection) return
		setQueueSelection((current) => (current[currentQueueCacheKey] === selectedIndex ? current : { ...current, [currentQueueCacheKey]: selectedIndex }))
	}, [currentQueueCacheKey, persistQueueSelection, selectedIndex, setQueueSelection])
}
