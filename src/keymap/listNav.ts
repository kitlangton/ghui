import { context } from "@ghui/keymap"
import { countedVerticalBindings } from "./helpers.ts"

export interface ListNavCtx {
	readonly halfPage: number
	readonly visibleCount: number
	readonly hasFilter: boolean
	readonly canScrollDetailPreview: boolean
	readonly runCommandById: (id: string) => void
	readonly switchQueueMode: (delta: 1 | -1) => void
	readonly scrollDetailPreviewBy: (delta: number) => void
	readonly scrollDetailPreviewTo: (line: number) => void
	readonly clearFilter: () => void
	readonly stepSelected: (delta: number) => void
	readonly stepSelectedUp: (count?: number) => void
	readonly stepSelectedDown: (count?: number) => void
	readonly stepSelectedUpWrap: () => void
	readonly stepSelectedDownWithLoadMore: () => void
	readonly moveSelectedToPreviousGroup: () => void
	readonly moveSelectedToNextGroup: () => void
	readonly setSelected: (index: number) => void
}

const List = context<ListNavCtx>()

export const listNavKeymap = List(
	// Single-key command shortcuts (delegate to existing AppCommand registry)
	{ id: "list.filter", title: "Filter", keys: ["/"], run: (s) => s.runCommandById("filter.open") },
	{ id: "list.refresh", title: "Refresh", keys: ["r"], run: (s) => s.runCommandById("pull.refresh") },
	{ id: "list.theme", title: "Theme", keys: ["t"], run: (s) => s.runCommandById("theme.open") },
	{ id: "list.diff", title: "Open diff", keys: ["d"], run: (s) => s.runCommandById("diff.open") },
	{ id: "list.comments", title: "Open comments", keys: ["c"], run: (s) => s.runCommandById("comments.open") },
	{ id: "list.review", title: "Review pull request", keys: ["shift+r"], run: (s) => s.runCommandById("pull.submit-review") },
	{ id: "list.labels", title: "Labels", keys: ["l"], run: (s) => s.runCommandById("pull.labels") },
	{ id: "list.merge", title: "Merge", keys: ["m", "shift+m"], run: (s) => s.runCommandById("pull.merge") },
	{ id: "list.close-pr", title: "Close PR", keys: ["x"], run: (s) => s.runCommandById("pull.close") },
	{ id: "list.open-browser", title: "Open in browser", keys: ["o"], run: (s) => s.runCommandById("pull.open-browser") },
	{ id: "list.toggle-draft", title: "Toggle draft", keys: ["s", "shift+s"], run: (s) => s.runCommandById("pull.toggle-draft") },
	{ id: "list.copy", title: "Copy metadata", keys: ["y"], run: (s) => s.runCommandById("pull.copy-metadata") },
	{ id: "list.detail.open", title: "Open details", keys: ["return"], run: (s) => s.runCommandById("detail.open") },

	// Queue mode tabs
	{ id: "list.next-tab", title: "Next view", keys: ["tab"], run: (s) => s.switchQueueMode(1) },
	{ id: "list.prev-tab", title: "Previous view", keys: ["shift+tab"], run: (s) => s.switchQueueMode(-1) },

	// Escape clears filter only when one is set
	{
		id: "list.clear-filter",
		title: "Clear filter",
		keys: ["escape"],
		enabled: (s) => (s.hasFilter ? true : "No filter to clear."),
		run: (s) => s.clearFilter(),
	},

	// Wide-layout detail preview scroll
	{
		id: "list.preview.top",
		title: "Detail preview top",
		keys: ["home"],
		enabled: (s) => (s.canScrollDetailPreview ? true : "Detail preview not visible."),
		run: (s) => s.scrollDetailPreviewTo(0),
	},
	{
		id: "list.preview.bottom",
		title: "Detail preview bottom",
		keys: ["end"],
		enabled: (s) => (s.canScrollDetailPreview ? true : "Detail preview not visible."),
		run: (s) => s.scrollDetailPreviewTo(Number.MAX_SAFE_INTEGER),
	},
	{
		id: "list.preview.half-up",
		title: "Detail preview ½ up",
		keys: ["pageup"],
		enabled: (s) => (s.canScrollDetailPreview ? true : "Detail preview not visible."),
		run: (s) => s.scrollDetailPreviewBy(-s.halfPage),
	},
	{
		id: "list.preview.half-down",
		title: "Detail preview ½ down",
		keys: ["pagedown"],
		enabled: (s) => (s.canScrollDetailPreview ? true : "Detail preview not visible."),
		run: (s) => s.scrollDetailPreviewBy(s.halfPage),
	},

	// Group jumps
	{
		id: "list.group-prev",
		title: "Previous group",
		keys: ["[", "meta+up", "meta+k", "shift+k"],
		run: (s) => s.moveSelectedToPreviousGroup(),
	},
	{
		id: "list.group-next",
		title: "Next group",
		keys: ["]", "meta+down", "meta+j", "shift+j"],
		run: (s) => s.moveSelectedToNextGroup(),
	},

	// Half-page steps
	{ id: "list.half-up", title: "Half page up", keys: ["ctrl+u"], run: (s) => s.stepSelected(-s.halfPage) },
	{ id: "list.half-down", title: "Half page down", keys: ["ctrl+d"], run: (s) => s.stepSelected(s.halfPage) },

	// Vim count prefixes
	...countedVerticalBindings<ListNavCtx>((s, delta) => {
		if (delta < 0) s.stepSelectedUp(-delta)
		else s.stepSelectedDown(delta)
	}),

	// Single-step (with wrap up, load-more on down)
	{ id: "list.up", title: "Up", keys: ["up", "k"], run: (s) => s.stepSelectedUpWrap() },
	{ id: "list.down", title: "Down", keys: ["down", "j"], run: (s) => s.stepSelectedDownWithLoadMore() },

	// Top / bottom
	{ id: "list.top", title: "Top", keys: ["g g"], run: (s) => s.setSelected(0) },
	{
		id: "list.bottom",
		title: "Bottom",
		keys: ["shift+g"],
		run: (s) => s.setSelected(s.visibleCount === 0 ? 0 : s.visibleCount - 1),
	},
)
