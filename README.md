# ghui

Terminal UI for keeping up with your open GitHub pull requests across repositories.

`ghui` gives you one keyboard-driven place to review PR details, inspect diffs, leave diff comments, manage labels, toggle draft state, merge, open PRs in GitHub, and copy PR metadata without leaving the terminal.

<img width="1420" height="856" alt="image" src="https://github.com/user-attachments/assets/5e560a4a-5887-4baa-a6d4-e1f4f0410c70" />

## Install

```bash
bun install -g @kitlangton/ghui
```

Requirements:

- Bun runtime installed
- GitHub CLI installed and authenticated with `gh auth login`

Run it from anywhere:

```bash
ghui
```

## Local Development

Clone, install, and link:

```bash
git clone https://github.com/kitlangton/ghui.git
cd ghui
bun install
bun link
```

With Nix flakes:

```bash
nix develop
bun install
bun run dev
```

## Configuration

- `GHUI_AUTHOR`: author passed to `gh search prs`, defaults to `@me`
- `GHUI_REPO`: optional `owner/name` repository queue for browsing all open PRs in a repo
- `GHUI_PR_FETCH_LIMIT`: max PRs fetched, defaults to `200`

Example:

```bash
GHUI_AUTHOR=@me ghui
GHUI_REPO=basecamp/omarchy ghui
```

You can also copy `.env.example` to `.env` and edit the values locally.

## Keybindings

- `up` / `down`: move selection
- `k` / `j`: move selection
- `gg` / `G`: jump to first or last pull request
- `ctrl-u` / `ctrl-d`: page up or down
- `tab` / `shift-tab`: switch PR queue
- `ctrl-p` / `cmd-k`: open the command palette
- `/`: filter
- `enter`: expand details; normal PR actions still work while details are expanded
- `esc`: return from expanded details, leave diff/comment mode, or close modal
- `r`: refresh
- `d`: view stacked diff for all changed files
- `c`: enter or exit diff comment mode while viewing a diff
- `up` / `down` / `pageup` / `pagedown`: move comment target while in diff comment mode
- `enter`: open a commented diff line, or start a comment on an uncommented line
- `a`: add a comment while in diff comment mode
- `left` / `right`: choose the deleted or added side while in split diff comment mode
- `[` / `]`: switch files while viewing or commenting on a diff
- `s`: toggle draft or ready-for-review state
- `m`: merge
- `x`: close with confirmation
- `t`: choose theme, including `System` to match your terminal colors
- `l`: manage labels
- `o`: open PR in browser
- `y`: copy PR metadata
- `q`: quit
