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
   - **✅ Canonical Issue selection + Workspace Scope foundation** (landed 2026-06-04): moved the displayed Issue pipeline into canonical atoms so rendering, commands, comments, mutations, and load-more target the same filtered Issue; deleted the duplicate `useIssueListDerivations` path. Added first-class `workspaceScopeAtom` so repository scope and reachable Surface tabs no longer derive from the Pull Request Surface. PR and Issue Views remain the per-Surface query representations during the transition.
4. **Extract `usePullRequestSurface`.** The gnarly one — absorbs 14+ PR-specific hooks. Split into sub-slices for review. Designs informed by 11 parallel design-brief subagents on 2026-05-16:
   - **✅ 4a. PR substrate** (landed 2026-05-16): PR atom reads + `useLoadMore` + `usePullRequestRefresh` + `useRefreshCompletionToast` + `useFocusReturnRefresh` + `useDetailHydration` + `buildPullRequestListRows` + `selectedPullRequestRowIndex` + the four PR-refresh refs + the `refreshPullRequestsAtom` callback wrapper + PR list scroll persistence + `selectPullRequestByUrl`. Resulting Surface is 344 LOC; `useAppShell` shrunk 1,361 → 1,259. `useSelectionDerivations` was left intact for now — the brief recommended splitting it (PR-only outputs into the Surface; cross-surface comment outputs into direct atom reads) but its consumers are tangled with the diff/comments machinery still in App-shell, so it's cleaner to land that split as part of 4c. `selectedPullRequestRowIndex` is computed inside the Surface (which calls `pullRequestListRowIndex` directly); the App-shell-side `useSelectionDerivations` still computes its own copy that's now unused.
   - **✅ 4b. Item modal actions rename** (landed 2026-05-16): renamed `usePullRequestModalActions` → `useItemModalActions` and relocated to `src/item/useItemModalActions.ts`. The hook already branched on `activeWorkspaceSurface === "issues"` for close/label/draft modals; the name was the same lie as `usePullRequestMutations`. No behavior change. **`useMergeFlow` deferred** — moving it into the Surface would add 7+ inputs (mergeModal, setMergeModal, closeActiveModal, flashNotice, plus item mutations) for marginal locality gain. It stays at App-shell scope; revisit only if it grows.
   - **4c. Diff machinery + DiffCommentSystem collapse**: `useDiffLoader` + `useDiffPrefetch` + `useDiffLocationPreservation` + `useDiffLineColors` + the four shallow diff-comment hooks (`useDiffCommentDerivations`, `useDiffCommentNavigator`, `useDiffSelectionSync`, `useDiffViewState`) collapsed into one `DiffCommentSystem` module inside the Surface. Folds in deepening candidate #2. **Ordering constraint**: navigator runs first, then location preservation + line colors — kills the current forward-reference dance via lazy-arrow closures. **Risks to preserve**: effect ordering across the 5 sync effects, the 5 `eslint-disable react-hooks/exhaustive-deps` dep-array exemptions, the 80ms scroll-sync interval inside the navigator, and `suppressNextDiffCommentScrollRef` (a cross-hook handshake the line-colors and location-preservation hooks both read).
   - **4d. Shared `useItemComments`** (NOT inside `usePullRequestSurface`): `useCommentsLoader` + `useCommentMutations` + `useCommentsViewActions` all already handle both PR and Issue paths. Promote to **`src/item/useItemComments.ts`** consumed by both Surfaces. Replace `activeWorkspaceSurface === "issues"` checks inside the mutation logic with a subject-kind discriminator (`selectedCommentSubject.kind`). The `pullRequestCommentsAtom` itself stores both kinds — rename to `itemCommentsAtom` as a follow-up.

**Atom ownership strategy (refined from brief #10)**: do NOT move `src/ui/pullRequests/atoms.ts`. ~14 atoms must stay registry-readable for commands, derivations, workspace, and keymap (e.g., `activeViewAtom`, `selectedPullRequestAtom`, `pullRequestStatusAtom`, `hasMorePullRequestsAtom`, `loadedPullRequestCountAtom`, `isLoadingMorePullRequestsAtom`, `loadMoreRowSelectedAtom`, `usernameAtom`, `activeViewsAtom`, `queueLoadCacheAtom`, `queueSelectionAtom`, `prewarmRepositoryDetailsAtom`, `pruneCacheAtom`, `labelCacheAtom`). `selectedRepositoryAtom` is the exception: it now derives from Workspace-owned `workspaceScopeAtom`. The Surface return only re-exposes the cross-cutting ones as React values for App-shell consumers; everything else stays atom-internal.

**Tangential cleanups surfaced by briefs**:
- ✅ `issueOverridesAtom` relocated to `ui/issues/atoms.ts` as part of canonical Issue selection (2026-06-04).
- `listRepoLabelsAtom` appears to be dead — no consumers found outside its own file. Candidate for removal.
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

- **App-shell `useEffect` ordering.** Some effects today depend on cross-Surface state (e.g. `useDiffSelectionSync` reads `selectedIndex`, `selectedIssueIndex`, `selectedRepositoryIndex` simultaneously). When these move into per-Surface shells, do the unused-Surface effects still fire? Probably need a `useActiveSurface(kind)` indirection so inactive Surfaces don't run their loaders. Decide during step 2. — *Still open.*
- **Modal stack ownership.** Confirmed by brief #4: modal *stack* stays in App-shell; modal *state* (form fields, selection indices) lives in the Surface that owns the modal *or* in a shared `useItemModalActions` for the modals that are item-agnostic (label, close).
- **`useCommandHandoffs` shape after step 5.** Today it's a 102-LOC prop-pumping hook. If commands read atoms, this might disappear entirely.
- **Test infrastructure** (from brief #11): zero hook-level tests today. `@effect/atom-react`'s `RegistryProvider` accepts `initialValues` for priming atoms, so `renderHook` + primed atoms = direct Surface tests. To unlock this we need: `@testing-library/react` added as devDep, plus `test/fixtures/` helpers that build `PullRequestItem`/`IssueItem`/`PullRequestComment` plain values. Lift these from the body of `MockGitHubService.buildPullRequest`. ~30 LOC of helpers per kind. Once added, the first 8 invariants worth pinning are listed in the brief output (`scrolling.test.tsx` covers some indirectly via terminal-frame regexes — replace where overlapping).

## Out of scope (for v1)

- The Item cache/load deduplication (`pullRequestCache.ts` + `issueCache.ts` → `item/cache.ts`). Separate plan; lands independently. The Surface deepening doesn't depend on it.
- Workspace module consolidation (`workspace/derivations.ts` + friends). Separate, lower priority.
- Splitting `src/keymap/` further. The per-context keymap files already work; only Surface-specific *registration* needs to move into `surfaces/*/keymap.ts`.

## Status

In progress. Architecture review 2026-05-14 surfaced this as the highest-friction candidate; design committed to (a) Diff as PR-Surface sub-mode + Detail/Comments as Item-Surface sub-modes, (b) commands read atoms via registry, (c) `useItemMutations` consolidates PR+Issue mutations. Steps 1-3, 4a, 4b, canonical Issue selection, and the Workspace Scope foundation have landed.
