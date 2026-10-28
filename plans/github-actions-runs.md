# PR Runs view — implementation plan

Pairs with [`pr-runs-view-mockups.md`](./pr-runs-view-mockups.md). Build the
"see a PR's workflow runs in detail" feature as a **per-PR view mode**, a peer of
the diff view. Not a tab, not a modal.

## Why

ghui shows a PR's check rollup but offers no way to investigate *why* checks are
red, or to watch a run's jobs/steps. Users (gh-dash refugees) want to view / run /
investigate Actions. The smallest high-value slice: open the selected PR's runs,
drill into jobs → steps, and read failing step logs — without leaving the terminal.

## What we ship (slice 1: read-only investigate)

- Press `a` ("actions") on a PR (list or detail) → full-screen **runs view** scoped
  to that PR's head SHA. `esc` walks back out.
- **Runs list (view A):** the PR's runs (one per workflow on the head commit + any
  re-runs): status · workflow · conclusion · duration · age.
- **Run detail (view B):** `enter` on a run → jobs and steps; failed steps expand a
  log tail inline; `enter` on a step opens its full (scrollable) log; `n`/`p` jump
  between failures.
- Loading / error / empty states matching the rest of ghui.
- Works in mock mode via `MockGitHubService` run fixtures.

Out of slice 1 (follow-ups): `↻` re-run / re-run-failed, `x` cancel, the repo-wide
Actions surface, `workflow_dispatch`.

## Architecture — peer of the diff view

| Diff view                              | Runs view (new)                          |
| -------------------------------------- | ---------------------------------------- |
| `diffFullViewAtom`                     | `runsFullViewAtom` (`useViewModeState`)  |
| `diff.open` / `diff.close` (`d`/`esc`) | `runs.open` / `runs.close` (`a`/`esc`)   |
| `diffView` keymap context              | `runsView` keymap context                |
| `if (diffFullView)` pane branch        | `if (runsFullView)` pane branch          |
| `PullRequestDiffPane`                  | `PullRequestRunsPane` (list + detail)    |

State is PR-scoped (keyed by `repository#number@headSha`), nothing repo-global.

### Domain types (`src/domain.ts`)

```ts
RunStatus     = "queued" | "in_progress" | "completed"
RunConclusion = "success" | "failure" | "cancelled" | "skipped" | "neutral"
              | "timed_out" | "action_required" | "stale" | null
RunStep  { number; name; status: RunStatus; conclusion: RunConclusion;
           startedAt: Date | null; completedAt: Date | null }
RunJob   { id: number; name; status; conclusion; startedAt; completedAt; url;
           steps: readonly RunStep[] }
WorkflowRun { id; number; attempt; workflowName; displayTitle; event;
              headBranch; headSha; status; conclusion; url;
              createdAt; startedAt; updatedAt }
WorkflowRunDetails extends WorkflowRun { jobs: readonly RunJob[] }
```

### GitHubService (`src/services/GitHubService.ts`)

All `gh`-backed (CLI, not GraphQL), mirroring existing `ghJson` usage:

- `listPullRequestRuns(repository, headSha)` →
  `gh run list --repo <r> --commit <sha> --limit N --json databaseId,number,attempt,workflowName,displayTitle,event,headBranch,headSha,status,conclusion,url,createdAt,startedAt,updatedAt`
- `getRunDetails(repository, runId)` →
  `gh run view <id> --repo <r> --json …,jobs` (jobs carry steps).
- `getRunStepLog(repository, runId, { failedOnly })` →
  `gh run view <id> --repo <r> --log` / `--log-failed` (plain text, not JSON).

Schemas in `githubSchemas.ts` (`RawWorkflowRunSchema`, `RawRunJobSchema`,
`RawRunStepSchema`), normalizers in `githubNormalize.ts` (`parseWorkflowRun`,
`parseRunDetails`) converting ISO strings → Date and CLI enums → our literals.
`MockGitHubService` returns deterministic fixtures (mixed pass/fail/in-progress).

### Atoms (`src/ui/runs/atoms.ts`)

- `runsFullViewAtom = Atom.make(false)`
- `selectedRunIdAtom = Atom.make<number | null>(null)` (which run is focused → B)
- `runsSelectionAtom`, `runDetailSelectionAtom` (list cursors, like comments)
- `expandedStepKeyAtom` (which step's full log is open)
- `pullRequestRunsKeyAtom` — derived `repository#number@headSha` from
  `selectedPullRequestAtom`
- `Atom.family` over the key for `listPullRequestRuns`, plus a family over runId for
  `getRunDetails` / `getRunStepLog`, each `Atom.setIdleTTL(0)` like the diff atoms.

### Commands (`src/commands/builtins.ts`)

- `runs.open` (scope "Runs", shortcut `a`, `disabledReason` = no PR / no runs) —
  sets `runsFullViewAtom = true`. Atom-pure, no handoff needed.
- `runs.close` (scope "Runs", shortcut `esc`) — `runsFullViewAtom = false`, clears
  `selectedRunIdAtom` / expanded step.
- `runs.refresh` (`r`) — refresh the runs family atom.
- Navigation lives in the keymap ctx, dispatched by id.

### Keymap (`src/keymap/runsView.ts` + `contexts/runsViewCtx.ts`)

`runsView` context with: escape (close, or back from B to A), move selection,
open run (A→B), back, open/expand step log, next/prev failure, refresh, open in
browser. Register in `keymap/all.ts`; gate by `runsFullView`.

### Surface wiring

- `useViewModeState`: add `runsFullView` / `setRunsFullView`.
- `PullRequestSurface`: a `if (runsFullView)` branch rendering `PullRequestRunsPane`,
  placed beside the `diffFullView` branch. `App-shell` already hides tabs when a PR
  view mode is fullscreen — confirm `isFullscreen` includes runs.
- `keymap/listNav.ts` + `detailView`: add `a` → `runs.open` (PR only).
- Footer hints (`FooterHints.tsx`) + `derivations.ts` disabled reasons.

## Open questions

- Single-run shortcut: if a PR has exactly one run, should `a` jump straight to B?
  (Lean yes; keep A reachable via `esc`/back.)
- Log volume: `--log` can be large. Slice 1 expands only failed steps' tails and
  lazily fetches a step's full log on demand; cap rendered lines + scroll.
- Live runs: no polling in slice 1; `r` refreshes. Auto-refresh is a follow-up.

## Status

Shipped (slice 1) — `a` opens a PR's runs list → run detail (jobs/steps) with
failure navigation (`n`/`p`), inline step expansion, `o` open-in-browser, and `r`
refresh. Built as a PR view mode peer of the diff view (`runsFullViewAtom`,
`runsView` keymap, `PullRequestRunsPane`), `gh`-backed via
`listWorkflowRunsForCommit` / `getWorkflowRunDetails` / `getWorkflowRunLog`, with
mock fixtures. With `runLogView: "inline"` in config.json, `enter` on a job/step
opens its log inline (`getWorkflowJobLog` → `gh run view --job <id> --log`,
filtered per step by time window, scrollable); the default still opens GitHub. Follow-ups: `↻`
re-run / `x` cancel, live auto-refresh, and an optional repo-wide Actions surface
reusing this run-detail rendering.
