---
"@kitlangton/ghui": patch
---

Fix merging pull requests into branches with a merge queue: avoid requesting branch deletion, keep queued pull requests open while refreshing, and report queue requests separately from completed merges. Admin merges still explicitly bypass the queue. Block merge confirmation after lookup failures.
