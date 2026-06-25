import { Effect } from "effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import { config } from "../../config.js"
import type { IssueItem } from "../../domain.js"
import type { ItemListInput } from "../../item.js"
import { resolveItemLoad, trimItemLoadCache } from "../../item/load.js"
import { loadItemQueue } from "../../item/queue.js"
import type { IssueLoad } from "../../issueLoad.js"
import { freshIssueLoad } from "../../issueCache.js"
import { type IssueView, initialIssueView, issueViewCacheKey, issueViewMode, issueViewRepository, issueViewToListInput, issueViewToQuery } from "../../issueViews.js"
import { CacheService } from "../../services/CacheService.js"
import { GitHubService } from "../../services/GitHubService.js"
import { githubRuntime, pullRequestPageSize } from "../../services/runtime.js"
import { selectedRepositoryAtom, workspaceSurfaceAtom } from "../../workspace/atoms.js"
import { effectiveFilterQueryAtom } from "../filter/atoms.js"
import { filterByScore, issueFilterScore } from "../filter/scoring.js"
import { orderIssuesForDisplay } from "../IssueList.js"
import { selectedIssueIndexAtom } from "../listSelection/atoms.js"

// Re-export the view type and helpers for back-compat with existing call sites
// that import from this module. New code should import directly from
// `src/issueViews.ts`.
export { initialIssueView, issueViewMode, issueViewRepository, issueViewToQuery, type IssueView }

export const activeIssueViewAtom = Atom.make<IssueView>(initialIssueView(null)).pipe(Atom.keepAlive)
export const issueOverridesAtom = Atom.make<Record<string, IssueItem>>({}).pipe(Atom.keepAlive)

// In-memory mirror of `queue_snapshots` for issues, keyed by `issueViewCacheKey`.
// Mirrors `queueLoadCacheAtom` for PRs. Lets us paint the cached list before
// the network request resolves.
export const issueQueueLoadCacheAtom = Atom.make<Partial<Record<string, IssueLoad>>>({}).pipe(Atom.keepAlive)

// Cap of repo-scoped "all" entries; user-scoped queues stay forever.
// Mirrors the PR-side `trimQueueLoadCache` shape so behaviour is consistent.
const MAX_ISSUE_REPOSITORY_CACHE_ENTRIES = 8
const trimIssueQueueLoadCache = (cache: Partial<Record<string, IssueLoad>>) => {
	return trimItemLoadCache(cache, (key) => key.startsWith("issue:all:") && !key.endsWith(":_"), MAX_ISSUE_REPOSITORY_CACHE_ENTRIES)
}

export const issuesAtom = githubRuntime.atom(
	Effect.fnUntraced(function* (get) {
		const view = get(activeIssueViewAtom)
		const github = yield* GitHubService
		const cacheService = yield* CacheService
		return yield* loadItemQueue(view, issueQueueLoadCacheAtom, {
			keyOfView: issueViewCacheKey,
			getAuthenticatedUser: github.getAuthenticatedUser(),
			readCached: (viewer, issueView) => cacheService.readIssueQueue(viewer, issueView),
			writeCached: (viewer, load) => cacheService.writeIssueQueue(viewer, load),
			fetchFirstPage: (issueView) => github.listIssuePage(issueViewToListInput(issueView, null, Math.min(pullRequestPageSize, config.prFetchLimit))),
			freshLoad: (issueView, page) => freshIssueLoad(issueView, page, config.prFetchLimit),
			trimCache: trimIssueQueueLoadCache,
		})
	}),
)

// Pure resolver — mirrors `resolveLoad` in `ui/pullRequests/atoms.ts`.
// Inlined into every consumer instead of going through `issueLoadAtom`
// because that intermediate derived atom does not reliably re-evaluate
// when its upstream deps change. See the longer note on `resolveLoad`
// in the PR atoms file.
export const resolveIssueLoad = (view: IssueView, cache: Partial<Record<string, IssueLoad>>, result: AsyncResult.AsyncResult<IssueLoad, unknown>): IssueLoad | null =>
	resolveItemLoad(view, cache, result, issueViewCacheKey)

export const showIssueRepositoryGroupsAtom = Atom.make((get) => get(selectedRepositoryAtom) === null)

