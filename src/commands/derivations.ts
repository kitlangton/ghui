import * as Atom from "effect/unstable/reactivity/Atom"
import type { PullRequestUserQueueMode } from "../domain.js"
import { type PullRequestView, viewEquals, viewLabel } from "../pullRequestViews.js"
import { commentsViewActiveAtom } from "../ui/comments/atoms.js"
import { detailFullViewAtom } from "../ui/detail/atoms.js"
import { diffFullViewAtom, diffReadyAtom } from "../ui/diff/atoms.js"
import { filterModeAtom, filterQueryAtom } from "../ui/filter/atoms.js"
import { selectedIssueAtom } from "../ui/issues/atoms.js"
import {
	activeViewAtom,
	isLoadingMorePullRequestsAtom,
	loadedPullRequestCountAtom,
	pullRequestLoadMoreSlotAvailableAtom,
	pullRequestStatusAtom,
	selectedPullRequestAtom,
} from "../ui/pullRequests/atoms.js"
import { selectedRepositoryAtom, workspaceSurfaceAtom } from "../workspace/atoms.js"
import { type WorkspaceSurface, workspaceSurfaceLabels } from "../workspaceSurfaces.js"
import { commandRuntimeAtom } from "./runtimeAtom.js"

// Shared derivations that command titles / subtitles / disabledReason fields
// read from. Centralising them here means a command's data declaration stays
// short (just `disabledReason: pullRequestSurfaceReasonAtom`) and any future
// command can compose the same gating without redoing the logic.

export const activeSurfaceLabelAtom = Atom.make((get) => workspaceSurfaceLabels[get(workspaceSurfaceAtom)].toLowerCase())

// `null` when the pull request surface is active. Otherwise a sentence telling
// the user that PR commands won't run in the current surface. Used as the
// base layer for every PR-specific command's disabled chain.
export const pullRequestSurfaceReasonAtom = Atom.make((get) => (get(workspaceSurfaceAtom) === "pullRequests" ? null : "Pull request surface is not active."))

// Layered reason chains, mirroring the structure that lived in
// appCommands.ts. Each is `null` when the command can run; otherwise the
// first applicable explanation flows through.
export const noPullRequestReasonAtom = Atom.make((get): string | null => {
	const surface = get(pullRequestSurfaceReasonAtom)
	if (surface !== null) return surface
	return get(selectedPullRequestAtom) ? null : "Select a pull request first."
})

export const noOpenPullRequestReasonAtom = Atom.make((get): string | null => {
	const surface = get(pullRequestSurfaceReasonAtom)
	if (surface !== null) return surface
	const pr = get(selectedPullRequestAtom)
	if (pr) return pr.state === "open" ? null : "Pull request is not open."
	return "Select a pull request first."
})

export const noSelectedItemReasonAtom = Atom.make((get): string | null => {
	if (get(workspaceSurfaceAtom) === "issues") return get(selectedIssueAtom) ? null : "Select an issue first."
	return get(noPullRequestReasonAtom)
})

export const filterClearDisabledReasonAtom = Atom.make((get) => (get(filterQueryAtom).length > 0 || get(filterModeAtom) ? null : "No filter is active."))

export const detailCloseDisabledReasonAtom = Atom.make((get) => (get(detailFullViewAtom) ? null : "Details view is not open."))

export const diffOpenRequiredReasonAtom = Atom.make((get) => (get(diffFullViewAtom) ? null : "Open a diff first."))

export const diffCloseDisabledReasonAtom = Atom.make((get) => (get(diffFullViewAtom) ? null : "Diff view is not open."))

export const commentsViewActiveReasonAtom = Atom.make((get) => (get(commentsViewActiveAtom) ? null : "Open comments first."))

export const pullRequestRefreshTitleAtom = Atom.make((get) => (get(pullRequestStatusAtom) === "error" ? "Retry loading pull requests" : "Refresh pull requests"))

export const filterTitleAtom = Atom.make((get) => `Filter ${get(activeSurfaceLabelAtom)}`)

export const repositoryOpenSubtitleAtom = Atom.make((get) => {
	const repo = get(selectedRepositoryAtom)
	return repo ? `Current repository: ${repo}` : "Enter owner/name or a GitHub URL"
})

