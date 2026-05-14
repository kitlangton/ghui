---
"@kitlangton/ghui": patch
---

Replace the dangling-prone family-of-runtime.atom pattern with `runtime.fn` for all one-shot fetches (diff, PR details). Eliminates the wedged "Loading…" state that could happen when the underlying AsyncResult got stuck in Waiting after a fiber interrupt — the runtime.fn pattern returns a normal Promise that always resolves or rejects.
