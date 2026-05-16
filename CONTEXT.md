# Domain Language

Load-bearing terms used in code, plans, and architecture reviews. When a refactor names a new module after a concept, add the concept here first.

## Item

A PR or an Issue. They share intake, pagination, cache merge semantics, mutation surface (label add/remove, close, comment), and detail hydration. The shared shape lives in `src/domain.ts` (`PullRequestItem`, `IssueItem`, `ItemKind`); the shared cache/load logic is the long-term target of `src/item/`.

Both PR-only fields (diff, merge state, reviews) and Issue-only fields exist, but anywhere the same skeleton applies to both, "Item" is the right name. `useItemMutations` (formerly `usePullRequestMutations`) is the canonical example — it already mutates both kinds.

## Surface

A top-level workspace mode the user navigates between via tabs. Today: **Repo Surface** (browse repositories), **Pull Request Surface**, **Issue Surface**. The active Surface is tracked in `workspaceSurfaceAtom`. Each Surface owns its own atoms reads, loaders, view modes (list/detail/diff/comments), modals' state, and keymap context.

A Surface is not a layout container and not a pure component — it's a *shell* with state + actions + derivations. The JSX in `src/surfaces/` is the rendered view of the shell.

## App-shell

The cross-cutting infrastructure that sits *above* Surfaces: layout math, modal stack, theme, command registry, keymap binding, paste routing, workspace navigation (which Surface is active), startup tasks, preferences persistence. App-shell does not own Surface-specific state — it queries the active Surface for things like `isFullscreen` to drive layout decisions.

The `useAppShell` hook is the App-shell's entry point; over time it shrinks as Surface-specific code migrates into Surface shells.

## View Mode

Within an Item Surface (PR or Issue), the user can be in `list`, `detail`, `comments`, or — PR only — `diff` mode. View modes are owned by the Surface, not the App-shell. App-shell asks `isFullscreen?` to decide whether to hide workspace tabs.

## Queue / View

A `View` selects what to load (`Queue` of authored/review-requested/etc., or `Repository`). A `Load` is the cached result of fetching a View's first page. See `pullRequestViews.ts` and `issueViews.ts`. The `Item` consolidation (above) is meant to unify these too.
