# @kitlangton/ghui

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