export const allIssuesAtom = Atom.make((get): readonly IssueItem[] => {
	const view = get(activeIssueViewAtom)
	// The fetch atom writes every displayable result to the keyed cache. Do not
	// introduce a dynamic runtime-atom dependency in the displayed pipeline;
	// it can retain the previous view after a repo filter transition.
	const load = get(issueQueueLoadCacheAtom)[issueViewCacheKey(view)] ?? null
	const overrides = get(issueOverridesAtom)
	const scope = get(selectedRepositoryAtom)
	const source = (load?.data ?? []).filter((issue) => scope === null || issue.repository === scope)
	const seen = new Set<string>()
	const mapped = source.map((issue) => {
		seen.add(issue.url)
		return overrides[issue.url] ?? issue
	})
	const orphans = Object.values(overrides).filter((issue) => (scope === null || issue.repository === scope) && !seen.has(issue.url) && issue.state === "closed")
	const merged = [...mapped, ...orphans].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
	return orderIssuesForDisplay(merged, get(showIssueRepositoryGroupsAtom))
})

// Canonical displayed Issue list. Rendering, commands, comments, mutations,
// and load-more selection all read this atom so a text filter cannot leave the
// visible Issue different from the Issue an action targets.
export const issueListAtom = Atom.make((get): readonly IssueItem[] => {
	const issues = get(allIssuesAtom)
	const query = get(workspaceSurfaceAtom) === "issues" ? get(effectiveFilterQueryAtom) : ""
	if (query.length === 0) return issues
	return orderIssuesForDisplay(
		filterByScore(issues, query, issueFilterScore, (issue) => issue.updatedAt.getTime()),
		get(showIssueRepositoryGroupsAtom),
	)
})

export const selectedIssueAtom = Atom.make((get): IssueItem | null => {
	const issues = get(issueListAtom)
	if (issues.length === 0) return null
	const index = Math.max(0, Math.min(get(selectedIssueIndexAtom), issues.length - 1))
	return issues[index] ?? null
})

export const listIssuePageAtom = githubRuntime.fn<ItemListInput<"issue">>()((input) => GitHubService.use((github) => github.listIssuePage(input)))

export const writeIssueQueueAtom = githubRuntime.fn<{ readonly viewer: string; readonly load: IssueLoad }>()(({ viewer, load }) =>
	CacheService.use((cache) => cache.writeIssueQueue(viewer, load)),
)

export const loadedIssueCountAtom = Atom.make((get) => {
	return get(issueQueueLoadCacheAtom)[issueViewCacheKey(get(activeIssueViewAtom))]?.data.length ?? 0
})

export const hasMoreIssuesAtom = Atom.make((get) => {
	const load = get(issueQueueLoadCacheAtom)[issueViewCacheKey(get(activeIssueViewAtom))] ?? null
	return Boolean(load?.hasNextPage && load.data.length < config.prFetchLimit)
})

export const issueFetchInFlightAtom = Atom.make((get) => get(issuesAtom).waiting)

export const loadingMoreIssueKeyAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive)

// Selection rests on the load-more pseudo-row when the index is one past the
// last issue. Mirrors `loadMoreRowSelectedAtom` for PRs.
export const loadMoreIssueRowSelectedAtom = Atom.make((get) => {
	const issues = get(issueListAtom)
	return get(issueLoadMoreSlotAvailableAtom) && get(selectedIssueIndexAtom) === issues.length
})

export const issueLoadMoreSlotAvailableAtom = Atom.make((get) => {
	const filterActive = get(workspaceSurfaceAtom) === "issues" && get(effectiveFilterQueryAtom).length > 0
	return !get(issueFetchInFlightAtom) && !filterActive && get(hasMoreIssuesAtom) && get(issueListAtom).length > 0
})

export const addIssueLabelAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly label: string }>()((input) =>
	GitHubService.use((github) => github.addIssueLabel(input.repository, input.number, input.label)),
)

export const removeIssueLabelAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly label: string }>()((input) =>
	GitHubService.use((github) => github.removeIssueLabel(input.repository, input.number, input.label)),
)

export const closeIssueAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number }>()((input) =>
	GitHubService.use((github) => github.closeIssue(input.repository, input.number)),
)
