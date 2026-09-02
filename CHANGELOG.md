# @kitlangton/ghui

## 0.9.1

### Patch Changes

- 45e2279: Fix merging pull requests into branches with a merge queue: avoid requesting branch deletion, keep queued pull requests open while refreshing, and report queue requests separately from completed merges. Admin merges still explicitly bypass the queue. Block merge confirmation after lookup failures.
- 090a4d5: Restore branch, review, and check details when copying pull request metadata, and comment counts and labels when copying issue metadata.

## 0.9.0

### Minor Changes

- f560aa5: Add "open pull request in editor" (`e`): suspend the TUI and launch a configurable command (e.g. `nvim` with diffview/octo, or `code`). Configure `editorCommand` and `repoPaths` in `config.json`, with gh-dash-style `{{...}}` substitutions and `owner/repo` path matching.
- f560aa5: Add a per-PR GitHub Actions runs view (`a`): see a pull request's workflow runs, drill into jobs and steps, jump between failures, and open a step's log or the run in the browser — without leaving the terminal. Built as a full-screen PR view mode (a peer of the diff view), backed by `gh run list` / `gh run view`.

## 0.8.0

### Minor Changes

- 4bfd33e: Add a docked Changed Files panel to the diff view. Auto-shows on terminals ≥ 130 cols, with `shift+f` to toggle visibility. The existing `f` "open changed files" key now renders inline in the panel when docked, falling back to the modal overlay on narrow terminals.
- 00e379c: Add an experimental repository workspace tab bar with Pull Requests and Issues surfaces.

### Patch Changes

- 20bbaf2: Fix issue-detail scrolling, narrow modal layout, stale empty queues, unsafe modal retargeting, cross-surface command actions, preference persistence failures, and deleted-author items.
- 22a8884: Cache: persist the issue queue, derive a repo rollup from cached PRs +
  issues, and prewarm `repository_details` in the background so the Issues
  and Repos tabs paint instantly on launch and repo detail panes feel warm
  on first selection. Adds an `issues` table mirroring `pull_requests`
  (reusing `queue_snapshots` with `view_key LIKE 'issue:%'`), a viewer-
  scoped `readRepoRollup` aggregation, and an opportunistic prewarm with
  TTL-skip and concurrency 4 for favorites + recents + the detected repo.
- 75b3c6c: Keep filtered Issue actions and comments aligned with the Issue shown in the workspace.
- aa2d3b4: Align pull request and issue loading, selection, cache retention, pagination safety, and footer behavior while updating runtime and tooling dependencies.
- 75b3c6c: Render authored-only pull request queues as compact one-line rows without redundant author and branch metadata.
- 75b3c6c: Honor the configured fetch limit consistently for Issue first-page loads and pagination state.
- 4c4a333: Fix repository `author:@me` pull request filters continuing to display the unfiltered repository list after the authored query loads.
- 75b3c6c: Stabilize HOME pull request loading, selection, refresh, pagination, detail hydration, and diff prefetch while upgrading Effect packages to beta.85.
- 20bbaf2: Show last-update recency in repository issue lists so their timestamp labels match their activity ordering.
- e97bdd1: issues now paginate the same way pull requests do. previously the
  Issues tab cap'd at 50 with no way to load more — the tab read
  "ISSUES 50" even when a repo had hundreds of open issues.

  the page fetch shape mirrors pull-request pagination end to end:
  `listIssuePageAtom` + `nextIssueLoadAfterPage` for the cursor-aware
  append, a `useIssuesLoadMore` hook with the same `inFlightKeyRef`
  race lock and 15s timeout, and a `loadMoreIssueRowSelectedAtom` that
  makes the load-more row an explicit selectable slot. the Issues tab
  now shows "50+" while more pages are available; pressing j past the
  last issue lands on the load-more row, pressing Enter triggers the
  next page fetch.

  both pull requests and issues share the same UX:

  ↓ Press enter to load more · N loaded

  and the same race protection — concurrent triggers within a single
  render tick can't fire parallel fetches with the same cursor.

