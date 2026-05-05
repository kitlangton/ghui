---
"@kitlangton/ghui": minor
---

Add a release form for cutting and editing GitHub releases. Open via "New release…" in the command palette or `n` (new) / `e` (edit) on the releases overlay. Fields cover tag, target branch, title, multi-line description (with multiline body editor), pre-release toggle, and the `make_latest` tri-state. `ctrl-g` generates release notes (only fills empty title/body, mirroring github.com), `ctrl-s` saves a draft, and `ctrl-↵` publishes; the same form covers updating an existing release. Default branch is fetched lazily for the target placeholder.
