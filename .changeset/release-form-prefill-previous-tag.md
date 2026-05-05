---
"@kitlangton/ghui": patch
---

Prefill the tag field of the new-release form with the latest release's tag and surface it in the subtitle ("previous: vX.Y.Z"). Cuts the version-bump path down to a single backspace + edit. Falls back gracefully if the repo has no releases yet, and reuses the cached latest release from the open releases overlay so the prefill is instant.
