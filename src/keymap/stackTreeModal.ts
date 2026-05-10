import { context } from "@ghui/keymap"

export interface StackTreeModalCtx {
	readonly hasResults: boolean
	readonly closeModal: () => void
	readonly selectPullRequest: () => void
	readonly moveSelection: (delta: -1 | 1) => void
	readonly moveSelectionPage: (delta: -1 | 1) => void
}

const StackTree = context<StackTreeModalCtx>()

export const stackTreeModalKeymap = StackTree(
	{ id: "stack-tree.close", title: "Close", keys: ["escape", "q", "b"], run: (s) => s.closeModal() },
	{
		id: "stack-tree.select",
		title: "Jump to pull request",
		keys: ["return"],
		enabled: (s) => (s.hasResults ? true : "No pull requests in this view."),
		run: (s) => s.selectPullRequest(),
	},
	{ id: "stack-tree.up", title: "Up", keys: ["k", "up", "ctrl+p", "ctrl+k"], run: (s) => s.moveSelection(-1) },
	{ id: "stack-tree.down", title: "Down", keys: ["j", "down", "ctrl+n", "ctrl+j"], run: (s) => s.moveSelection(1) },
	{ id: "stack-tree.page-up", title: "Page up", keys: ["pageup", "ctrl+u"], run: (s) => s.moveSelectionPage(-1) },
	{ id: "stack-tree.page-down", title: "Page down", keys: ["pagedown", "ctrl+d"], run: (s) => s.moveSelectionPage(1) },
)
