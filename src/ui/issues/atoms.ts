import { Effect } from "effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import { devLog } from "../../devLog.js"
import type { IssueItem } from "../../domain.js"
import { type ItemListInput, issueQueryToListInput } from "../../item.js"
import type { IssueLoad } from "../../issueLoad.js"
import { freshIssueLoad } from "../../issueCache.js"
import { type IssueView, initialIssueView, issueViewCacheKey, issueViewMode, issueViewRepository, issueViewToQuery } from "../../issueViews.js"
import { CacheService } from "../../services/CacheService.js"
import { GitHubService } from "../../services/GitHubService.js"
import { githubRuntime, pullRequestPageSize } from "../../services/runtime.js"
import { selectedIssueIndexAtom } from "../listSelection/atoms.js"
import { issueOverridesAtom } from "../pullRequests/atoms.js"

// Re-export the view type and helpers for back-compat with existing call sites
// that import from this module. New code should import directly from
// `src/issueViews.ts`.
export { initialIssueView, issueViewMode, issueViewRepository, issueViewToQuery, type IssueView }

export const activeIssueViewAtom = Atom.make<IssueView>(initialIssueView(null)).pipe(Atom.keepAlive)

const emptyIssueLoad = (view: IssueView): IssueLoad => ({
	view,
	data: [],
	fetchedAt: null,
	endCursor: null,
	hasNextPage: false,
})

// In-memory mirror of `queue_snapshots` for issues, keyed by `issueViewCacheKey`.
// Mirrors `queueLoadCacheAtom` for PRs. Lets us paint the cached list before
// the network request resolves.
export const issueQueueLoadCacheAtom = Atom.make<Partial<Record<string, IssueLoad>>>({}).pipe(Atom.keepAlive)

// Cap of repo-scoped "all" entries; user-scoped queues stay forever.
// Mirrors the PR-side `trimQueueLoadCache` shape so behaviour is consistent.
const MAX_ISSUE_REPOSITORY_CACHE_ENTRIES = 8
const trimIssueQueueLoadCache = (cache: Partial<Record<string, IssueLoad>>) => {
	const repositoryKeys = Object.keys(cache).filter((key) => key.startsWith("issue:all:") && !key.endsWith(":_"))
	if (repositoryKeys.length <= MAX_ISSUE_REPOSITORY_CACHE_ENTRIES) return cache
	const remove = new Set(repositoryKeys.slice(0, repositoryKeys.length - MAX_ISSUE_REPOSITORY_CACHE_ENTRIES))
	return Object.fromEntries(Object.entries(cache).filter(([key]) => !remove.has(key))) as Partial<Record<string, IssueLoad>>
}

// Family of one runtime atom per issue view, keyed by `issueViewCacheKey`.
// Mirrors `pullRequestsForView` — view is baked into each family member's
// body via closure, so a view switch reads a different member rather than
// invalidating one shared atom.
type IssuesViewAtom = Atom.Atom<AsyncResult.AsyncResult<IssueLoad, unknown>>
const issuesAtomByCacheKey = new Map<string, IssuesViewAtom>()

const buildIssuesForView = (view: IssueView): IssuesViewAtom =>
	githubRuntime
		.atom(
			Effect.fnUntraced(function* () {
				const github = yield* GitHubService
				const cacheService = yield* CacheService
				const cacheKey = issueViewCacheKey(view)
				const mode = issueViewMode(view)
				const repository = issueViewRepository(view)
				// "all" needs a repository; without one we have nothing to show until the user picks one.
				if (mode === "all" && !repository) return emptyIssueLoad(view)
				const cacheUsername =
					view._tag === "Repository"
						? null
						: yield* github.getAuthenticatedUser().pipe(
								Effect.catch((cause) => {
									devLog("issuesAtom:authFailed", { view, cause: String(cause) })
									return Effect.succeed(null)
								}),
							)
				const cacheViewer = issueCacheViewerFor(view, cacheUsername)
				if (cacheViewer) {
					const cachedLoad = yield* cacheService.readIssueQueue(cacheViewer, view).pipe(Effect.catch(() => Effect.succeed(null)))
					if (cachedLoad) {
						yield* Atom.update(issueQueueLoadCacheAtom, (cache) => (cache[cacheKey] ? cache : trimIssueQueueLoadCache({ ...cache, [cacheKey]: cachedLoad })))
					}
				}
				const page = yield* github.listIssuePage(issueQueryToListInput(issueViewToQuery(view), null, pullRequestPageSize))
				const load = yield* Atom.modify(issueQueueLoadCacheAtom, (cache) => {
					const next = freshIssueLoad(view, page)
					return [next, trimIssueQueueLoadCache({ ...cache, [cacheKey]: next })]
				})
				if (cacheViewer) yield* cacheService.writeIssueQueue(cacheViewer, load)
				return load
			}),
		)
		.pipe(Atom.keepAlive)