// Item-label derivations used as subtitles for selection-dependent commands.
export const selectedPullRequestLabelAtom = Atom.make((get) => {
	const pr = get(selectedPullRequestAtom)
	return pr ? `#${pr.number} ${pr.repository}` : "No pull request selected"
})

export const selectedIssueLabelAtom = Atom.make((get) => {
	const issue = get(selectedIssueAtom)
	return issue ? `#${issue.number} ${issue.repository}` : "No issue selected"
})

export const selectedItemLabelAtom = Atom.make((get) => (get(workspaceSurfaceAtom) === "issues" ? get(selectedIssueLabelAtom) : get(selectedPullRequestLabelAtom)))

// Workspace surface helpers — generated per surface so commands can be data.
export const workspaceSurfaceAlreadyActiveReasonAtom = (surface: WorkspaceSurface): Atom.Atom<string | null> =>
	Atom.make((get) => (get(workspaceSurfaceAtom) === surface ? "Already showing this surface." : null))

export const workspaceSurfaceSubtitleAtom = (surface: WorkspaceSurface): Atom.Atom<string> =>
	Atom.make((get) => (get(workspaceSurfaceAtom) === surface ? "Already showing this surface" : "Switch project surface"))

// Issue-only commands need a slightly different gating: only enabled when the
// issues surface is active *and* there's a selected issue.
export const issueSelectedReasonAtom = Atom.make((get) => (get(workspaceSurfaceAtom) === "issues" && get(selectedIssueAtom) ? null : "Select an issue first."))

// Whichever item is currently focused for comment-style operations: issue on
// the issues surface, PR on the PR surface, null otherwise. Used as a target
// for modal seeding (labels, new comment) without re-deriving in every command.
export const selectedCommentSubjectAtom = Atom.make((get) => {
	const surface = get(workspaceSurfaceAtom)
	if (surface === "issues") return get(selectedIssueAtom)
	if (surface === "pullRequests") return get(selectedPullRequestAtom)
	return null
})

// Load-more gating: enabled only when we're on the PR surface, there are more
// pages, and a fetch isn't already in flight.
export const loadMoreDisabledReasonAtom = Atom.make((get) => {
	const surface = get(pullRequestSurfaceReasonAtom)
	if (surface !== null) return surface
	if (get(isLoadingMorePullRequestsAtom)) return "Already loading more pull requests."
	if (!get(pullRequestLoadMoreSlotAvailableAtom)) return "No more pull requests available in this view."
	return null
})

export const loadMoreSubtitleAtom = Atom.make((get) => `${get(loadedPullRequestCountAtom)} loaded`)

// === Diff cluster ===
// `diffReadyReason`: PR-scoped guard before any diff command can run.
export const diffReadyReasonAtom = Atom.make((get): string | null => {
	const pr = get(selectedPullRequestAtom)
	if (!pr) return get(noPullRequestReasonAtom)
	return get(diffReadyAtom) ? null : "Load the diff before running this command."
})

// `diffOpenReady`: requires diff full-view open *and* diff loaded.
export const diffOpenReadyReasonAtom = Atom.make((get): string | null => {
	if (!get(diffFullViewAtom)) return "Open a diff first."
	return get(diffReadyReasonAtom)
})

// `diff.reload` only needs the diff to be open with a PR selected; we don't
// require the diff to be parsed since reload IS what loads it.
export const diffReloadDisabledReasonAtom = Atom.make((get) => (get(diffFullViewAtom) && get(selectedPullRequestAtom) ? null : "Open a pull request diff first."))

export const selectedDiffLineReasonAtom = Atom.make((get): string | null => {
	const upstream = get(diffOpenReadyReasonAtom)
	if (upstream !== null) return upstream
	return get(commandRuntimeAtom).selectedDiffCommentAnchorLabel ? null : "No diff line selected."
})

export const diffThreadReasonAtom = Atom.make((get): string | null => {
	const upstream = get(diffOpenReadyReasonAtom)
	if (upstream !== null) return upstream
	return get(commandRuntimeAtom).hasDiffCommentThreads ? null : "No diff comments loaded."
})

export const changedFilesReasonAtom = Atom.make((get): string | null => {
	const upstream = get(diffOpenReadyReasonAtom)
	if (upstream !== null) return upstream
	return get(commandRuntimeAtom).readyDiffFileCount > 0 ? null : "No changed files loaded."
})

