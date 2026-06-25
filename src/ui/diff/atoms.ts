import { Effect } from "effect"
import * as Atom from "effect/unstable/reactivity/Atom"
import type { DiffCommentSide, PullRequestReviewComment } from "../../domain.js"
import { loadStoredDiffWhitespaceMode } from "../../themeStore.js"
import { GitHubService } from "../../services/GitHubService.js"
import { githubRuntime } from "../../services/runtime.js"
import { parsePullRequestRevisionAtomKey, selectedPullRequestAtom } from "../pullRequests/atoms.js"
import {
	type DiffFilePatch,
	type DiffView,
	type DiffWhitespaceMode,
	type DiffWrapMode,
	minimizeWhitespaceDiffFiles,
	type PullRequestDiffState,
	pullRequestDiffKey,
} from "../diff.js"

export const initialDiffWhitespaceMode = await Effect.runPromise(loadStoredDiffWhitespaceMode)

// === UI state atoms ===
export const diffFullViewAtom = Atom.make(false)
export const diffFileIndexAtom = Atom.make(0)
export const diffScrollTopAtom = Atom.make(0)
export const diffRenderViewAtom = Atom.make<DiffView>("split")
export const diffWrapModeAtom = Atom.make<DiffWrapMode>("none")
export const diffWhitespaceModeAtom = Atom.make<DiffWhitespaceMode>(initialDiffWhitespaceMode)
// Tri-state for the docked file panel. `null` means "auto" — visible whenever
// the diff is in full-view AND the terminal is wide enough. Explicit `true` or
// `false` is a sticky user override (toggled with shift+f) that survives
// resize so the user gets the layout they asked for.
export const diffFilePanelOverrideAtom = Atom.make<boolean | null>(null).pipe(Atom.keepAlive)
// Auto-visibility threshold in cols. Picked so the diff still gets ~100 cols
// of usable width once the (min-sized) panel is subtracted. The width
// calculation itself lives in `workspace/layout.ts` (side-effect-free).
export const DIFF_FILE_PANEL_AUTO_THRESHOLD = 130
export const diffCommentAnchorIndexAtom = Atom.make(0)
export const diffPreferredSideAtom = Atom.make<DiffCommentSide | null>(null)
export const diffCommentRangeStartIndexAtom = Atom.make<number | null>(null)
export const diffCommentThreadsAtom = Atom.make<Record<string, readonly PullRequestReviewComment[]>>({}).pipe(Atom.keepAlive)
export const diffCommentsLoadedAtom = Atom.make<Record<string, "loading" | "ready">>({}).pipe(Atom.keepAlive)
export const pullRequestDiffCacheAtom = Atom.make<Record<string, PullRequestDiffState>>({}).pipe(Atom.keepAlive)

// Diff and review-comment requests are keyed by PR revision so concurrent
// HOME prefetches have distinct Effect lifetimes and result channels.
export const pullRequestDiffForRevision = Atom.family((revisionKey: string) => {
	const { repository, number } = parsePullRequestRevisionAtomKey(revisionKey, "diff")
	return githubRuntime.atom(GitHubService.use((github) => github.getPullRequestDiff(repository, number))).pipe(Atom.setIdleTTL(0))
})

export const pullRequestReviewCommentsForRevision = Atom.family((revisionKey: string) => {
	const { repository, number } = parsePullRequestRevisionAtomKey(revisionKey, "review comments")
	return githubRuntime.atom(GitHubService.use((github) => github.listPullRequestReviewComments(repository, number))).pipe(Atom.setIdleTTL(0))
})

// === Derived selection atoms ===
export const selectedDiffKeyAtom = Atom.make((get) => {
	const pullRequest = get(selectedPullRequestAtom)
	return pullRequest ? pullRequestDiffKey(pullRequest) : null
})

export const selectedDiffStateAtom = Atom.make((get) => {
	const key = get(selectedDiffKeyAtom)
	if (!key) return undefined
	return get(pullRequestDiffCacheAtom)[key]
})

export const diffReadyAtom = Atom.make((get) => get(selectedDiffStateAtom)?._tag === "Ready")

// The files we'd actually render once the diff is loaded — empty if the diff
// isn't Ready, optionally minimized when the user has whitespace-ignore on.
// Promoting this means the diff pane and useDiffViewActions don't both have to
// recompute the same `state._tag === "Ready" ? maybeMinimize(state.files) : []`.
export const readyDiffFilesAtom = Atom.make((get): readonly DiffFilePatch[] => {
	const state = get(selectedDiffStateAtom)
	if (state?._tag !== "Ready") return []
	return get(diffWhitespaceModeAtom) === "ignore" ? minimizeWhitespaceDiffFiles(state.files) : state.files
})
