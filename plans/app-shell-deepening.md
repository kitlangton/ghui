# App-shell deepening

## Why

`useAppShell` is 1,400 LOC and growing. The earlier `app-tsx-decomposition` plan got `App.tsx` down to 65 LOC, but the complexity didn't get *deeper* — it relocated into one God-hook. Today `useAppShell` reads 60+ atoms, composes ~20 sibling hooks, and re-exposes the whole tree as a flat prop bag of 80+ fields that `App.tsx` threads into Surfaces. The hook's interface is nearly as wide as its implementation — a shallow module by definition.

Consequences:
- Surfaces (`PullRequestSurface.tsx` is 567 LOC, takes 85+ props) cannot be tested in isolation.
- Adding behavior to a single Surface requires editing the shared shell + threading new props.
- PR-specific and Issue-specific concerns bleed into each other (e.g. `usePullRequestMutations` already mutates issues — name is wrong).
- The keymap layer (`useAppKeymap`, 359 LOC) inherits the same wide interface because actions flow through props.

## What we'd ship

End state:

- `App.tsx` routes by active Surface; doesn't thread state.
- Each Surface owns its own state, actions, view modes, modals, and keymap context. Surface contract: `{ isFullscreen, summary, actions }`. JSX renders inside the Surface.
- App-shell becomes cross-cutting infrastructure only: layout, modal *stack*, command registry, keymap binding, theme, workspace navigation, startup, preferences, paste routing.
- Commands read atoms directly via the registry instead of taking action props. `useAppKeymap` becomes a thin context binder.
- `useItemMutations` (renamed from `usePullRequestMutations`) is the shared mutation surface for both kinds of Item.

Target sizes (approx):
- `useAppShell`: 1,400 → ~400 LOC
- `usePullRequestSurface`: new, ~400 LOC (absorbs diff/comments hooks too)
- `useIssueSurface`: new, ~200 LOC
- `useRepoSurface`: new, ~150 LOC
- `useAppKeymap`: 359 → ~150 LOC (no action props)

## API / architecture mapping

```
src/
  app/                       ← App-shell concerns
    useAppShell.ts           ← shrunk: layout + nav + modals + commands + keymap binding
    layout.ts                ← moved from workspace/layout.ts
  surfaces/
    pullRequest/
      Surface.tsx            ← from surfaces/PullRequestSurface.tsx
      usePullRequestSurface.ts
      keymap.ts              ← per-Surface keymap context registration
    issue/
      Surface.tsx
      useIssueSurface.ts
      keymap.ts
    repo/
      Surface.tsx
      useRepoSurface.ts
      keymap.ts
  item/                      ← shared PR+Issue concerns
    useItemMutations.ts      ← renamed from usePullRequestMutations
    cache.ts                 ← absorbs PR+Issue cache duplication (separate plan)
```

Surface contract:

```ts
type SurfaceShell = {
  readonly isFullscreen: boolean       // gates App-shell's workspace-tabs visibility
  readonly summary: SurfaceSummary     // tab counts, footer hints
  readonly actions: SurfaceActions     // exposed for keymap/command consumption
}
```

Commands migrate from `{ id, run: (actions) => void }` to `{ id, run: (registry) => Effect }` — handlers read atoms by registry, no action prop threading.

View-mode ownership change:
- `diffFullView` moves into `usePullRequestSurface` (PR-only).
- `detailFullView`, `commentsViewActive`, `commentsViewSelection` move into a shared `ItemSurfaceViewMode` consumed by both PR and Issue Surfaces.
- App-shell stops owning view-mode booleans; reads `activeSurface.isFullscreen` instead.

## Execution order (smallest reversible slice first)

