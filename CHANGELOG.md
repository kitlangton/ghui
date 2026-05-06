# @kitlangton/ghui

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
