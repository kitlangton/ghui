// Exercise the full atom pipeline outside the TUI:
//   activeViewAtom -> pullRequestsAtom -> queueLoadCacheAtom
//                                       -> pullRequestLoadAtom
//                                       -> displayedPullRequestsAtom
//                                       -> filteredPullRequestsAtom
//                                       -> visiblePullRequestsAtom
//
// Steps:
//   1. Set activeView to Repository view (all PRs) and resolve.
//   2. Switch activeView to Queue authored and resolve.
//   3. Print what each atom contains AFTER the switch.
//
// If visiblePullRequestsAtom contains 50+ PRs from various authors after
// step 2, we've reproduced the bug in headless mode and can diff each
// atom's state to find where the broken data is coming from.
//
// Logs to /tmp/ghui-debug.log (default GHUI_DEBUG_LOG path) so the
// devLog instrumentation in atoms.ts fires.

process.env.GHUI_DEBUG_LOG ??= "/tmp/ghui-debug.log"

import * as Atom from "effect/unstable/reactivity/Atom"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { activeViewAtom, displayedPullRequestsAtom, pullRequestsForView, queueLoadCacheAtom, resolveLoad, visiblePullRequestsAtom } from "../src/ui/pullRequests/atoms.js"
import { filteredPullRequestsAtom } from "../src/ui/pullRequests/atoms.js"
import type { PullRequestView } from "../src/pullRequestViews.js"
import { viewCacheKey } from "../src/pullRequestViews.js"

const REPO = process.argv[2] ?? "anomalyco/opencode"

const repositoryView: PullRequestView = { _tag: "Repository", repository: REPO }
const authoredView: PullRequestView = { _tag: "Queue", mode: "authored", repository: REPO }

const registry = AtomRegistry.make()

// Wait for an atom's AsyncResult to settle (success or failure).
const waitForResult = <A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>): Promise<AsyncResult.AsyncResult<A, E>> =>
	new Promise((resolve) => {
		const initial = registry.get(atom)
		if (!initial.waiting && (AsyncResult.isSuccess(initial) || AsyncResult.isFailure(initial))) {
			resolve(initial)
			return
		}
		const unsub = registry.subscribe(atom, (value) => {
			if (!value.waiting && (AsyncResult.isSuccess(value) || AsyncResult.isFailure(value))) {
				unsub()
				resolve(value)
			}
		})
	})

const sample = (label: string) => {
	const view = registry.get(activeViewAtom)
	const result = registry.get(pullRequestsForView(view))
	const cache = registry.get(queueLoadCacheAtom)
	const load = resolveLoad(view, cache, result)
	const displayed = registry.get(displayedPullRequestsAtom)
	const filtered = registry.get(filteredPullRequestsAtom)
	const visible = registry.get(visiblePullRequestsAtom)
	console.log(`\n=== ${label} ===`)
	console.log("activeView:           ", view)
	console.log("activeView cacheKey:  ", viewCacheKey(view))
	console.log("pullRequestsAtom:     ", { waiting: result.waiting, kind: result._tag })
	const resolved = AsyncResult.getOrElse(result, () => null)
	console.log("  resolved view:       ", resolved?.view)
	console.log("  resolved cacheKey:   ", resolved ? viewCacheKey(resolved.view) : null)
	console.log("  resolved dataLen:    ", resolved?.data.length ?? null)
	console.log("queueLoadCacheAtom keys:", Object.keys(cache))
	for (const [k, v] of Object.entries(cache)) {
		console.log(`  [${k}] dataLen=${v?.data.length} sampleAuthors=${JSON.stringify(v?.data.slice(0, 3).map((pr) => pr.author))}`)
	}
	console.log("resolveLoad:          ", load ? { view: load.view, dataLen: load.data.length, sampleAuthors: load.data.slice(0, 3).map((pr) => pr.author) } : null)
	console.log(
		"displayedPullRequests:",
		displayed.length,
		"sampleAuthors:",
		displayed.slice(0, 5).map((pr) => pr.author),
	)
	console.log(
		"filteredPullRequests: ",
		filtered.length,
		"sampleAuthors:",
		filtered.slice(0, 5).map((pr) => pr.author),
	)
	console.log(
		"visiblePullRequests:  ",
		visible.length,
		"sampleAuthors:",
		visible.slice(0, 5).map((pr) => pr.author),
	)
}

// Subscribe to displayedPullRequestsAtom to keep it active during transitions
// — this mimics what `useAtomValue(visiblePullRequestsAtom)` does in the React
// tree. Without an active subscriber, derived atoms may be GC'd between reads,
// which would mask any propagation bug.
const unsubDisplayed = registry.subscribe(displayedPullRequestsAtom, () => {})
const unsubVisible = registry.subscribe(visiblePullRequestsAtom, () => {})

// 1. Start in Queue authored global (the initial-view state ghui boots into).
const globalAuthored: PullRequestView = { _tag: "Queue", mode: "authored", repository: null }
console.log(">> Setting activeView to Queue(authored, global)")
registry.set(activeViewAtom, globalAuthored)
await waitForResult(pullRequestsForView(registry.get(activeViewAtom)))
sample("STEP 1: AFTER global authored fetch")

console.log("\n>> Switching activeView to Repository(anomalyco/opencode)")
registry.set(activeViewAtom, repositoryView)
await waitForResult(pullRequestsForView(registry.get(activeViewAtom)))
sample("STEP 2: AFTER Repository fetch")

console.log("\n>> Switching activeView to Queue(authored, anomalyco/opencode) — repro the bug")
registry.set(activeViewAtom, authoredView)
// Sample IMMEDIATELY (before fetch completes) to capture the transient state
// the user actually sees.
sample("STEP 3a: IMMEDIATELY AFTER set(authoredView)")
await waitForResult(pullRequestsForView(registry.get(activeViewAtom)))
sample("STEP 3b: AFTER Queue(authored) fetch")

unsubDisplayed()
unsubVisible()

console.log("\n>> Done. See /tmp/ghui-debug.log for atom-level trace.")
process.exit(0)
