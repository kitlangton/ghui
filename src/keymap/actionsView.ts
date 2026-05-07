import { context, type Scrollable, scrollCommands } from "@ghui/keymap"

export interface ActionsViewCtx extends Scrollable {
	readonly closeOrBack: () => void
	readonly confirmSelection: () => void
	readonly refresh: () => void
	readonly openInBrowser: () => void
	readonly stepBy: (delta: number) => void
	readonly toggleWrap: () => void
	readonly scrollHorizontal: (delta: number, halfPage?: boolean) => void
	readonly enterFilter: () => void
	readonly applyFilter: () => void
	readonly cancelFilter: () => void
	readonly filterActive: boolean
	readonly canFilterLogs: boolean
	readonly toggleGraphModal: () => void
	readonly canShowGraph: boolean
	readonly jumpToNextMatch: () => void
	readonly jumpToPreviousMatch: () => void
	readonly hasFilterQuery: boolean
}

const Actions = context<ActionsViewCtx>()

export const actionsViewKeymap = Actions(
	scrollCommands<ActionsViewCtx>(),
	{ id: "actions.previous-step", title: "Collapse step", keys: ["left", "h"], run: (s) => s.stepBy(-1) },
	{ id: "actions.next-step", title: "Expand step", keys: ["right", "l"], run: (s) => s.stepBy(1) },
	{ id: "actions.toggle-wrap", title: "Toggle log wrap", keys: ["w"], when: (s) => s.canFilterLogs && !s.filterActive, run: (s) => s.toggleWrap() },
	{ id: "actions.scroll-horizontal-left", title: "Scroll log left", keys: ["z h"], when: (s) => s.canFilterLogs && !s.filterActive, run: (s) => s.scrollHorizontal(-4) },
	{ id: "actions.scroll-horizontal-right", title: "Scroll log right", keys: ["z l"], when: (s) => s.canFilterLogs && !s.filterActive, run: (s) => s.scrollHorizontal(4) },
	{
		id: "actions.scroll-horizontal-half-left",
		title: "Scroll log half left",
		keys: ["z shift+h"],
		when: (s) => s.canFilterLogs && !s.filterActive,
		run: (s) => s.scrollHorizontal(-1, true),
	},
	{
		id: "actions.scroll-horizontal-half-right",
		title: "Scroll log half right",
		keys: ["z shift+l"],
		when: (s) => s.canFilterLogs && !s.filterActive,
		run: (s) => s.scrollHorizontal(1, true),
	},
	{ id: "actions.filter", title: "Filter logs", keys: ["/"], when: (s) => s.canFilterLogs && !s.filterActive, run: (s) => s.enterFilter() },
	{ id: "actions.cancel-filter", title: "Cancel log filter", keys: ["escape"], when: (s) => s.filterActive, run: (s) => s.cancelFilter() },
	{ id: "actions.apply-filter", title: "Apply log filter", keys: ["return"], when: (s) => s.filterActive, run: (s) => s.applyFilter() },
	{ id: "actions.next-match", title: "Next match", keys: ["n"], when: (s) => s.hasFilterQuery && !s.filterActive, run: (s) => s.jumpToNextMatch() },
	{ id: "actions.previous-match", title: "Previous match", keys: ["shift+n"], when: (s) => s.hasFilterQuery && !s.filterActive, run: (s) => s.jumpToPreviousMatch() },
	{ id: "actions.close", title: "Back / close actions", keys: ["escape", "a"], when: (s) => !s.filterActive, run: (s) => s.closeOrBack() },
	{ id: "actions.confirm", title: "Open selected action", keys: ["return"], when: (s) => !s.filterActive, run: (s) => s.confirmSelection() },
	{ id: "actions.refresh", title: "Refresh actions", keys: ["r"], when: (s) => !s.filterActive, run: (s) => s.refresh() },
	{ id: "actions.open-browser", title: "Open in browser", keys: ["o"], when: (s) => !s.filterActive, run: (s) => s.openInBrowser() },
	{ id: "actions.graph-modal", title: "Show graph", keys: ["s"], when: (s) => s.canShowGraph && !s.filterActive, run: (s) => s.toggleGraphModal() },
)
