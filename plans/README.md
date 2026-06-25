# Plans

One markdown file per multi-commit feature or larger redesign. The aim is to capture *intent + design + open questions* before the work starts so the implementer (Kit, an agent, or a contributor) can pick it up cold.

## Format

Each plan should cover:

- **Why** — the user-facing problem or feature gap it addresses.
- **What we'd ship** — bullet-level description of the user-visible end state.
- **API / architecture mapping** — concrete endpoints, services, atoms, types.
- **Open questions** — design choices that aren't decided yet.
- **Out of scope (for v1)** — what we're explicitly *not* doing first time round.
- **Status** — `Not started` / `In progress` / `Shipped — see <commit/PR>`.

When a plan ships, leave the file in place and update the **Status** line so we can read the history.

## Index

- [`queued-reviews.md`](./queued-reviews.md) — pending diff-comment reviews and the submit/discard flow.
- [`edit-delete-comments.md`](./edit-delete-comments.md) — edit your own comments in place, delete with confirm.
- [`sqlite-cache.md`](./sqlite-cache.md) — persistent SQLite cache for queues, hydrated details, comments, and optional diffs.
- [`cache-v2.md`](./cache-v2.md) — audit-driven follow-up: diff cache, per-repo metadata persistence, `--cache-info` / `--cache-clear`.
- [`cache-v3.md`](./cache-v3.md) — issue queue cache, repo rollup query, repository-details prewarm.
- [`comments-pane-redesign.md`](./comments-pane-redesign.md) — living design doc exploring how the Comments pane should render. Multiple styles, fully specced, iterate freely.
- [`repo-workspace-home.md`](./repo-workspace-home.md) — repository-oriented shell with Pull Requests and Issues as first project surfaces.
- [`workspace-hub-and-filters.md`](./workspace-hub-and-filters.md) — escape hatch from repo scope, global/repo filters, and hub navigation mockups.
- [`surface-aware-loading.md`](./surface-aware-loading.md) — active-surface loading, progressive hydration, and local API telemetry.
- [`diff-rendering-performance.md`](./diff-rendering-performance.md) — semantic diff rows, viewport-windowed rendering, and syntax-plus-word-diff highlighting.
- [`app-tsx-decomposition.md`](./app-tsx-decomposition.md) — carve the 3,000-LOC App.tsx into a thin shell + per-surface modules + capability modules + a data-driven command registry.
- [`app-shell-deepening.md`](./app-shell-deepening.md) — follow-up: shrink the 1,400-LOC `useAppShell` God-hook into App-shell infrastructure + per-Surface shells, with commands reading atoms via registry.
- [`item-load-deepening.md`](./item-load-deepening.md) — consolidate the shared PR/Issue load, pagination, cache, and displayed-selection engine.
