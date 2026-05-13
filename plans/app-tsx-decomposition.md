# App.tsx decomposition

## Why

`src/App.tsx` has grown to ~3,007 LOC, 80 `useAtom*` calls, and 34 derivation hooks (`useEffect`/`useMemo`/`useCallback`). It owns at least ten orthogonal concerns: layout math, surface switching, selection, scroll state, focus-return refresh, filter scoring, the diff-comment system, command dispatch (via a ~47-parameter `buildAppCommands` closure bag), modal stack, and hydration. Any change to one surface forces a reader to scan the whole file to confirm focus, scroll, command wiring, or modal state in another surface isn't broken.

The interface ("everything the app does") is nearly as large as the implementation — the canonical shallow module. Because it's the entry point, deletion isn't an option; the fix is to push behaviour into deeper modules that App.tsx assembles.

## What we'd ship

End state: `App.tsx` is ≤300 LOC and reads as a manifest — header, tabs, the active surface, footer, modals. Each surface (`PullRequestSurface`, `IssueSurface`, `RepoSurface`) is a thin assembly that owns its own selection/scroll/keymap context and is mountable in isolation. Cross-cutting capabilities (layout math, command registry, focus-return, modal stack) live in named modules with their own tests. The `buildAppCommands` closure bag is gone; commands are data, dispatched against atoms at run time.

No user-visible change. Validation is structural: LOC, file count, and the ability to render a surface in a standalone test.

## Architecture mapping

Target tree:

```
src/
  App.tsx                          # ≤300 LOC: layout shell + surface switch + global keymap + boot
  workspace/
    layout.ts                      # pure: pane widths, body heights, junction math
    atoms.ts                       # workspaceSurfaceAtom (exists), tab state
  surfaces/
    PullRequestSurface.tsx         # list ⨯ details ⨯ diff ⨯ comments ⨯ PR sub-modes
    IssueSurface.tsx               # list ⨯ details ⨯ comments
    RepoSurface.tsx                # absorbs current RepoWorkspace + repo wiring from App.tsx
    WorkspaceModals.tsx            # exists; may sprout per-modal hook neighbours
  commands/
    registry.ts                    # `Command = { id, label, keywords, when?, run(ctx) }`
    dispatch.ts                    # `dispatch(id)` reads atoms inside `run`
    builtins.ts                    # the catalog (replaces appCommands.ts)
  keymap/
    …                              # per-mode tables dispatching `commands.run(id)`
  pullRequests/surface/
    atoms.ts                       # PR-surface selection, modes, anchors, ranges
    derivations.ts                 # filtered/grouped/visible
    keymap.ts                      # PR keymap context
  issues/surface/                  # symmetric
  repos/surface/                   # symmetric
  hooks/
    useFocusReturnRefresh.ts       # extract auto-refresh + idle refresh
    useScrollPersistence.ts        # exists
    useScrollFollowSelected.ts     # exists
```

Cleavage principles:

- **Capability modules are deep**: small interface, behaviour behind it. Every surface uses them; no surface owns them.
- **Surfaces are thin assemblies**: each one declares its own selection/scroll/keymap atoms and reads capability modules. A surface = a region of UI with its own selection.
- **PR sub-modes (`commentsViewActive`, `diffFullView`, `detailFullView`) live inside `PullRequestSurface`**, not as peer surfaces.
- **App.tsx is the shell**: layout, surface switching, global keymap binding, hydration kick-off.

## Phases

Each phase is a contained PR (or PR series). All tests pass at every phase boundary. No behaviour change.

### Phase 0 — Audit and atom migration (preparation)

Goal: move local component state in App.tsx into atoms where it doesn't already live, so phase 2 doesn't have to choreograph state ownership transfers alongside the surface extraction.

- [ ] Inventory every `useState` / `useRef` in App.tsx; classify each as: belongs-to-surface, belongs-to-capability, or genuinely-app-shell.
- [ ] Move surface-state items into atoms under their target surface folder (PR / issue / repo), keeping App.tsx as the only reader/writer for now.
- [ ] Pure helpers in App.tsx (`repositoryFilterScore`, `issueFilterScore`, `filterByScore`, `groupDiffCommentThreads`, `diffCommentRangeSelection`, …) → move to `src/filter/`, `src/pullRequests/diffComments/`, etc. and import back.

Exit criteria: App.tsx is roughly the same LOC but with no module-private state surviving outside it. Helpers can be unit-tested directly.

### Phase 1 — Command registry (unblocks phase 2)

Goal: kill `buildAppCommands`'s 47-parameter closure bag. Commands become data; the keymap dispatches `dispatch(id)`; surfaces no longer need to push action closures upward.

- [ ] Define `Command = { id, label, keywords, when?, run(ctx) }` in `commands/registry.ts`.
- [ ] `dispatch.ts` exports `dispatch(id)` and the `ctx` it threads (an atom getter/setter, plus a runtime for Effect calls).
- [ ] Migrate the ~100 entries from `appCommands.ts` into `commands/builtins.ts`, one cluster at a time. Each command's body reads atoms inside `run(ctx)` instead of relying on closure inputs.
- [ ] `CommandPalette` reads the registry directly; the keymap binds keys to command IDs.
- [ ] Delete `buildAppCommands`, `appCommands.ts`, and the related `actions` object plumbed through App.tsx.

