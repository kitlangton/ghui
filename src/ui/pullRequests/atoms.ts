import { Effect, Schedule } from "effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import { config } from "../../config.js"
import type {
	IssueItem,
	LoadStatus,
	PullRequestItem,
	PullRequestLabel,
	PullRequestMergeAction,
	PullRequestMergeMethod,
	RepositoryDetails,
	RepositoryMergeMethods,
} from "../../domain.js"
import { devLog } from "../../devLog.js"
import { type ItemListInput, searchQualifier } from "../../item.js"
import { mergeCachedDetails } from "../../pullRequestCache.js"
export { appendPullRequestPage, nextLoadAfterPage } from "../../pullRequestCache.js"
import type { PullRequestLoad } from "../../pullRequestLoad.js"
import { activePullRequestViews, initialPullRequestView, type PullRequestView, viewCacheKey, viewRepository, viewToListInput } from "../../pullRequestViews.js"
import { CacheService, type PullRequestCacheKey } from "../../services/CacheService.js"
import { isCommandTimeoutError } from "../../services/CommandRunner.js"
import { GitHubService, isGitHubRateLimitError } from "../../services/GitHubService.js"
import { githubRuntime, pullRequestPageSize } from "../../services/runtime.js"
import { effectiveFilterQueryAtom } from "../filter/atoms.js"
import { initialRetryProgress, RetryProgress } from "../FooterHints.js"
import { selectedIndexAtom } from "../listSelection/atoms.js"
import { groupBy } from "../pullRequests.js"

export const PR_FETCH_RETRIES = 6
const MAX_REPOSITORY_CACHE_ENTRIES = 8

export const shouldRetryPullRequestFetch = (error: unknown): boolean => !isGitHubRateLimitError(error) && !isCommandTimeoutError(error)

// === UI cache atoms ===
export const labelCacheAtom = Atom.make<Record<string, readonly PullRequestLabel[]>>({}).pipe(Atom.keepAlive)
export const repoMergeMethodsCacheAtom = Atom.make<Record<string, RepositoryMergeMethods>>({}).pipe(Atom.keepAlive)
export const lastUsedMergeMethodAtom = Atom.make<Record<string, PullRequestMergeMethod>>({}).pipe(Atom.keepAlive)
export const pullRequestOverridesAtom = Atom.make<Record<string, PullRequestItem>>({}).pipe(Atom.keepAlive)
export const issueOverridesAtom = Atom.make<Record<string, IssueItem>>({}).pipe(Atom.keepAlive)
export const recentlyCompletedPullRequestsAtom = Atom.make<Record<string, PullRequestItem>>({}).pipe(Atom.keepAlive)
export const repositoryDetailsCacheAtom = Atom.make<Record<string, RepositoryDetails>>({}).pipe(Atom.keepAlive)

// === Atom-key helpers (shared with diff atoms) ===
export const pullRequestRevisionAtomKey = (pullRequest: PullRequestItem) => `${pullRequest.repository}\u0000${pullRequest.number}\u0000${pullRequest.headRefOid}`
export const parsePullRequestRevisionAtomKey = (key: string, label: string): { repository: string; number: number } => {
	const [repository, number] = key.split("\u0000")
	if (!repository || !number) throw new Error(`Invalid pull request ${label} key: ${key}`)
	return { repository, number: Number.parseInt(number, 10) }
}
export const pullRequestDetailKey = (pullRequest: PullRequestItem) => `${pullRequest.url}:${pullRequest.headRefOid}`

// === Helpers used by atom bodies and by load-more handlers ===
// `appendPullRequestPage` and `nextLoadAfterPage` are re-exported from
// pullRequestCache.js above so callers don't need to know where they live.

export const cacheViewerFor = (view: PullRequestView, username: string | null): string | null => (view._tag === "Repository" ? "anonymous" : username)

const trimQueueLoadCache = (cache: Partial<Record<string, PullRequestLoad>>) => {
	// Repo-scoped "all" entries are the long-tail; trim them, not user queues.
	const repositoryKeys = Object.keys(cache).filter((key) => key.startsWith("pullRequest:all:") && !key.endsWith(":_"))
	if (repositoryKeys.length <= MAX_REPOSITORY_CACHE_ENTRIES) return cache
	const remove = new Set(repositoryKeys.slice(0, repositoryKeys.length - MAX_REPOSITORY_CACHE_ENTRIES))
	return Object.fromEntries(Object.entries(cache).filter(([key]) => !remove.has(key))) as Partial<Record<string, PullRequestLoad>>
}

