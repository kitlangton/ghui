# Cache v3: issues, repo rollup, and detail prewarm

## Why

After v1 (PR queue + hydrated PRs + repository details on selection) and the v2 follow-ups outlined in `cache-v2.md` (diff cache, repo metadata), three cache gaps still leave the app feeling cold on launch:

1. **Issues queue isn't cached at all.** `issuesAtom` calls `github.listIssuePage` directly. The Issues tab spins on every launch, even though the `queue_snapshots` schema already reserves `view_key LIKE 'issue:%'` per migration `003_unified_queue_view_key`.
2. **The Repos tab can't paint counts or activity dates from cache.** `allRepositoryItems` (`src/App.tsx:564`) is *derived* from currently-loaded PRs + issues. Until those queries return, the Repos tab shows only `owner/name` + favorite/recent status — no last-activity dot, no item counts. Repos that never appeared in a queue this session don't appear at all unless favorited/recent.
3. **`repository_details` is on-demand only.** `useRepositoryDetails` fetches on selection. Even with a cache hit, the user has to *visit* a repo once to populate it, so the first selection of every repo each session pays the network round-trip.

This plan caches the issue queue end-to-end, derives a viewer-scoped repo rollup from the cached PR + issue tables (so the Repos tab paints with counts on launch), and warms `repository_details` for the user's own set in the background.

## What we'd ship