- 354380d: fix pull-request pagination wedging at "(50 loaded) 50+". the previous
  auto-load mechanism had three concurrent triggers — a 120ms scroll-position
  poll, a selection-threshold useEffect, and the j-at-tail step — all gated
  on React state via `isLoadingMorePullRequests`. since `setLoadingMoreKey`
  is asynchronous, two triggers in the same tick both saw a cleared flag and
  fired parallel fetches with the same cursor; the second response then saw
  `cursorAdvanced=false` and flipped `hasNextPage=false`, killing pagination
  at 50 with the tab stuck on "50+".

  the fix removes scroll-polling + selection-threshold auto-fire entirely,
  keeps the explicit j-at-tail trigger, and adds a synchronous
  `inFlightKeyRef` lock inside `useLoadMore` so multiple triggers within a
  single tick can't race. also adds a 15s `Promise.race` timeout so a
  hanging GraphQL response surfaces a flash notice + clears the spinner
  instead of wedging. the load-more row now prompts "↓ Press j to load more"
  so the affordance is explicit.

- ab6d931: Show one consistent animated loading-details indicator across pull request detail and diff views.
- cf8c7d1: Connect issue detail dividers to split-pane borders, simplify workspace chrome, and refresh mock workspace titles.
- ee6bdb8: stop the "Loading more pull requests" loop that could fire repeatedly
  when GitHub's cursor-based pagination drifted and returned items
  already in the list; treat a page that adds no new pull requests as
  terminal. also surface `updatedAt` on pull requests so the age column
  and client-side ordering match GitHub's `sort:updated-desc`, fixing a
  list that looked unordered because the age column was showing days
  since creation while the server sorted by recent activity
- 51c36ee: Fix a stalemate bug that left views stuck on Loading:

  - Diff and PR-detail fetches now time out after 30s instead of dangling indefinitely when the underlying family-created atom is interrupted or GC'd before settling — the pane transitions to an error state with a retry hint instead of wedging on "Loading…".

- 6a0f8f9: Keep cached comments visible during refreshes and show persistent, retryable comment loading errors.
- f9b5b68: Retry transient failures when loading the first page of Issues, matching pull request behavior.
- 20bbaf2: Hide scrollbars by default while keeping panes scrollable, with a `showScrollbars` config setting to restore visible rails.
- 86819df: Replace the dangling-prone family-of-runtime.atom pattern with `runtime.fn` for all one-shot fetches (diff, PR details). Eliminates the wedged "Loading…" state that could happen when the underlying AsyncResult got stuck in Waiting after a fiber interrupt — the runtime.fn pattern returns a normal Promise that always resolves or rejects.
- ed011a3: Internal refactor: drain App.tsx by ~330 lines and reorganize state, hooks,
  and view components into per-feature modules. No user-facing change. Atoms
  move into `src/ui/<feature>/atoms.ts` files (theme, diff, comments, filter,
  detail, workspace, listSelection, notice, modals, pullRequests). Effects
  extract into custom hooks (`useFlashNotice`, `useSystemAppearancePolling`,
  `useSpinnerFrame`, `useClampedIndex`, `useTerminalFocus`,
  `useScrollFollowSelected`, `usePasteHandler`, `useIdleRefresh`,
  `useDiffPrefetch`, `useWorkspacePreferencesPersistence`). The keymap
  context object splits into 17 per-domain builders under
  `src/keymap/contexts/`, composed by `buildAppCtx()`. The 1,379-line
  `src/ui/modals.tsx` carves into per-modal files under `src/ui/modals/`
  with the original path preserved as a barrel re-export. New
  `src/surfaces/` directory holds `RepoWorkspace`, `IssuesWorkspace`, and
  `WorkspaceModals`.
