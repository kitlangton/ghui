# Item Load deepening

## Why

Pull Request and Issue queues share the same Load shape and most cache-first pagination invariants, but historically implemented them in parallel. That duplicated cursor-progress, deduplication, matching-View resolution, and bounded repository-cache behavior, making fixes easy to land for only one Item kind.

## What we'd ship

- One shared Item Load model and pure pagination/cache invariants under `src/item/`.
- Thin Pull Request and Issue adapters that retain only kind-specific behavior, especially PR detail preservation.
- One canonical displayed list and selection per Item Surface.
- Eventually, one configurable Queue engine for cache-first fetch, persistence, refresh, and pagination.

## API / architecture mapping

- `src/item/load.ts` owns the generic `ItemLoad<View, Item>` model, fresh-load construction, page append/progress, matching-View resolution, and repository-cache trimming.
- `src/item/queue.ts` owns the cache-first first-page Queue protocol: viewer resolution, tolerant cache reads, atomic publication, retention ordering, fetch, and persistence.
- `src/pullRequestLoad.ts` and `src/issueLoad.ts` remain compatibility aliases during migration.
- `src/pullRequestCache.ts` retains PR detail-preserving merge behavior.
- `src/issueCache.ts` remains the Issue adapter.
- `src/ui/pullRequests/atoms.ts` and `src/ui/issues/atoms.ts` adapt their kind-specific query, merge, persistence, and retry behavior into the shared Queue loader.

## Open questions

- Can the current permanently retained per-View atom maps be replaced without reintroducing the stale dependency behavior they avoid?
- Can the duplicated PR/Issue load-more hooks become one Queue pagination state machine without leaking React concerns into the Item Module?

## Out of scope

- PR-only detail hydration and refresh behavior.
- Diff, review, and comment caches.
- Changing persisted SQLite schemas.

## Status

In progress. Shared Load invariants and the cache-first first-page Queue protocol landed 2026-06-04. Per-kind runtime atom families and load-more hooks remain separate.
