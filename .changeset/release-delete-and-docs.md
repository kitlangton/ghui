---
"@kitlangton/ghui": minor
---

Add a delete-with-confirmation flow for releases (`shift-d` from the releases overlay or details panel) and document the new Releases mode in the README. The confirm modal calls out that deleting a published release leaves the underlying git tag in place, matching GitHub's behaviour.