Exit criteria: adding a new command touches one file (`commands/builtins.ts`). `test/appCommands.test.ts` becomes a registry test.

### Phase 2 — Extract `PullRequestSurface` (biggest)

Goal: pull the PR list, details, diff, comments, and three sub-mode flags into a single surface module owning its keymap context.

- [ ] Create `src/surfaces/PullRequestSurface.tsx`.
- [ ] Migrate PR-specific selection, scroll, mode atoms, diff-comment anchor/range state into `pullRequests/surface/atoms.ts`.
- [ ] Migrate filtering/grouping derivations (already mostly in `ui/pullRequests/atoms.ts`) into `pullRequests/surface/derivations.ts`.
- [ ] Surface owns its own keymap context; App.tsx mounts the surface and routes the active-context based on `workspaceSurfaceAtom`.
- [ ] Snapshot test: mount `PullRequestSurface` standalone with mock atoms, simulate `j`, assert selection moved.

Exit criteria: App.tsx LOC drops by ~30–40%. PR surface is testable without instantiating the whole app.

### Phase 3 — Extract `IssueSurface` and `RepoSurface`

Goal: apply the phase-2 pattern. Both are smaller; `RepoWorkspace.tsx` is already 80% of the way there.

- [ ] `src/surfaces/IssueSurface.tsx`: list + details + comments. Mirror PR structure.
- [ ] Rename `RepoWorkspace.tsx` → `RepoSurface.tsx`; absorb repo-selection/repo-details wiring from App.tsx.
- [ ] Snapshot tests for both surfaces.

Exit criteria: App.tsx LOC drops below 1,000.

### Phase 4 — Capability modules

Goal: name and test the cross-cutting concerns that remain.