1. **Issues queue cache.** New `issues` table mirroring `pull_requests`. Reuses `queue_snapshots` with `view_key` prefixed `issue:`. `issuesAtom` reads cache first → updates a load atom → fetches network → writes cache. Issues tab paints stale-but-instant on launch, same as PRs do today.
2. **Repo rollup query.** `CacheService.readRepoRollup(viewer)` aggregates `pull_requests` + `issues` by repository (count + max(updated_at)) scoped to the viewer's queue snapshots. A new `repoRollupAtom` hydrates the in-memory derivation that powers the Repos tab. Repo list renders activity dates + counts before the live PR/issue queries return.
3. **Repository-details prewarm.** On boot, after workspace prefs land, fire-and-forget `getRepositoryDetails` for the union of favorites + recents + detected, with concurrency ≤ 4 and a TTL skip (don't refetch if cached `updated_at` is < 6 hours old). Errors are swallowed. Detail-pane selection of any of those repos becomes instant.
4. **Pruning extended to issues.** `pruneSql` learns about `issues` + `view_key LIKE 'issue:%'`. Same 30-day cutoff as PRs.

## API / architecture mapping

### Schema additions

```sql
-- Migration 005_issues_table
CREATE TABLE IF NOT EXISTS issues (
  issue_key TEXT PRIMARY KEY,
  repository TEXT NOT NULL,
  number INTEGER NOT NULL,
  url TEXT NOT NULL,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS issues_repository_number_idx ON issues (repository, number);
```

`queue_snapshots` is unchanged — its `pr_keys_json` column holds whatever subject keys the view kind references; the `view_key` prefix discriminates (`pullRequest:` vs `issue:`).

`issue_key` shape: `${repository}#${number}`, identical to `pr_key`. Different table prevents key collisions and keeps schemas independent.

### Domain additions

New module `src/issueLoad.ts`:

```ts
export interface IssueLoad {
  readonly view: IssueView
  readonly data: readonly IssueItem[]
  readonly fetchedAt: Date | null
  readonly endCursor: string | null
  readonly hasNextPage: boolean
}
```

Add to `src/ui/issues/atoms.ts`:

```ts
export const issueViewCacheKey = (view: IssueView) =>
  itemQueryCacheKey("issue", issueViewToQuery(view))
```

This produces stable keys like `issue:authored:_`, `issue:assigned:_`, `issue:all:owner/name` — already covered by the migration 003 `LIKE 'issue:%'` filter.

### `CacheService` additions

```ts
readonly readIssueQueue: (viewer: string, view: IssueView) =>
  Effect.Effect<IssueLoad | null, CacheError>
readonly writeIssueQueue: (viewer: string, load: IssueLoad) =>
  Effect.Effect<void>
readonly readIssue: (key: IssueCacheKey) =>
  Effect.Effect<IssueItem | null, CacheError>
readonly upsertIssue: (issue: IssueItem) =>
  Effect.Effect<void>
readonly readRepoRollup: (viewer: string) =>
  Effect.Effect<readonly RepoRollupRow[], CacheError>
```

`RepoRollupRow`:

```ts
export interface RepoRollupRow {
  readonly repository: string
  readonly pullRequestCount: number
  readonly issueCount: number
  readonly lastActivityAt: Date | null
}
```

Aggregation SQL (one statement per kind, merged in code):

```sql
SELECT pr.repository AS repository,
       COUNT(*) AS count,
       MAX(pr.updated_at) AS last_activity_at
FROM pull_requests pr
WHERE pr.pr_key IN (
  SELECT json_each.value
  FROM queue_snapshots, json_each(queue_snapshots.pr_keys_json)
  WHERE viewer = ? AND view_key LIKE 'pullRequest:%'
)
GROUP BY pr.repository
```

Same for issues with `view_key LIKE 'issue:%'`. Viewer scoping via the IN-subquery avoids double-counting in the (theoretical) multi-viewer case.

`pruneSql` extended:

```ts
yield* sql`DELETE FROM issues
  WHERE updated_at < ${cutoff}
  AND issue_key NOT IN (
    SELECT json_each.value
    FROM queue_snapshots, json_each(queue_snapshots.pr_keys_json)
    WHERE view_key LIKE 'issue:%'
  )`
```

### `issuesAtom` rewrite

Mirror `pullRequestsAtom` exactly:

```ts
export const issueQueueLoadCacheAtom =
  Atom.make<Partial<Record<string, IssueLoad>>>({}).pipe(Atom.keepAlive)

export const issuesAtom = githubRuntime.atom(Effect.fnUntraced(function* (get) {
  const github = yield* GitHubService
  const cache = yield* CacheService
  const view = get(activeIssueViewAtom)
  const cacheKey = issueViewCacheKey(view)
  const mode = issueViewMode(view)
  const repository = issueViewRepository(view)
  if (mode === "all" && !repository) return EMPTY_ISSUE_LOAD(view)

  const cacheUsername = view._tag === "Repository"
    ? null
    : yield* github.getAuthenticatedUser().pipe(Effect.catch(() => Effect.succeed(null)))
  const cacheViewer = cacheUsername ?? (view._tag === "Repository" ? "anonymous" : null)

  if (cacheViewer) {
    const cached = yield* cache.readIssueQueue(cacheViewer, view).pipe(
      Effect.catch(() => Effect.succeed(null))
    )
    if (cached) {
      yield* Atom.update(issueQueueLoadCacheAtom, (c) =>
        c[cacheKey] ? c : { ...c, [cacheKey]: cached })
    }
  }

  const page = yield* github.listIssuePage(
    issueQueryToListInput(issueViewToQuery(view), null, pullRequestPageSize))

  const load: IssueLoad = {
    view,
    data: page.items,
    fetchedAt: new Date(),
    endCursor: page.endCursor,
    hasNextPage: page.hasNextPage,
  }
  yield* Atom.update(issueQueueLoadCacheAtom, (c) => ({ ...c, [cacheKey]: load }))
  if (cacheViewer) yield* cache.writeIssueQueue(cacheViewer, load)
  return load
})).pipe(Atom.keepAlive)

export const issueLoadAtom = Atom.make((get) => {
  const view = get(activeIssueViewAtom)
  const cacheKey = issueViewCacheKey(view)
  const cache = get(issueQueueLoadCacheAtom)
  const result = get(issuesAtom)
  const resolved = AsyncResult.getOrElse(result, () => null)
  return cache[cacheKey] ?? (resolved && issueViewCacheKey(resolved.view) === cacheKey ? resolved : null)
})
```

`App.tsx` switches from `issuesResult.value` to `issueLoadAtom?.data ?? []` for `rawIssues`, while keeping `issuesResult` for the loading/error indicator (or moving that to a derived `issuesStatusAtom`).

### Repo rollup wiring

```ts
// src/ui/pullRequests/atoms.ts (or new src/ui/repos/atoms.ts)
export const repoRollupAtom = githubRuntime.atom(Effect.fn(function* () {
  const cache = yield* CacheService
  const username = yield* GitHubService.use(g => g.getAuthenticatedUser())
    .pipe(Effect.catch(() => Effect.succeed(null)))
  const viewer = username ?? "anonymous"
  return yield* cache.readRepoRollup(viewer).pipe(Effect.catch(() => Effect.succeed([])))
})).pipe(Atom.keepAlive)
```

In `App.tsx:564`, seed `byRepository` from the rollup *before* iterating `pullRequests` + `allIssues`. The live data takes precedence (it's the same `touch` function), so by the time the live queries land, the rollup is overwritten in place. Net effect: instant initial render with cached counts/dates, then live data without a flicker (counts can only go up or stay equal across the same view).

### Repository-details prewarm

```ts
// src/ui/pullRequests/atoms.ts
export const prewarmRepositoryDetailsAtom = githubRuntime.fn<readonly string[]>()(
  (repositories) => Effect.forEach(repositories, (repository) =>
    Effect.gen(function* () {
      const cache = yield* CacheService
      const cached = yield* cache.readRepositoryDetails(repository).pipe(
        Effect.catch(() => Effect.succeed(null)))
      if (cached && Date.now() - cached.fetchedAt.getTime() < 6 * 60 * 60 * 1000) return
      const fresh = yield* GitHubService.use(g => g.getRepositoryDetails(repository))
      yield* cache.writeRepositoryDetails(fresh)
    }).pipe(Effect.catch(() => Effect.void)),
    { concurrency: 4, discard: true })
)
```

(Note: `RepositoryDetails` does not currently carry `fetchedAt`. Either add it via a new column-derived field, or read `updated_at` from the table separately. Lean: read the row's `updated_at` in `readRepositoryDetails` and surface it as `fetchedAt`.)

Triggered from a top-level `useEffect` in `App.tsx`, gated on `username !== null` and prefs-loaded:

```ts
useEffect(() => {
  if (!username) return
  const repos = Array.from(new Set([
    ...recentRepositories,
    ...Object.keys(favoriteRepositories),
    ...(detectedRepository ? [detectedRepository] : []),
  ]))
  if (repos.length === 0) return
  void prewarm(repos).catch(() => {})
}, [username, recentRepositories, favoriteRepositories])
```

### Migrations

- `005_issues_table` — `CREATE TABLE issues` + index.

No data migration needed — the `queue_snapshots` table is reused as-is.

## Open questions

1. **Field name `pr_keys_json`.** Reusing the column for issue keys is technically muddy. Renaming to `subject_keys_json` would require a destructive migration to rename + re-encode. Lean: leave the column name; the `view_key` prefix is the discriminator. Document the choice with a comment in the schema migration.
2. **`RepositoryDetails.fetchedAt`.** Does it belong on the domain type, or only on the cache layer? Lean: cache-only — return `{ details, fetchedAt }` from `readRepositoryDetails` to keep `RepositoryDetails` a clean GitHub-shape.
3. **Prewarm TTL.** 6 hours is a guess. Repo descriptions/star counts move slowly. Could be 24h. Lean: 6h for v1; revisit after a week of dogfood.
4. **Aggregating across viewers.** The viewer-scoped `IN` subquery is correct but adds JSON walking on every Repos tab paint. For a single-user app, an unscoped aggregation is faster. Lean: viewer-scoped for correctness; fall back to a single GROUP BY if profiling shows it matters.
5. **Mode `all` without a repository for issues.** Returns an `EMPTY_ISSUE_LOAD` today; the cache code should not write or read for this case (no viewable data).
6. **Cache invalidation when an issue is closed.** Close path needs to either upsert with new state (`IssueItem` lacks a `state` field today; out of scope) or evict the row. Lean: evict on close mutation, which already updates `issueOverridesAtom` for the live view.

## Out of scope (for v3)

- Adding `state` to `IssueItem` so closed issues can be cached with status (separate refactor).
- Issue comments cache (mirrors deferred PR comments cache from `cache-v2.md`).
- Persisting label / merge-method caches (already tracked in `cache-v2.md`).
- A unified `subjects` table replacing `pull_requests` + `issues` (architectural; pure code-cleanup).
- Showing description / stars / open counts in the Repos list rows (UI change, separate plan).

## Status

Shipped — issue queue caching, repo rollup hydration, repository-details prewarm, and issue pruning are present in the current implementation.