- 1001135: rework system theme auto-reload to retry until the terminal palette
  actually changes, refuse to overwrite the active theme with incomplete
  or stale palette data, prime a baseline at startup so the first signal
  behaves correctly, and emit structured events for opt-in debug logging
  via `GHUI_DEBUG_THEME_RELOAD_LOG`
- 60f6289: Share the guarded load-more state machine between pull requests and issues.
- e912547: Show a non-interactive fallback when the terminal is smaller than 60x16 and restore the mounted workspace after resizing.

## 0.7.1

### Patch Changes

- ba23f23: Show compact check-status indicators in the pull request list instead of full check counts.
- 40b69dc: Fix wrapped diff line selection, preserve the selected line, highlight, and viewport position across whitespace-mode changes, and show the word-wrap shortcut in the diff view footer hints.
- ba23f23: Use the active theme foreground color for unstyled diff text.

## 0.7.0

### Minor Changes

- d62dd66: Add `?` as a shortcut for opening the command palette, where available commands and key bindings are shown.
- d45e6cb: Show the source branch name in pull request details and copied metadata.
- 011717e: Add a follow-system theme mode with separate dark and light theme selections while preserving fixed theme selection.

## 0.6.0

### Minor Changes

- c8fb3e7: Edit and delete your own comments from the comments view (`e` and `x`). Edits open the comment editor pre-filled; deletes prompt for confirmation. Both update optimistically and revert on failure. Also collapses the duplicate footer that previously appeared below the comments pane — the comments view now hosts a single, context-aware hint row.

## 0.5.0

### Minor Changes

- Redesign the pull request details pane: comment threads no longer inline in the body, replaced by a compact `Comments  N · press c to view all` row in the header. Press `c` to open the dedicated comments view. The Markdown preview now also renders bold (`**strong**`) and basic pipe tables, with bold inline code properly nested.
- 24477aa: Add a persistent SQLite cache for pull request queues and hydrated details so launches can show stale data immediately while refreshing from GitHub. The cache lives at `${XDG_CACHE_HOME:-~/.cache}/ghui/cache.sqlite` by default, can be redirected with `GHUI_CACHE_PATH`, and disabled entirely with `GHUI_CACHE_PATH=off`. Cache writes are best-effort (failures never block GitHub reads/writes) and old entries are pruned both after successful queue refreshes and at startup so the database stays bounded for read-only sessions.

## 0.4.7

### Patch Changes

- Fix comments view refreshes and keep review comment replies synchronized across the comments pane and diff threads.

## 0.4.6

### Patch Changes

- 3f66a3a: Detect and open links in PR bodies. Markdown `[label](url)` and bare URLs are highlighted, hover changes the cursor to a pointer, and clicking opens the link in the system browser. Single-pass tokenizer also handles `#NNN` references and inline code. New `link` color in every theme.

## 0.4.5

### Patch Changes

- Support repository merge methods in the merge modal, including merge commits, rebase merges, auto-merge, admin merges, and draft mark-ready confirmation.

## 0.4.4

### Patch Changes

- 98fc852: Treat terminal `enter` key events the same as `return` key events.
- 5c5576d: Wrap keyboard selection at the ends of picker-style modals.
- 8e357ee: Add Vague as a selectable color theme.

## 0.4.3

### Patch Changes

- bbf93d7: Require an explicit modal confirmation before changing a pull request between draft and ready for review.
- 7a2317c: Clarify Homebrew installation and release automation documentation.

## 0.4.2

### Patch Changes

- 3b41b4e: Show the startup logo sooner, run spinners at a shared 12 FPS, and add a separate hover highlight for pull request rows.

## 0.4.1

### Patch Changes

- Avoid leaking terminal color query escape responses when starting ghui.

## 0.4.0

### Minor Changes

- 727eb3a: Add light theme variants behind a theme picker tab toggle, so dark and light themes preview separately.
- b2dcde5: Ship npm installs through platform-specific standalone binary packages so npm users no longer need Bun installed.

### Patch Changes