- [ ] `workspace/layout.ts`: pure functions for `paneWidths`, `bodyHeights`, `isWideLayout`. Tests cover the breakpoint and junction math.
- [ ] `hooks/useFocusReturnRefresh.ts`: extracts auto-refresh on window focus + idle refresh + jitter (concern #5). Fake-clock test.
- [ ] `hooks/useModalStack.ts` (or atom-based equivalent): centralizes modal open/close so each modal stops reinventing it.
- [ ] Filter scoring already moved in phase 0; ensure it's a real module with tests now.

Exit criteria: each capability is one file ≤200 LOC with a focused test file.

### Phase 5 — Cleanup pass

- [ ] Anything still in App.tsx is layout shell, surface switching, global keymap binding, or boot hydration.
- [ ] App.tsx ≤300 LOC.
- [ ] Update `AGENTS.md` "UI Conventions" if any of the patterns established here deserve to be canonical.

## Open questions

- **Mode discriminated atom for PR**: should `commentsViewActive` / `diffFullView` / `detailFullView` collapse into a single `pullRequestMode` discriminated atom (`"list" | "details" | "diff" | "comments"`)? They're mutually exclusive in practice; the three booleans don't reflect that.
- **Per-modal hooks**: most modals already have `useFilterModal`/`useThemeModal`-style hooks. Should `useMergeModal`, `useLabelModal`, etc. be made consistent, or is the inconsistency a hint that a unified `useModalStack` is the right abstraction?
- **`useDetailHydration` shape**: currently PR-specific. Generalize to `useItemHydration<T>` for issues too, or keep them separate?
- **Imperative scroll refs**: OpenTUI gives `ScrollBoxRenderable | null` via ref. Scroll *position* can live in atoms; refs stay hook-local. Confirm this split is robust before phase 4.
- **Keymap consolidation**: opportunity #4 from the architecture survey (collapse per-modal context types into a mode-keyed table) overlaps with phase 1. Do it as part of phase 1 or defer to its own phase?

## Out of scope (for v1)

- Changing how Effect atoms work (no migration off `@effect/atom-react`).
- Restyling or relayouting any surface.
- Splitting the PR detail / diff / comments view further than today's structure.
- Changing the `GitHubService` interface or carving it into per-slice services (separate plan).
- Domain-module deepening (`domain.ts` → predicates) — separate plan.

## Status

In progress — plan written 2026-05-12.

- Phase 0a/b/c shipped 2026-05-12:
  - 0a: derived atoms `selectedRepositoryAtom`, `activeViewsAtom`, `loadedPullRequestCountAtom`, `hasMorePullRequestsAtom`, `diffReadyAtom`. App.tsx wires through `useAtomValue` (602b883, 22a8884).
  - 0b: `loadingMoreKeyAtom` + derived `isLoadingMorePullRequestsAtom`; `useLoadMore` now reads/writes through atoms instead of `useState` (523c4df).
  - 0c: filter scoring → `src/ui/filter/scoring.ts`; diff-comment thread/range helpers → `src/ui/diff/comments.ts`. App.tsx drops ~90 LOC of inline helpers (56be4ef).
- Phase 1 step 1 shipped 2026-05-12 (a18f1a4): new registry infrastructure under `src/commands/` (`registry.ts`, `dispatch.ts`, `atoms.ts`, `derivations.ts`, `builtins.ts`, `index.ts`). Three commands ported: `command.open`, `filter.open`, `filter.clear`. App.tsx concatenates registered + legacy commands so the palette / keymap / runCommandById path is unchanged through migration.
- Phase 1 step 2 shipped 2026-05-12 (2fb320c): workspace switches (3) + detail/diff close (3) + browser/clipboard (3) — 9 commands. Lifted `workspaceTabSurfacesAtom`, `selectedIssueAtom`, plus ~10 derivation atoms for disabled-reason chains.
- Phase 1 step 3 shipped 2026-05-12 (b103e83): `repository.open`, `pull.close`, `issue.close` — 3 commands. Pattern: read selection via atom, write modal state via `Atom.set(activeModalAtom, Modal.X({...}))`.
- Phase 1 step 4 shipped 2026-05-12 (259b2ed): `pull.toggle-draft`, `pull.submit-review`, `comments.new`, `pull.labels` — 4 commands. `pull.labels` calls `GitHubService.use(listRepoLabels)` and atom-updates the modal in-place when the response lands.
- Phase 1 step 5 shipped 2026-05-12 (c486716): diff render-mode toggles (3) via the diff-location-preservation handoff.
- Phase 1 step 6 shipped 2026-05-12 (a2f8b0e): `app.quit` via lifecycle handoff.
- Phase 1 step 7 shipped 2026-05-12 (1edd6b1): pull.refresh, pull.load-more, pull.merge, theme.open, comments.open, diff.open via consolidated handoffs.
- Phase 1 final shipped 2026-05-12: remaining 17 commands (diff cluster, comment mutations, view.*) plus the per-render commandRuntimeAtom snapshot for derivations that depend on layout-bound state. `appCommands.ts` and the legacy test deleted. App.tsx no longer constructs a closure-bag.

**Phase 1 done.** All commands flow through the new registry. Next: Phase 2 (PullRequestSurface extraction).

- Phase 2 shipped 2026-05-12 (756f89f): `src/surfaces/PullRequestSurface.tsx` (489 LOC) absorbs PR list/details/diff/comments and the three sub-mode flag branches. App.tsx drops 272 LOC and no longer imports CommentsPane, PullRequestDiffPane, DetailHeader/Body, DetailsPane, DetailPlaceholder, SplitPane, Filler, or PullRequestList.
- Phase 3 shipped 2026-05-12 (f856b6c): `IssuesWorkspace` → `IssueSurface` (absorbs the `detailFullView && issues` branch internally via an `IssueDetailPane` fast path), `RepoWorkspace` → `RepoSurface`. App.tsx routing collapses two branches into one.
- Phase 4 shipped 2026-05-12 (2e92205, 0ed7ace, 0959f16, faa5048):
  - `src/workspace/layout.ts` — pure `computeLayout({terminalWidth, terminalHeight, showWorkspaceTabs})` with `test/workspaceLayout.test.ts` covering the 100-col breakpoint, pane minimums, junction math.
  - `src/workspace/modalLayouts.ts` — 13 modal rectangles produced by `computeModalLayouts(...)`.
  - `src/hooks/useFocusReturnRefresh.ts` — bundles `useTerminalFocus` + `useIdleRefresh` for PR auto-refresh.
  - `src/hooks/useCommandHandoffs.ts` — 25 `registerHandoff` `useEffect`s, now one named seam.
  - `src/surfaces/WorkspaceHeader.tsx` — breadcrumb header.
  - The proposed `useModalStack` was deferred — modal state is already centralized in `activeModalAtom` and the per-modal `useFilterModal`/`useThemeModal` hooks; consolidating further would be churn without leverage.

**Phase 5 in progress (2026-05-12).** App.tsx is at ~2,470 LOC, down from 3,007 at plan start. To reach ≤300 LOC the remaining work is non-mechanical:
- Diff comment navigation block (`openSelectedDiffComment`, `moveDiffCommentThread`, `jumpDiffFile`, `selectDiffCommentLine`, `toggleDiffCommentRange`, …) — ~180 LOC of closures over diff anchors + refs.
- Pull request action handlers (close/merge/draft toggle/labels modal lifecycle/submit review/comment submit) — ~250 LOC, each closes over many atoms + flashNotice + refresh side-effects.
- Detail/comments/diff hydration choreography (`useDetailHydration`, `loadPullRequestComments`, `loadIssueComments`, `loadPullRequestDiff`, `refreshSelectedComments`, …) — ~200 LOC.
- The transient render-time block (`prListProps`, `issueListProps`, list-needs-scroll math, `workspaceTab*`, `narrow*` heights, junction calculations) — ~120 LOC.
- The modal-stack JSX bundle inside `WorkspaceModals` already absorbs the modal rendering; the per-modal *handlers* still live in App.tsx.

These four chunks would each become a named hook (or surface module) in a follow-up pass. The pattern is now well-established by Phases 1-4: data into atoms or pure helpers, behaviour into named hooks, JSX into surfaces.
