// Bridge between command Effects and hook-bound imperative actions.
//
// Some commands run logic that genuinely can't flow through atoms:
//   - `preserveDiffLocation` reads a scrollbox.scrollTop synchronously
//     *before* the atom write that triggers re-render, so the snapshot
//     captures the pre-mutation state. Atoms only let us subscribe after.
//   - `quit` calls OpenTUI's renderer.destroy(); the renderer is the
//     React component's `useRenderer()` and has no atom counterpart.
//   - Modal openers like `openThemeModal` derive seed state from many
//     atoms + hook-local computed values (systemAppearance, themeId).
//
// Each command's React owner registers its imperative implementation here
// on mount; the command body calls `invokeHandoff` inside `Effect.sync`.
//
// Kept intentionally tiny (one shared slot map) so it's obvious that this
// is a side-channel, not a parallel registry. Commands whose run is
// atom-pure should not use this — they yield Atom.update/set directly.

type Handoff =
	| "preserveDiffLocation"
	| "quit"
	| "openThemeModal"
	| "openMergeModal"
	| "refreshPullRequests"
	| "loadMorePullRequests"
	| "openCommentsView"
	| "openReplyToSelectedComment"
	| "openEditSelectedComment"
	| "openDeleteSelectedComment"
	| "openDiffView"
	| "reloadDiff"
	| "openChangedFilesModal"
	| "toggleDiffFilePanel"
	| "jumpDiffFileNext"
	| "jumpDiffFilePrevious"
	| "moveDiffCommentThreadNext"
	| "moveDiffCommentThreadPrevious"
	| "openSelectedDiffComment"
	| "toggleDiffCommentRange"
	| "openDiffCommentModal"
	| "viewRepository"
	| "viewAuthored"
	| "viewReview"
	| "viewAssigned"
	| "viewMentioned"

const slots: Partial<Record<Handoff, () => void>> = {}

export const registerHandoff = (key: Handoff, fn: () => void): (() => void) => {
	slots[key] = fn
	return () => {
		if (slots[key] === fn) delete slots[key]
	}
}

export const invokeHandoff = (key: Handoff): void => {
	slots[key]?.()
}