// === View / queue state atoms ===
export const retryProgressAtom = Atom.make<RetryProgress>(initialRetryProgress).pipe(Atom.keepAlive)
export const activeViewAtom = Atom.make<PullRequestView>(initialPullRequestView(null)).pipe(Atom.keepAlive)
export const queueLoadCacheAtom = Atom.make<Partial<Record<string, PullRequestLoad>>>({}).pipe(Atom.keepAlive)
export const queueSelectionAtom = Atom.make<Partial<Record<string, number>>>({}).pipe(Atom.keepAlive)

// === Data-fetching atoms ===
//
// Family of one runtime atom per view, keyed by `viewCacheKey(view)`.
// Each family member's body bakes the view into its closure — it does NOT
// `get(activeViewAtom)`. Switching the active view means consumers read
// a DIFFERENT family member; no shared atom needs to invalidate or
// re-evaluate.
//
// Why a family instead of one shared `pullRequestsAtom` that reads
// `activeViewAtom`: the shared shape forced effect-atom into a
// re-run-on-dep-change pattern that broke after certain transition
// sequences (open repo A → esc → open repo B left the runtime atom
// stuck — its body never ran for B). Family-per-view sidesteps that
// entire class of bug: the new view's atom is fresh and runs its body
// on first read; the old view's atom keeps its value or completes
// independently.
//
// Cached by `viewCacheKey` string so equal-content views share an atom
// even when constructed as new object literals (which would defeat the
// reference-equality keying that `Atom.family` uses for plain objects).
type PullRequestsAtom = Atom.Atom<AsyncResult.AsyncResult<PullRequestLoad, unknown>>
const pullRequestsAtomByCacheKey = new Map<string, PullRequestsAtom>()

const buildPullRequestsForView = (view: PullRequestView): PullRequestsAtom =>
	githubRuntime
		.atom(
			Effect.fnUntraced(function* () {
				const github = yield* GitHubService
				const cacheService = yield* CacheService
				const cacheKey = viewCacheKey(view)
				devLog("pullRequestsAtom:start", { view, cacheKey })
				const cacheUsername =
					view._tag === "Repository"
						? null
						: yield* github.getAuthenticatedUser().pipe(
								Effect.catch((cause) => {
									devLog("pullRequestsAtom:authFailed", { view, cause: String(cause) })
									return Effect.succeed(null)
								}),
							)
				const cacheViewer = cacheViewerFor(view, cacheUsername)
				devLog("pullRequestsAtom:viewer", { cacheUsername, cacheViewer })
				if (cacheViewer) {
					const cachedLoad = yield* cacheService.readQueue(cacheViewer, view).pipe(Effect.catch(() => Effect.succeed(null)))
					devLog("pullRequestsAtom:sqliteRead", {
						cacheKey,
						hit: cachedLoad !== null,
						count: cachedLoad?.data.length ?? 0,
						storedView: cachedLoad?.view,
						sampleAuthors: cachedLoad?.data.slice(0, 5).map((pr) => pr.author),
					})
					if (cachedLoad) {
						yield* Atom.update(queueLoadCacheAtom, (cache) => (cache[cacheKey] ? cache : trimQueueLoadCache({ ...cache, [cacheKey]: cachedLoad })))
					}
				}
				yield* Atom.set(retryProgressAtom, initialRetryProgress)
				const listInput = viewToListInput(view, null, Math.min(pullRequestPageSize, config.prFetchLimit))
				devLog("pullRequestsAtom:fetch", { cacheKey, listInput, query: searchQualifier(listInput) })
				const page = yield* github.listPullRequestPage(listInput).pipe(
					Effect.tapError((error) =>
						shouldRetryPullRequestFetch(error)
							? Atom.update(retryProgressAtom, (current) =>
									RetryProgress.Retrying({
										attempt: Math.min(RetryProgress.$match(current, { Idle: () => 0, Retrying: ({ attempt }) => attempt }) + 1, PR_FETCH_RETRIES),
										max: PR_FETCH_RETRIES,
									}),
								)
							: Effect.void,
					),
					Effect.retry({ times: PR_FETCH_RETRIES, schedule: Schedule.exponential("300 millis", 2), while: shouldRetryPullRequestFetch }),
					Effect.tapError(() => Atom.set(retryProgressAtom, initialRetryProgress)),
				)

				yield* Atom.set(retryProgressAtom, initialRetryProgress)
				devLog("pullRequestsAtom:page", {
					cacheKey,
					count: page.items.length,
					hasNextPage: page.hasNextPage,
					sampleAuthors: page.items.slice(0, 8).map((pr) => pr.author),
				})
				const load = yield* Atom.modify(queueLoadCacheAtom, (cache) => {
					const existing = cache[cacheKey]
					// Don't overwrite a non-empty cache with an empty fetch: gh can
					// transiently return [] for a repo that actually has PRs (rate
					// limit, auth blip, cold gh cache). Persisting that empty page
					// would make subsequent visits read "0 PRs" from SQLite and
					// surface "No open pull requests" until the user manually
					// presses `r`. Keep the existing entries instead and let the
					// next refresh correct things.
					const looksLikeBogusEmpty = page.items.length === 0 && (existing?.data.length ?? 0) > 0
					const data = looksLikeBogusEmpty ? existing!.data : mergeCachedDetails(page.items, existing?.data)
					const next: PullRequestLoad = {
						view,
						data,
						fetchedAt: new Date(),
						endCursor: looksLikeBogusEmpty ? (existing?.endCursor ?? page.endCursor) : page.endCursor,
						hasNextPage: looksLikeBogusEmpty ? (existing?.hasNextPage ?? false) : page.hasNextPage && data.length < config.prFetchLimit,
					}
					const cacheNext = { ...cache }
					delete cacheNext[cacheKey]
					cacheNext[cacheKey] = next
					return [next, trimQueueLoadCache(cacheNext)]
				})
				if (cacheViewer && load.data.length > 0) yield* cacheService.writeQueue(cacheViewer, load)
				devLog("pullRequestsAtom:done", {
					cacheKey,
					loadView: load.view,
					dataLen: load.data.length,
					sampleAuthors: load.data.slice(0, 8).map((pr) => pr.author),
				})
				return load
			}),
		)
		.pipe(Atom.keepAlive)

