import { context } from "@ghui/keymap"

export interface PullRequestFilterModalCtx {
	readonly closeModal: () => void
	readonly confirmSelection: () => void
	readonly moveSelection: (delta: -1 | 1) => void
}

const PullRequestFilter = context<PullRequestFilterModalCtx>()

export const pullRequestFilterModalKeymap = PullRequestFilter(
	{ id: "pull-filter.cancel", title: "Cancel filter", keys: ["escape"], run: (s) => s.closeModal() },
	{ id: "pull-filter.up", title: "Move up", keys: ["up", "k"], run: (s) => s.moveSelection(-1) },
	{ id: "pull-filter.down", title: "Move down", keys: ["down", "j"], run: (s) => s.moveSelection(1) },
	{ id: "pull-filter.confirm", title: "Apply filter", keys: ["return"], run: (s) => s.confirmSelection() },
)