1. **✅ `useItemMutations` rename.** Pure rename + relocate of `usePullRequestMutations` to `src/item/useItemMutations.ts`. No behavior change. Decouples the next steps from the naming lie. — Landed 2026-05-14.
2. **✅ Extract `useRepoSurface`.** Smallest Surface, fewest dependencies (repositoryItems, useRepositoryDetails, repo favorite/remove actions). Proves the Surface contract on the easy case. `openSelectedRepository` stayed in App-shell (1-line glue using `switchViewTo`) to avoid cycling with `useWorkspaceNavigation`; `useWorkspaceNavigation` now reads `recentRepositoriesAtom` directly instead of taking the setter as a prop — first validation of design decision (b). — Landed 2026-05-16.
3. **✅ Extract `useIssueSurface`.** Issue atoms, list derivations, pagination, scroll persistence, clamping. ~22 fields exposed on the Surface contract — wide return but cohesive. Issue mutations route through `useItemMutations` (step 1). — Landed 2026-05-16.
4. **Extract `usePullRequestSurface`.** The gnarly one — absorbs 14+ PR-specific hooks. Split into sub-slices for review:
   - **4a. PR substrate**: PR atom reads + `useLoadMore` + `usePullRequestRefresh` + `useRefreshCompletionToast` + `useDetailHydration` + `buildPullRequestListRows` + `useSelectionDerivations`. The data layer.
   - **4b. PR modal actions**: `usePullRequestModalActions` + `useMergeFlow`. The "modify a PR via a modal" surface.
   - **4c. Diff machinery + DiffCommentSystem collapse**: `useDiffLoader` + `useDiffPrefetch` + `useDiffLocationPreservation` + `useDiffLineColors` + the four shallow diff-comment hooks (`useDiffCommentDerivations`, `useDiffCommentNavigator`, `useDiffSelectionSync`, `useDiffViewState`) collapsed into one `DiffCommentSystem` module inside the Surface. Folds in deepening candidate #2 from the architecture review.
   - **4d. PR Comments**: `useCommentsLoader` + `useCommentMutations` + `useCommentsViewActions`. These also serve the Issue Surface (issues have comments too) — likely promotes to an `Item Comments` module shared by both Surfaces, per the (a) decision that Comments is an Item-Surface concept.
5. **Keymap migration to atom-reading commands.** `useAppKeymap` stops taking action props; commands read atoms via registry. Per-Surface keymap files (`surfaces/*/keymap.ts`) register context bindings. Reversible because keymaps are already context-shaped data.

Each step is independently mergeable. Each step adds or migrates tests for the Surface it touches.

### Progress snapshot (2026-05-16)

After steps 1–3:

| Module | LOC |
|--------|-----|
| `useAppShell` | 1,400 → 1,361 |
| `useWorkspaceNavigation` | 195 → 150 |
| `surfaces/repo/useRepoSurface` | new, 132 |
| `surfaces/issue/useIssueSurface` | new, 172 |
| `item/useItemMutations` | new, 62 (relocated) |

`useAppShell`'s LOC shrink is modest because Surface returns are destructured back into local names for downstream consumers — that's a transitional state. The structural wins are: (i) two real `SurfaceShell` interfaces exist; (ii) `useWorkspaceNavigation` is no longer surface-aware; (iii) the atom-reading pattern from design decision (b) is validated in one concrete case. Step 5 (commands read atoms) will allow the destructure-back pattern to dissolve, at which point `useAppShell`'s LOC will drop sharply.

## Open questions

- **App-shell `useEffect` ordering.** Some effects today depend on cross-Surface state (e.g. `useDiffSelectionSync` reads `selectedIndex`, `selectedIssueIndex`, `selectedRepositoryIndex` simultaneously). When these move into per-Surface shells, do the unused-Surface effects still fire? Probably need a `useActiveSurface(kind)` indirection so inactive Surfaces don't run their loaders. Decide during step 2.
- **Modal stack ownership.** Most modals are app-level (theme, command palette, open-repository). Some are Surface-specific (merge modal → PR only; label modal → both PR and Issue; submit-review → PR only). Cleanest answer: modal *stack* stays in App-shell; modal *state* (form fields, selection indices) lives in the Surface that owns the modal. Confirm during step 4.
- **`useCommandHandoffs` shape after step 5.** Today it's a 102-LOC prop-pumping hook. If commands read atoms, this might disappear entirely.

## Out of scope (for v1)

- The Item cache/load deduplication (`pullRequestCache.ts` + `issueCache.ts` → `item/cache.ts`). Separate plan; lands independently. The Surface deepening doesn't depend on it.
- Workspace module consolidation (`workspace/derivations.ts` + friends). Separate, lower priority.
- Splitting `src/keymap/` further. The per-context keymap files already work; only Surface-specific *registration* needs to move into `surfaces/*/keymap.ts`.

## Status

Not started. Architecture review 2026-05-14 surfaced this as the highest-friction candidate; design committed to (a) Diff as PR-Surface sub-mode + Detail/Comments as Item-Surface sub-modes, (b) commands read atoms via registry, (c) `useItemMutations` consolidates PR+Issue mutations.
