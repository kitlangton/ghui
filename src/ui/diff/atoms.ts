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
export const diffCommentAnchorIndexAtom = Atom.make(0)
export const diffPreferredSideAtom = Atom.make<DiffCommentSide | null>(null)
export const diffCommentRangeStartIndexAtom = Atom.make<number | null>(null)
export const diffCommentThreadsAtom = Atom.make<Record<string, readonly PullRequestReviewComment[]>>({}).pipe(Atom.keepAlive)
export const diffCommentsLoadedAtom = Atom.make<Record<string, "loading" | "ready">>({}).pipe(Atom.keepAlive)
export const pullRequestDiffCacheAtom = Atom.make<Record<string, PullRequestDiffState>>({}).pipe(Atom.keepAlive)

// === Data-fetching atoms ===
export const pullRequestDiffAtom = Atom.family((key: string) => {
	const { repository, number } = parsePullRequestRevisionAtomKey(key, "diff")
	return githubRuntime.atom(GitHubService.use((github) => github.getPullRequestDiff(repository, number)))
})

export const listPullRequestReviewCommentsAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number }>()((input) =>
	GitHubService.use((github) => github.listPullRequestReviewComments(input.repository, input.number)),
)

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