export const pullRequestsForView = (view: PullRequestView): PullRequestsAtom => {
	const key = viewCacheKey(view)
	let atom = pullRequestsAtomByCacheKey.get(key)
	if (atom) return atom
	atom = buildPullRequestsForView(view)
	pullRequestsAtomByCacheKey.set(key, atom)
	return atom
}

export const usernameAtom = githubRuntime.atom(GitHubService.use((github) => github.getAuthenticatedUser())).pipe(Atom.keepAlive)

export const listRepoLabelsAtom = githubRuntime.fn<string>()((repository) => GitHubService.use((github) => github.listRepoLabels(repository)))

export const listOpenPullRequestPageAtom = githubRuntime.fn<ItemListInput<"pullRequest">>()((input) => GitHubService.use((github) => github.listPullRequestPage(input)))

// Family of one atom per repository. The empty string is a sentinel "no
// selection" — the atom resolves to null without hitting the service, so the
// caller can read it unconditionally from React.
//
// No `keepAlive`: family-created atoms self-clean via WeakRef +
// FinalizationRegistry. Keeping them alive defeats GC and accumulates one
// entry per repository the user has ever viewed.
export const readCachedRepositoryDetailsAtom = githubRuntime.fn<string>()((repository) => CacheService.use((cache) => cache.readRepositoryDetails(repository)))
export const writeRepositoryDetailsAtom = githubRuntime.fn<RepositoryDetails>()((details) => CacheService.use((cache) => cache.writeRepositoryDetails(details)))
export const fetchRepositoryDetailsAtom = githubRuntime.fn<string>()((repository) => GitHubService.use((github) => github.getRepositoryDetails(repository)))

// Background hydration of `repository_details` for the user's set of repos
// (favorites + recents + cwd). Skips fetches for repos whose cached row is
// younger than `REPO_DETAILS_PREWARM_TTL_MS`. Errors are swallowed — this is
// an opportunistic warm-up, not a critical path.
const REPO_DETAILS_PREWARM_TTL_MS = 6 * 60 * 60 * 1000
const REPO_DETAILS_PREWARM_CONCURRENCY = 4

