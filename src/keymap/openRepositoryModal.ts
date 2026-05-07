import { context } from "@ghui/keymap"

export interface OpenRepositoryModalCtx {
	readonly closeModal: () => void
	readonly openFromInput: () => void
	readonly moveSelection: (delta: -1 | 1) => void
}

const OpenRepo = context<OpenRepositoryModalCtx>()

export const openRepositoryModalKeymap = OpenRepo(
	{ id: "open-repo.close", title: "Cancel", keys: ["escape"], run: (s) => s.closeModal() },
	{ id: "open-repo.open", title: "Open repository", keys: ["return"], run: (s) => s.openFromInput() },
	{ id: "open-repo.up", title: "Up", keys: ["k", "up", "ctrl+p", "ctrl+k"], run: (s) => s.moveSelection(-1) },
	{ id: "open-repo.down", title: "Down", keys: ["j", "down", "ctrl+n", "ctrl+j"], run: (s) => s.moveSelection(1) },
)
