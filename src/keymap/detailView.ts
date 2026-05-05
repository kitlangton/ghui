import { context, type Scrollable, scrollCommands } from "@ghui/keymap"

export interface DetailViewCtx extends Scrollable {
	readonly closeDetail: () => void
	readonly openTheme: () => void
	readonly openDiff: () => void
	readonly openComments: () => void
	readonly openReview: () => void
	readonly closePullRequest: () => void
	readonly openLabels: () => void
	readonly openMerge: () => void
	readonly toggleDraft: () => void
	readonly refresh: () => void
	readonly openInBrowser: () => void
	readonly copyMetadata: () => void
}

const Detail = context<DetailViewCtx>()

export const detailViewKeymap = Detail(
	scrollCommands<DetailViewCtx>(),
	{ id: "detail.close", title: "Close detail", keys: ["escape", "return"], run: (s) => s.closeDetail() },
	{ id: "detail.theme", title: "Open theme", keys: ["t"], run: (s) => s.openTheme() },
	{ id: "detail.diff", title: "Open diff", keys: ["d"], run: (s) => s.openDiff() },
	{ id: "detail.comments", title: "Open comments", keys: ["c"], run: (s) => s.openComments() },
	{ id: "detail.review", title: "Review pull request", keys: ["shift+r"], run: (s) => s.openReview() },
	{ id: "detail.close-pr", title: "Close pull request", keys: ["x"], run: (s) => s.closePullRequest() },
	{ id: "detail.labels", title: "Manage labels", keys: ["l"], run: (s) => s.openLabels() },
	{ id: "detail.merge", title: "Merge", keys: ["m", "shift+m"], run: (s) => s.openMerge() },
	{ id: "detail.toggle-draft", title: "Toggle draft", keys: ["s", "shift+s"], run: (s) => s.toggleDraft() },
	{ id: "detail.refresh", title: "Refresh", keys: ["r"], run: (s) => s.refresh() },
	{ id: "detail.open-browser", title: "Open in browser", keys: ["o"], run: (s) => s.openInBrowser() },
	{ id: "detail.copy", title: "Copy metadata", keys: ["y"], run: (s) => s.copyMetadata() },
)