export const prewarmRepositoryDetailsAtom = githubRuntime.fn<readonly string[]>()((repositories) =>
	Effect.forEach(
		repositories,
		(repository) =>
			Effect.gen(function* () {
				const cache = yield* CacheService
				// Seed the in-memory atom from SQLite first so RepoDetailPane can
				// render stats on the first frame — without this, useRepositoryDetails
				// has to wait one async hop before it can fill the cache itself.
				const cached = yield* cache.readRepositoryDetails(repository).pipe(Effect.catch(() => Effect.succeed(null)))
				if (cached) {
					yield* Atom.update(repositoryDetailsCacheAtom, (current) => (current[repository] ? current : { ...current, [repository]: cached }))
				}
				const fetchedAt = yield* cache.readRepositoryDetailsFetchedAt(repository).pipe(Effect.catch(() => Effect.succeed(null)))
				if (fetchedAt && Date.now() - fetchedAt.getTime() < REPO_DETAILS_PREWARM_TTL_MS) return
				const fresh = yield* GitHubService.use((github) => github.getRepositoryDetails(repository))
				yield* cache.writeRepositoryDetails(fresh)
				yield* Atom.update(repositoryDetailsCacheAtom, (current) => ({ ...current, [repository]: fresh }))
			}).pipe(Effect.catch(() => Effect.void)),
		{ concurrency: REPO_DETAILS_PREWARM_CONCURRENCY, discard: true },
	),
)

// One-shot detail fetch. Triggered imperatively by `useDetailHydration`,
// which mirrors the result into `queueLoadCacheAtom` + the SQLite-backed
// `readCachedPullRequestAtom`. Same reasoning as `pullRequestDiffAtom` —
// `runtime.fn` yields a clean Promise from `useAtomSet({ mode: "promise" })`
// instead of the dangling-AsyncResult hazard of family-of-runtime.atom +
// `Effect.runPromise(AtomRegistry.getResult(...))`.
export const pullRequestDetailsAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number }>()((input) =>
	GitHubService.use((github) => github.getPullRequestDetails(input.repository, input.number)),
)

export const readCachedPullRequestAtom = githubRuntime.fn<PullRequestCacheKey>()((key) => CacheService.use((cache) => cache.readPullRequest(key)))
export const writeCachedPullRequestAtom = githubRuntime.fn<PullRequestItem>()((pullRequest) => CacheService.use((cache) => cache.upsertPullRequest(pullRequest)))
export const writeQueueCacheAtom = githubRuntime.fn<{ readonly viewer: string; readonly load: PullRequestLoad }>()(({ viewer, load }) =>
	CacheService.use((cache) => cache.writeQueue(viewer, load)),
)
export const pruneCacheAtom = githubRuntime.fn<void>()(() => CacheService.use((cache) => cache.prune()))

export const addPullRequestLabelAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly label: string }>()((input) =>
	GitHubService.use((github) => github.addPullRequestLabel(input.repository, input.number, input.label)),
)
export const removePullRequestLabelAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly label: string }>()((input) =>
	GitHubService.use((github) => github.removePullRequestLabel(input.repository, input.number, input.label)),
)
export const toggleDraftAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly isDraft: boolean }>()((input) =>
	GitHubService.use((github) => github.toggleDraftStatus(input.repository, input.number, input.isDraft)),
)

export const getPullRequestMergeInfoAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number }>()((input) =>
	GitHubService.use((github) => github.getPullRequestMergeInfo(input.repository, input.number)),
)
export const getRepositoryMergeMethodsAtom = githubRuntime.fn<string>()((repository) => GitHubService.use((github) => github.getRepositoryMergeMethods(repository)))
export const mergePullRequestAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly action: PullRequestMergeAction }>()((input) =>
	GitHubService.use((github) => github.mergePullRequest(input.repository, input.number, input.action)),
)
export const closePullRequestAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number }>()((input) =>
	GitHubService.use((github) => github.closePullRequest(input.repository, input.number)),
)

// === Derived atoms (PR list pipeline) ===
const pullRequestFilterScore = (pullRequest: PullRequestItem, query: string) => {
	const normalized = query.trim().toLowerCase()
	if (normalized.length === 0) return 0
	const fields = [
		pullRequest.title.toLowerCase(),
		pullRequest.repository.toLowerCase(),
		pullRequest.author.toLowerCase(),
		pullRequest.headRefName.toLowerCase(),
		String(pullRequest.number),
	]
	const scores = fields.flatMap((field, index) => {
		const matchIndex = field.indexOf(normalized)
		return matchIndex >= 0 ? [index * 1000 + matchIndex] : []
	})
	return scores.length > 0 ? Math.min(...scores) : null
}

