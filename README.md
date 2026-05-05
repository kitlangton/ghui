# ghui

Terminal UI for keeping up with your open GitHub pull requests across repositories.

`ghui` gives you one keyboard-driven place to review PR details, inspect diffs, leave diff comments, manage labels, toggle draft state, merge, open PRs in GitHub, and copy PR metadata without leaving the terminal.

<img width="1420" height="856" alt="image" src="https://github.com/user-attachments/assets/5e560a4a-5887-4baa-a6d4-e1f4f0410c70" />

## Install

Homebrew is the recommended install path on macOS and Linux. It installs a standalone `ghui` binary, so you do not need Bun or npm at runtime.

```bash
brew install kitlangton/tap/ghui
```

Upgrade with:

```bash
brew upgrade ghui
```

Or install with npm:

```bash
npm install -g @kitlangton/ghui
```

The npm package also installs a platform-specific binary package and does not require Bun.

Requirements:

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

- `GHUI_PR_FETCH_LIMIT`: max PRs fetched, defaults to `200`

Example:

```bash
GHUI_PR_FETCH_LIMIT=100 ghui
```

You can also copy `.env.example` to `.env` and edit the values locally.

ghui stores UI preferences in `config.json` under `GHUI_CONFIG_DIR` when set,
otherwise under the platform config directory. On Linux this is normally
`~/.config/ghui/config.json`.

Example:

```json
{
	"theme": "system",
	"systemThemeAutoReload": true
}
```

`systemThemeAutoReload` defaults to `false`. Set it to `true` to let external
theme reload signals update the active system theme palette while ghui is
running.

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
- `shift-r`: review or approve the selected pull request
- `up` / `down` / `pageup` / `pagedown`: move comment target while viewing a diff
- `enter`: open a commented diff line, or start a comment on an uncommented line
- `v`: start or clear a multi-line diff comment range
- `n` / `p`: jump between diff comment threads
- `f`: open the changed-files navigator while viewing a diff
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

Review submission:

- Press `shift-r` to open the review modal.
- Use `j` / `k` or `up` / `down` to choose Comment, Approve, or Request changes.
- Press `enter` to move to the optional summary area.
- Press `enter` again to submit, or `shift-enter` to insert a newline.
- Press `esc` from the summary to return to action selection; press `esc` from action selection to cancel.
