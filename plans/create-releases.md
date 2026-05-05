# Create releases

## Why

ghui is a terminal UI for GitHub day-to-day work. Right now it covers PRs end-to-end but stops at merge — cutting a release still means switching to the browser or `gh release create` with a long argv. Releases are part of the same loop (merge → tag → publish notes), so they belong in the same TUI.

The goal is **1:1 parity with the github.com "Create a new release" page** — anything you can do at `https://github.com/<owner>/<repo>/releases/new`, you can do from ghui without leaving the terminal.

## What we'd ship

A new "Release" mode reachable from the command palette (`:release` / `:release new`) and via a top-level keybinding (TBD). v1 surface area:

1. **Repo selection.** Default to the repo of the currently-focused PR, or the repo most recently active. Allow `:release new <owner>/<repo>` to override.
2. **A modal/screen that mirrors github.com's release form**, field-for-field:
   - **Tag** — choose existing tag or type a new one. Autocomplete from existing tags. If new, also pick **target** (branch or commit SHA, default `main`/default branch).
   - **Previous tag** — `auto` (default) or pick a specific tag, used by "Generate release notes".
   - **Release title** — single-line, defaults to the tag name when empty (matches github.com).
   - **Description** — multiline markdown editor (reuse `commentEditor.ts` patterns; `$EDITOR` integration like other long-text fields).
   - **Generate release notes** — button/keybind that calls GitHub's autogenerate endpoint and inserts the result into title + description (only fills empty fields, matching web behaviour).
   - **Set as a pre-release** — checkbox.
   - **Set as the latest release** — tri-state: `auto` / `true` / `false` (matches API's `make_latest`).
   - **Create a discussion for this release** — optional, with a discussion category picker (only shown if discussions are enabled on the repo).
   - **Save draft** vs **Publish release** — two submit actions (`shift+S` draft, `enter`/`shift+P` publish), matching the two buttons on the page.
3. **Existing-releases list** (`:releases` or just entering release mode without `new`):
   - Lists releases for the active repo: tag, name, draft/prerelease/latest badges, published date, author.
   - Open a release to view its body rendered, asset list, and metadata.
   - Actions: edit (re-opens the same form prefilled), delete (with confirm), open in browser (`o`), copy URL (`y`).
4. **Asset attachments — deferred.** v1 ships without binary upload. The form will note "Attach binaries via the web UI for now" with `o` to open the draft in the browser. Tracked under Out of scope below.

## API mapping

Use REST via `gh api` (already the pattern in `GitHubService` for non-GraphQL flows). All routes documented under https://docs.github.com/en/rest/releases.

| Action | Endpoint |
| --- | --- |
| List releases | `GET /repos/{owner}/{repo}/releases` |
| Get release | `GET /repos/{owner}/{repo}/releases/{id}` |
| List tags (autocomplete) | `GET /repos/{owner}/{repo}/tags` (paginated) |
| List branches (target) | `GET /repos/{owner}/{repo}/branches` |
| Generate release notes | `POST /repos/{owner}/{repo}/releases/generate-notes` with `tag_name`, `previous_tag_name?`, `target_commitish?` |
| List discussion categories | GraphQL `repository.discussionCategories` (REST has no endpoint) |
| Create release | `POST /repos/{owner}/{repo}/releases` body: `tag_name`, `target_commitish`, `name`, `body`, `draft`, `prerelease`, `make_latest` (`"true"`/`"false"`/`"legacy"`), `discussion_category_name?`, `generate_release_notes?` |
| Edit release | `PATCH /repos/{owner}/{repo}/releases/{id}` |
| Delete release | `DELETE /repos/{owner}/{repo}/releases/{id}` |
| List assets | `GET /repos/{owner}/{repo}/releases/{id}/assets` (read-only in v1) |

`gh release create/edit/delete/view/list` exists too, but we already shell into `gh api` for fine-grained control elsewhere — sticking with REST keeps responses typed via `effect/Schema` like the rest of `GitHubService`.

## Architecture sketch

- **`src/domain.ts`**: new types `Release`, `ReleaseSummary`, `Tag`, `Branch`, `DiscussionCategory`, `MakeLatest = "true" | "false" | "legacy"`, `CreateReleaseInput`, `UpdateReleaseInput`.
- **`src/services/GitHubService.ts`** new methods:
  - `listReleases(repo, page): Effect<Page<ReleaseSummary>, …>`
  - `getRelease(repo, id): Effect<Release, …>`
  - `listTags(repo): Effect<readonly Tag[], …>`
  - `listBranches(repo): Effect<readonly Branch[], …>`
  - `generateReleaseNotes(repo, input): Effect<{ name: string; body: string }, …>`
  - `listDiscussionCategories(repo): Effect<readonly DiscussionCategory[], …>`
  - `createRelease(repo, input): Effect<Release, …>`
  - `updateRelease(repo, id, input): Effect<Release, …>`
  - `deleteRelease(repo, id): Effect<void, …>`
- **`src/services/MockGitHubService.ts`**: in-memory mirror for tests/dev.
- **`src/ui/ReleaseForm.tsx`** (new): the create/edit form. Reuses `singleLineInput.ts` for tag/title/target, `commentEditor.ts` for the body, and `modals.tsx` for the frame. Junction-row dividers per `AGENTS.md` UI conventions.
- **`src/ui/ReleaseList.tsx`** (new): list view, mirrors `PullRequestList.tsx` styling.
- **`src/ui/ReleaseDetails.tsx`** (new): detail view, mirrors `DetailsPane.tsx`.
- **`src/appCommands.ts`**: register `:release new`, `:release list`, `:release edit <tag>`, `:release delete <tag>`.
- **`src/App.tsx`**: new top-level mode `release` with sub-screens `list`/`form`/`details`. Probably swap out `PullRequestList`/`DetailsPane` while in this mode rather than splitting the layout.
- **Cache.** Releases are cheap to list and change rarely; cache in `CacheService` keyed by `repo:releases` with a short TTL (5 min) and `repo:tags` (1 h). Bust on any local create/edit/delete.

## UX details worth pinning down

- **Form layout.** github.com stacks fields vertically; in the TUI we likely want a single column too, with `tab`/`shift-tab` to move between fields and `enter` to commit a value (matching how comment editing already feels). Generating notes is `g` in the form's footer hints.
- **Tag autocomplete.** When typing a new tag, show a fuzzy-matched dropdown of existing tags. Picking one switches to "use existing tag" mode and hides the target field, matching the web UI.
- **Latest tri-state UI.** Render as `( ) auto   ( ) yes   ( ) no` with `space` to advance.
- **Confirm on publish vs draft.** `enter` from the body publishes; `shift+S` saves draft. We won't add an "are you sure" — github.com doesn't either.
- **Markdown preview.** Out of scope for v1 — body is shown as raw markdown. Possibly add a side preview later.

## Open questions

1. **Top-level keybind.** PR list is the home screen today. Do releases get a sibling keybind (`R` from list?) or only command-palette entry? Lean: command-palette only in v1, add a keybind once we know how often it's used.
2. **Cross-repo browsing.** The PR list is multi-repo (queue of search results). Should the release list be multi-repo too, or always single-repo? Lean: single-repo — releases are inherently per-repo and a unified feed is noisy.
3. **Default target branch.** github.com defaults to the repo's default branch. We need an extra API call (`GET /repos/{owner}/{repo}`) to find it, or just default to `main` and let users override. Lean: fetch the default branch lazily — it's a tiny payload and matches the web's behaviour.
4. **Generate-notes UX when fields are non-empty.** github.com only fills empty fields. Do we mirror exactly, or always overwrite with a confirm? Lean: mirror exactly; provide `shift+G` as "force regenerate" later if asked.
5. **Discussion category fetch.** Only call when the user toggles "create a discussion" so we don't pay the GraphQL cost otherwise.
6. **Asset uploads.** GitHub uses a separate uploads host (`uploads.github.com`) with binary multipart. `gh release upload` exists. Doable, but file pickers in a TUI are a real design exercise — punt to v2.

## Out of scope (for v1)

- Binary asset upload / management (delete, rename).
- Markdown preview pane.
- Release templating / per-repo defaults.
- Notifications when a release publishes.
- Cross-repo "all my releases" feed.

## Status

In progress.

- [x] Phase 1 — domain types, `GitHubService` methods, mock mirror, unit tests.
- [x] Phase 2 — release list + details overlay, command-palette entry, async loaders. (Persistent cache deferred; releases are refetched each time the modal opens.)
- [ ] Phase 3 — create/edit form, tag autocomplete, generate-notes, draft/publish submit.
- [ ] Phase 4 — delete confirm, footer hints, lazy discussion categories, doc updates.

Decisions (from review): command-palette only in v1, single-repo release list, lazy default-branch fetch, generate-notes mirrors web (only fills empty fields), asset upload deferred to v2.