// Pure resolver for the current view's load: prefer the in-memory cache for
// the active view; fall back to the latest resolved fetch only if its view
// matches. Inlined into every consumer instead of going through a
// `pullRequestLoadAtom` intermediate — derived atoms that read multiple
// upstream atoms can fail to re-evaluate cleanly under effect-atom's dep
// propagation for certain transitions (reproduced by switching
// Repository(X) -> Queue(authored, X)), leaving stale `view`/`data` for
// the new active view. Reading the underlying atoms in each consumer puts
// that consumer on the underlying atoms' dep graph directly, which DOES
// re-evaluate, so the fix is uniform.
export const resolveLoad = (
	view: PullRequestView,
	cache: Partial<Record<string, PullRequestLoad>>,
	result: AsyncResult.AsyncResult<PullRequestLoad, unknown>,
): PullRequestLoad | null => {
	const cacheKey = viewCacheKey(view)
	const cached = cache[cacheKey] ?? null
	if (cached) return cached
	const resolved = AsyncResult.getOrElse(result, () => null)
	if (resolved && viewCacheKey(resolved.view) === cacheKey) return resolved
	return null
}

// Read the result for the CURRENT view's family member. Equivalent to the
// old `get(pullRequestsAtom)` but routes through the family so each view
// is its own atom.
const getCurrentPullRequestsResult = (get: Atom.AtomContext) => get(pullRequestsForView(get(activeViewAtom)))

export const pullRequestLoadAtom = Atom.make((get) => resolveLoad(get(activeViewAtom), get(queueLoadCacheAtom), getCurrentPullRequestsResult(get))).pipe(Atom.keepAlive)

export const isLoadingQueueModeAtom = Atom.make((get) => {
	// Pure delegate of "is the active view's queue still loading".
	// With family-per-view this is just whether the current view's atom
	// is in a waiting state without a resolved value — the old check
	// for "resolved.view doesn't match activeView" is gone because each
	// family member's resolved.view always matches its own key.
	const result = getCurrentPullRequestsResult(get)
	return result.waiting && AsyncResult.getOrElse(result, () => null) === null
})

export const pullRequestStatusAtom = Atom.make((get): LoadStatus => {
	const result = getCurrentPullRequestsResult(get)
	const load = resolveLoad(get(activeViewAtom), get(queueLoadCacheAtom), result)
	if (result.waiting && load === null) return "loading"
	if (AsyncResult.isFailure(result) && load === null) return "error"
	return "ready"
})

export const selectedRepositoryAtom = Atom.make((get) => viewRepository(get(activeViewAtom)))
export const activeViewsAtom = Atom.make((get) => activePullRequestViews(get(activeViewAtom)))
export const loadedPullRequestCountAtom = Atom.make((get) => resolveLoad(get(activeViewAtom), get(queueLoadCacheAtom), getCurrentPullRequestsResult(get))?.data.length ?? 0)
export const hasMorePullRequestsAtom = Atom.make((get) => {
	const load = resolveLoad(get(activeViewAtom), get(queueLoadCacheAtom), getCurrentPullRequestsResult(get))
	return Boolean(load?.hasNextPage && load.data.length < config.prFetchLimit)
})

// Queue cache key currently being load-more'd, or null if no fetch is in
// flight. Lives in atom-land so command bodies + commands.disabledReason can
// read the loading state without going through the useLoadMore hook return.
export const loadingMoreKeyAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive)

export const isLoadingMorePullRequestsAtom = Atom.make((get) => {
	const key = get(loadingMoreKeyAtom)
	return key !== null && key === viewCacheKey(get(activeViewAtom))
})

// Selection rests on the load-more pseudo-row when the index is one past the
// last visible PR. Surfaces an explicit boolean so the keymap layer can branch
// Enter onto `loadMorePullRequests` instead of `detail.open`, and the renderer
// can highlight the row.
export const loadMoreRowSelectedAtom = Atom.make((get) => {
	const visible = get(visiblePullRequestsAtom)
	const hasMore = get(hasMorePullRequestsAtom)
	return hasMore && visible.length > 0 && get(selectedIndexAtom) === visible.length
})