export const issuesForView = (view: IssueView): IssuesViewAtom => {
	const key = issueViewCacheKey(view)
	let atom = issuesAtomByCacheKey.get(key)
	if (atom) return atom
	atom = buildIssuesForView(view)
	issuesAtomByCacheKey.set(key, atom)
	return atom
}

// Display source for the Issues tab. Reads the in-memory queue cache first
// (populated by either the SQLite read or the network response) and falls
// back to whatever the network atom most recently resolved. Mirrors
// `pullRequestLoadAtom`.
// Pure resolver — mirrors `resolveLoad` in `ui/pullRequests/atoms.ts`.
// Inlined into every consumer instead of going through `issueLoadAtom`
// because that intermediate derived atom does not reliably re-evaluate
// when its upstream deps change. See the longer note on `resolveLoad`
// in the PR atoms file.
export const resolveIssueLoad = (view: IssueView, cache: Partial<Record<string, IssueLoad>>, result: AsyncResult.AsyncResult<IssueLoad, unknown>): IssueLoad | null => {
	const cacheKey = issueViewCacheKey(view)
	const cached = cache[cacheKey] ?? null
	if (cached) return cached
	const resolved = AsyncResult.getOrElse(result, () => null)
	if (resolved && issueViewCacheKey(resolved.view) === cacheKey) return resolved
	return null
}

export const isLoadingIssueViewAtom = Atom.make((get) => {
	// With family-per-view, the family member's view always matches its
	// own key. So "is the active issue view's queue loading" reduces to
	// "is the current family member in a waiting state with no resolved
	// value yet".
	const result = get(issuesForView(get(activeIssueViewAtom)))
	return result.waiting && AsyncResult.getOrElse(result, () => null) === null
})

export const issueListAtom = Atom.make((get): readonly IssueItem[] => {
	const view = get(activeIssueViewAtom)
	// The fetch atom writes every displayable result to the keyed cache. Do not
	// introduce a dynamic runtime-atom dependency in the displayed pipeline;
	// it can retain the previous view after a repo filter transition.
	const load = get(issueQueueLoadCacheAtom)[issueViewCacheKey(view)] ?? null
	const overrides = get(issueOverridesAtom)
	const scope = issueViewRepository(view)
	const source = (load?.data ?? []).filter((issue) => scope === null || issue.repository === scope)
	return source.map((issue) => overrides[issue.url] ?? issue)
})

export const selectedIssueAtom = Atom.make((get): IssueItem | null => {
	const issues = get(issueListAtom)
	if (issues.length === 0) return null
	const index = Math.max(0, Math.min(get(selectedIssueIndexAtom), issues.length - 1))
	return issues[index] ?? null
})

// Pagination — mirrors PR atoms in src/ui/pullRequests/atoms.ts.
export const issueCacheViewerFor = (view: IssueView, username: string | null): string | null => (view._tag === "Repository" ? "anonymous" : username)

export const listIssuePageAtom = githubRuntime.fn<ItemListInput<"issue">>()((input) => GitHubService.use((github) => github.listIssuePage(input)))

export const writeIssueQueueAtom = githubRuntime.fn<{ readonly viewer: string; readonly load: IssueLoad }>()(({ viewer, load }) =>
	CacheService.use((cache) => cache.writeIssueQueue(viewer, load)),
)

export const loadedIssueCountAtom = Atom.make((get) => {
	return get(issueQueueLoadCacheAtom)[issueViewCacheKey(get(activeIssueViewAtom))]?.data.length ?? 0
})

export const hasMoreIssuesAtom = Atom.make((get) => {
	const load = get(issueQueueLoadCacheAtom)[issueViewCacheKey(get(activeIssueViewAtom))] ?? null
	// Reuse the PR fetch limit until issues get their own knob — the cap is
	// the same shape (don't blow past N items per queue).
	const PR_FETCH_LIMIT = 500
	return Boolean(load?.hasNextPage && load.data.length < PR_FETCH_LIMIT)
})

export const loadingMoreIssueKeyAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive)

// Selection rests on the load-more pseudo-row when the index is one past the
// last issue. Mirrors `loadMoreRowSelectedAtom` for PRs.
export const loadMoreIssueRowSelectedAtom = Atom.make((get) => {
	const issues = get(issueListAtom)
	const hasMore = get(hasMoreIssuesAtom)
	return hasMore && issues.length > 0 && get(selectedIssueIndexAtom) === issues.length
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
