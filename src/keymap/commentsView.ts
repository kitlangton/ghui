import { context, type Scrollable, scrollCommands } from "@ghui/keymap"

export interface CommentsViewCtx extends Scrollable {
	readonly visibleCount: number
	readonly closeCommentsView: () => void
	readonly moveSelection: (delta: number) => void
	readonly setSelected: (index: number) => void
	readonly openInBrowser: () => void
	readonly refresh: () => void
}

const Comments = context<CommentsViewCtx>()

export const commentsViewKeymap = Comments(
	scrollCommands<CommentsViewCtx>(),
	{ id: "comments-view.close", title: "Close comments", keys: ["escape", "c"], run: (s) => s.closeCommentsView() },
	{ id: "comments-view.up", title: "Previous comment", keys: ["k", "up"], run: (s) => s.moveSelection(-1) },
	{ id: "comments-view.down", title: "Next comment", keys: ["j", "down"], run: (s) => s.moveSelection(1) },
	{ id: "comments-view.top", title: "First comment", keys: ["g g"], run: (s) => s.setSelected(0) },
	{
		id: "comments-view.bottom",
		title: "Last comment",
		keys: ["shift+g"],
		run: (s) => s.setSelected(Math.max(0, s.visibleCount - 1)),
	},
	{ id: "comments-view.open-browser", title: "Open in browser", keys: ["o"], run: (s) => s.openInBrowser() },
	{ id: "comments-view.refresh", title: "Refresh", keys: ["r"], run: (s) => s.refresh() },
)
