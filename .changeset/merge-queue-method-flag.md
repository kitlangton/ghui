---
"@kitlangton/ghui": patch
---

Let the merge queue choose the merge method: queue requests no longer pass `--squash`, `--merge`, or `--rebase` to `gh pr merge`. Admin merges that bypass the queue still use the selected method.