export const selectedDiffCommentAnchorLabelAtom = Atom.make((get) => get(commandRuntimeAtom).selectedDiffCommentAnchorLabel)

// Subtitle helper for "next/previous file" — "5/12" or "No diff files loaded".
export const diffFileSubtitleAtom = Atom.make((get) => {
	const { readyDiffFileCount, diffFileIndex } = get(commandRuntimeAtom)
	return readyDiffFileCount > 0 ? `${diffFileIndex + 1}/${readyDiffFileCount}` : "No diff files loaded"
})

// "x changed files" / "No diff files loaded" subtitle for the navigator.
export const changedFilesSubtitleAtom = Atom.make((get) => {
	const { readyDiffFileCount } = get(commandRuntimeAtom)
	return readyDiffFileCount > 0 ? `${readyDiffFileCount} changed files` : "No diff files loaded"
})

export const diffThreadSubtitleAtom = Atom.make((get) => {
	const { hasDiffCommentThreads } = get(commandRuntimeAtom)
	return hasDiffCommentThreads ? "Jump to the next commented line" : "No diff comments loaded"
})

// `diff.open-comment-target` title flips when a thread already exists at the
// selected anchor — we open the thread vs. start a new comment.
export const diffOpenCommentTargetTitleAtom = Atom.make((get) =>
	get(commandRuntimeAtom).selectedDiffCommentThreadCount > 0 ? "Open selected diff thread" : "Comment on selected diff line",
)

export const diffToggleRangeTitleAtom = Atom.make((get) => (get(commandRuntimeAtom).diffRangeActive ? "Clear diff comment range" : "Start diff comment range"))

export const diffCommentAnchorSubtitleAtom = Atom.make((get) => get(commandRuntimeAtom).selectedDiffCommentAnchorLabel ?? "No diff line selected")

// === Comment cluster ===
export const selectedCommentReasonAtom = Atom.make((get): string | null => {
	const upstream = get(noSelectedItemReasonAtom)
	if (upstream !== null) return upstream
	if (!get(commentsViewActiveAtom)) return "Open comments first."
	return get(commandRuntimeAtom).hasSelectedComment ? null : "No comment selected."
})

export const ownCommentReasonAtom = Atom.make((get): string | null => {
	const upstream = get(selectedCommentReasonAtom)
	if (upstream !== null) return upstream
	return get(commandRuntimeAtom).canEditSelectedComment ? null : "Only your own (synced) comments can be edited or deleted."
})

// === View switches ===
// Each `view.*` command compares against the *current* activeView, with the
// target view reconstructed on the fly from selectedRepository + the mode
// the command represents. Static targets won't work here because the
// repository scope depends on runtime state.

// Probe view: build the target view for a given queue-mode command.
const queueViewFor = (mode: PullRequestUserQueueMode, repository: string | null): PullRequestView => ({ _tag: "Queue", mode, repository })

export const queueViewAlreadyActiveReasonAtom = (mode: PullRequestUserQueueMode): Atom.Atom<string | null> =>
	Atom.make((get) => (viewEquals(get(activeViewAtom), queueViewFor(mode, get(selectedRepositoryAtom))) ? "Already showing this view." : null))

export const queueViewSubtitleAtom = (mode: PullRequestUserQueueMode): Atom.Atom<string> =>
	Atom.make((get) => (viewEquals(get(activeViewAtom), queueViewFor(mode, get(selectedRepositoryAtom))) ? "Already showing this view" : "Switch pull request view"))

export const queueViewTitleFor = (mode: PullRequestUserQueueMode): string => `Show ${viewLabel(queueViewFor(mode, null))} view`

// `view.repository`: when atom hides the command unless a repository is selected.
export const repositoryViewAvailableAtom = Atom.make((get) => get(selectedRepositoryAtom) !== null)
export const repositoryViewAlreadyActiveReasonAtom = Atom.make((get) => (get(activeViewAtom)._tag === "Repository" ? "Already showing this view." : null))
export const repositoryViewSubtitleAtom = Atom.make((get) => (get(activeViewAtom)._tag === "Repository" ? "Already showing this view" : "Switch pull request view"))
export const repositoryViewTitleAtom = Atom.make((get) => {
	const repo = get(selectedRepositoryAtom)
	return repo ? `Show ${repo} view` : "Show repository view"
})
