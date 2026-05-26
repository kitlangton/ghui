---
"@kitlangton/ghui": patch
---

Fix a stalemate bug that left views stuck on Loading:

- Diff and PR-detail fetches now time out after 30s instead of dangling indefinitely when the underlying family-created atom is interrupted or GC'd before settling — the pane transitions to an error state with a retry hint instead of wedging on "Loading…".