- f724ea2: Add Homebrew installation support with standalone release binaries and tap update automation.
- 0c09e21: Filter pull requests from archived repositories out of the default queues while keeping explicit repository views available.

## 0.3.3

### Patch Changes

- fe5576f: Make pull request review submission discoverable with `shift-r` from list, details, and diff views.
- Polish the review modal with action-first selection, optional summary editing, paste support, and less noisy footer/header hints.
- Hide conversation previews until comments are loaded and non-empty.
- Enforce formatting in CI and document the pre-commit/release checks for agents.

## 0.3.2

### Patch Changes

- Keep the private keymap workspace available for CI typechecking without publishing it as a runtime dependency.

## 0.3.1

### Patch Changes

- 8b67389: Fix the published CLI package so clean installs do not depend on workspace-only sources or consumer JSX settings.
- 4b2c0e4: Polish review conversation previews and soften highlighted diff gutters.

## 0.3.0

### Minor Changes

- 62dd2a2: Add diff review shortcuts for navigating changed files and submitting pull request reviews.
- Add path-aware fuzzy search and Neovim-style `ctrl+n`/`ctrl+p` navigation to the changed-files navigator.
- Remove `GHUI_AUTHOR` and `GHUI_REPO`; ghui now uses GitHub's `@me` search qualifiers and repositories can be opened from inside the app.
- Derive diff line-number text color from the gutter surface instead of reusing the global muted gray.

## 0.2.1

### Patch Changes

- Keep the pull request details conversation connector aligned while the details pane scrolls.

## 0.2.0

### Minor Changes

- Show pull request conversation items in the details pane, default diffs to ignore whitespace-only changes, and apply optimistic merge UI updates immediately.

## 0.1.22

### Patch Changes

- 94f40b7: Polish diff navigation, command search, and pull request detail layout with vim-style viewport commands, counted list movement, syntax-highlighted code blocks, and fixed fullscreen headers.
- 94f40b7: Make diff line comments cursor-driven with enter-to-open, range selection, thread jumps, and vim-style counted movement.
- 94f40b7: Show an animated spinner in the pull request list footer while loading the next page.

## 0.1.21

### Patch Changes

- 1b43871: Command palette now accepts an `owner/repo` or GitHub URL as a query and offers an inline "Open <repo>" command — no need to open the dedicated "Open repository…" modal first. Layout polish: scopes group correctly even when commands interleave, command subtitles fill the previously empty space between title and shortcut, and a spacer separates each section.
- 1b43871: Load the next pull request page when the pull request list itself is scrolled to the bottom, not only when the selected row nears the end.

## 0.1.20

### Patch Changes

- 6457403: Add a searchable command palette for running ghui actions from one modal.
- 6457403: Add a command palette backed by a shared command registry and route core app actions through it.
- 180ada0: Prefetch pull request details around the current selection so adjacent navigation feels faster, and have `bun dev` send telemetry to the local motel port by default.
- 6457403: Load pull request diffs through the paginated GitHub files API so large PRs over 300 files render completely, and add `GHUI_REPO` for browsing open PRs in a specific repository.
- 712ed04: Load pull request lists in cursor-paged batches so large repositories open quickly, with a visible load-more footer and command. Keep PR detail loading placeholders out of scroll views while details hydrate.
- 6457403: Polish the command palette and pull request details preview: keep palette navigation stable, hide its scrollbar, allow paging through long descriptions, and stop showing a placeholder when a PR has no labels.
- 8426732: Add a command palette action for opening arbitrary repositories at runtime.
- c8fa2cd: Fix pull request diff races so large PRs do not briefly show another PR's file list, make fullscreen details scroll through long summaries, keep cached details loaded across refreshes, and enable shell syntax highlighting for `.sh`, `.bash`, `.zsh`, `.ksh`, and `.bats` diffs.
- 6457403: Add a System theme that uses the terminal foreground, background, selection, and ANSI palette colors.
