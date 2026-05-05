import { context } from "@ghui/keymap"

export interface DeleteReleaseModalCtx {
	readonly running: boolean
	readonly closeModal: () => void
	readonly confirmDelete: () => void
}

const DeleteRelease = context<DeleteReleaseModalCtx>()

export const deleteReleaseModalKeymap = DeleteRelease(
	{ id: "delete-release-modal.cancel", title: "Cancel", keys: ["escape"], run: (s) => s.closeModal() },
	{
		id: "delete-release-modal.confirm",
		title: "Delete release",
		keys: ["return"],
		enabled: (s) => (s.running ? "Already deleting." : true),
		run: (s) => s.confirmDelete(),
	},
)
