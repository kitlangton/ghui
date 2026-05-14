---
"@kitlangton/ghui": patch
---

Fix two stalemate bugs that left views stuck on Loading or empty:

- Diff and PR-detail fetches now time out after 30s instead of dangling indefinitely when the underlying family-created atom is interrupted or GC'd before settling — the pane transitions to an error state with a retry hint instead of wedging on "Loading…".
- The PR and issue queue caches no longer overwrite a non-empty entry with an empty fetch result, and won't persist empty results to SQLite. Transient gh stalls / rate limits that return `[]` for a repo with real PRs no longer get cached as authoritative "No open pull requests".