export const displayedPullRequestsAtom = Atom.make((get) => {
	const view = get(activeViewAtom)
	const load = resolveLoad(view, get(queueLoadCacheAtom), get(pullRequestsForView(view)))
	const overrides = get(pullRequestOverridesAtom)
	const recentlyCompleted = get(recentlyCompletedPullRequestsAtom)
	const scope = viewRepository(view)
	devLog("displayedPullRequestsAtom", {
		view,
		scope,
		loadView: load?.view,
		loadDataLen: load?.data.length ?? 0,
		overridesCount: Object.keys(overrides).length,
		recentlyCompletedCount: Object.keys(recentlyCompleted).length,
	})
	// Defensive scope filter: when a repository is selected, only show PRs
	// for that repo. Without this, stale cache entries or orphans from
	// `recentlyCompletedPullRequestsAtom` (which is a global url→pr map)
	// can leak across views and surface PRs from the previous repository
	// under the new breadcrumb.
	const inScope = (pullRequest: PullRequestItem) => scope === null || pullRequest.repository === scope
	const source = (load?.data ?? []).filter(inScope)
	const seenUrls = new Set<string>()
	const open = source.map((pullRequest) => {
		seenUrls.add(pullRequest.url)
		return recentlyCompleted[pullRequest.url] ?? overrides[pullRequest.url] ?? pullRequest
	})
	const orphans = Object.values(recentlyCompleted).filter((pullRequest) => inScope(pullRequest) && !seenUrls.has(pullRequest.url))
	// Sort by updatedAt DESC. Server already sorts this way, but pagination
	// drift and merged orphans can scramble the order — guarantee it here.
	return [...open, ...orphans].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
})

export const filteredPullRequestsAtom = Atom.make((get) => {
	// Scope filtering ("only mine") is enforced server-side via the view's
	// search qualifier; no client-side author filter is needed here.
	const pullRequests = get(displayedPullRequestsAtom)
	const query = get(effectiveFilterQueryAtom)
	if (query.length === 0) return pullRequests
	return pullRequests
		.flatMap((pullRequest) => {
			const score = pullRequestFilterScore(pullRequest, query)
			return score === null ? [] : [{ pullRequest, score }]
		})
		.sort((left, right) => left.score - right.score || right.pullRequest.updatedAt.getTime() - left.pullRequest.updatedAt.getTime())
		.map(({ pullRequest }) => pullRequest)
})

export const visibleRepoOrderAtom = Atom.make((get) => {
	const pullRequests = get(filteredPullRequestsAtom)
	const query = get(effectiveFilterQueryAtom)
	// While the user is filtering, the ranked filter score drives the order so
	// the best-matching repo stays at the top. Without a query, sort projects
	// by their newest-opened PR so freshly-active repos surface first.
	if (query.length > 0) return [...new Set(pullRequests.map((pullRequest) => pullRequest.repository))]
	const newestByRepository = new Map<string, number>()
	for (const pullRequest of pullRequests) {
		const created = pullRequest.createdAt.getTime()
		const previous = newestByRepository.get(pullRequest.repository)
		if (previous === undefined || created > previous) newestByRepository.set(pullRequest.repository, created)
	}
	return [...newestByRepository.entries()]
		.sort(([leftRepo, leftCreated], [rightRepo, rightCreated]) => rightCreated - leftCreated || leftRepo.localeCompare(rightRepo))
		.map(([repo]) => repo)
})

export const visibleGroupsAtom = Atom.make((get) => groupBy(get(filteredPullRequestsAtom), (pullRequest) => pullRequest.repository, get(visibleRepoOrderAtom)))

export const visiblePullRequestsAtom = Atom.make((get) => get(visibleGroupsAtom).flatMap(([, pullRequests]) => pullRequests))

export const groupStartsAtom = Atom.make((get) => {
	const groups = get(visibleGroupsAtom)
	const starts: number[] = []
	for (let index = 0; index < groups.length; index++) {
		if (index === 0) starts.push(0)
		else starts.push(starts[index - 1]! + groups[index - 1]![1].length)
	}
	return starts
})

export const selectedPullRequestAtom = Atom.make((get) => {
	const pullRequests = get(visiblePullRequestsAtom)
	const index = get(selectedIndexAtom)
	return pullRequests[index] ?? null
})
