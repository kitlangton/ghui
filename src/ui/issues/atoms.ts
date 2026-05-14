import { Effect } from "effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import type { IssueItem } from "../../domain.js"
import { type ItemListInput, issueQueryToListInput } from "../../item.js"
import type { IssueLoad } from "../../issueLoad.js"
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

// The `(get)` parameter makes this atom reactive on the active issue view.
// Using `get(activeIssueViewAtom)` (rather than `Atom.get(...)` as an Effect
// service) registers the dependency via AtomContext, so any view change —
// e.g. flipping the filter modal to "mine" — invalidates and re-fetches.
export const issuesAtom = githubRuntime
	.atom(
		Effect.fnUntraced(function* (get) {
			const github = yield* GitHubService
			const cacheService = yield* CacheService
			const view = get(activeIssueViewAtom)
			const cacheKey = issueViewCacheKey(view)
			const mode = issueViewMode(view)
			const repository = issueViewRepository(view)
			// "all" needs a repository; without one we have nothing to show until the user picks one.
			if (mode === "all" && !repository) return emptyIssueLoad(view)
			const cacheUsername = view._tag === "Repository" ? null : yield* github.getAuthenticatedUser().pipe(Effect.catch(() => Effect.succeed(null)))
			const cacheViewer = issueCacheViewerFor(view, cacheUsername)
			if (cacheViewer) {
				const cachedLoad = yield* cacheService.readIssueQueue(cacheViewer, view).pipe(Effect.catch(() => Effect.succeed(null)))
				if (cachedLoad) {
					yield* Atom.update(issueQueueLoadCacheAtom, (cache) => (cache[cacheKey] ? cache : { ...cache, [cacheKey]: cachedLoad }))
				}
			}
			const page = yield* github.listIssuePage(issueQueryToListInput(issueViewToQuery(view), null, pullRequestPageSize))
			const load = yield* Atom.modify(issueQueueLoadCacheAtom, (cache) => {
				const existing = cache[cacheKey]
				// Same guard as pullRequestsAtom: don't overwrite a non-empty
				// cache entry with an empty fetch, since gh can transiently
				// return [] for a repo that actually has issues.
				const looksLikeBogusEmpty = page.items.length === 0 && (existing?.data.length ?? 0) > 0
				const next: IssueLoad = {
					view,
					data: looksLikeBogusEmpty ? existing!.data : page.items,
					fetchedAt: new Date(),
					endCursor: looksLikeBogusEmpty ? (existing?.endCursor ?? page.endCursor) : page.endCursor,
					hasNextPage: looksLikeBogusEmpty ? (existing?.hasNextPage ?? false) : page.hasNextPage,
				}
				return [next, { ...cache, [cacheKey]: next }]
			})
			// Same SQLite-write guard as pullRequestsAtom — don't persist an
			// empty queue or it'll come back authoritative next session.
			if (cacheViewer && load.data.length > 0) yield* cacheService.writeIssueQueue(cacheViewer, load)
			return load
		}),
	)
	.pipe(Atom.keepAlive)

// Display source for the Issues tab. Reads the in-memory queue cache first
// (populated by either the SQLite read or the network response) and falls
// back to whatever the network atom most recently resolved. Mirrors
// `pullRequestLoadAtom`.
export const issueLoadAtom = Atom.make((get) => {
	const view = get(activeIssueViewAtom)
	const cacheKey = issueViewCacheKey(view)
	const cache = get(issueQueueLoadCacheAtom)
	const result = get(issuesAtom)
	const resolved = AsyncResult.getOrElse(result, () => null)
	return cache[cacheKey] ?? (resolved && issueViewCacheKey(resolved.view) === cacheKey ? resolved : null)
})

export const isLoadingIssueViewAtom = Atom.make((get) => {
	const cacheKey = issueViewCacheKey(get(activeIssueViewAtom))
	const resolved = AsyncResult.getOrElse(get(issuesAtom), () => null)
	return resolved !== null && issueViewCacheKey(resolved.view) !== cacheKey
})

export const issueListAtom = Atom.make((get): readonly IssueItem[] => {
	const load = get(issueLoadAtom)
	const overrides = get(issueOverridesAtom)
	// Defensive scope filter — see displayedPullRequestsAtom for the same
	// pattern. Without it, a stale cache entry can surface items from the
	// previous repository under the new breadcrumb.
	const scope = issueViewRepository(get(activeIssueViewAtom))
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

export const loadedIssueCountAtom = Atom.make((get) => get(issueLoadAtom)?.data.length ?? 0)

export const hasMoreIssuesAtom = Atom.make((get) => {
	const load = get(issueLoadAtom)
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
