import { context } from "@ghui/keymap"

export interface ReleasesModalCtx {
	readonly panel: "list" | "details"
	readonly hasReleases: boolean
	readonly hasSelection: boolean
	readonly hasNextPage: boolean
	readonly loadingMore: boolean
	readonly closeOrBack: () => void
	readonly moveSelection: (delta: -1 | 1) => void
	readonly jumpSelection: (target: "top" | "bottom") => void
	readonly openDetails: () => void
	readonly scrollDetails: (delta: -1 | 1) => void
	readonly scrollDetailsPage: (delta: -1 | 1) => void
	readonly openInBrowser: () => void
	readonly copyUrl: () => void
	readonly refresh: () => void
	readonly loadMore: () => void
	readonly newRelease: () => void
	readonly editRelease: () => void
}

const Releases = context<ReleasesModalCtx>()

export const releasesModalKeymap = Releases(
	{ id: "releases.close-or-back", title: "Close / back", keys: ["escape"], run: (s) => s.closeOrBack() },
	{
		id: "releases.up",
		title: "Up",
		keys: ["k", "up", "ctrl+p", "ctrl+k"],
		run: (s) => (s.panel === "list" ? s.moveSelection(-1) : s.scrollDetails(-1)),
	},
	{
		id: "releases.down",
		title: "Down",
		keys: ["j", "down", "ctrl+n", "ctrl+j"],
		run: (s) => (s.panel === "list" ? s.moveSelection(1) : s.scrollDetails(1)),
	},
	{
		id: "releases.page-up",
		title: "Page up",
		keys: ["ctrl+u", "pageup"],
		when: (s) => s.panel === "details",
		run: (s) => s.scrollDetailsPage(-1),
	},
	{
		id: "releases.page-down",
		title: "Page down",
		keys: ["ctrl+d", "pagedown"],
		when: (s) => s.panel === "details",
		run: (s) => s.scrollDetailsPage(1),
	},
	{
		id: "releases.top",
		title: "Top",
		keys: ["g g"],
		when: (s) => s.panel === "list",
		run: (s) => s.jumpSelection("top"),
	},
	{
		id: "releases.bottom",
		title: "Bottom",
		keys: ["shift+g"],
		when: (s) => s.panel === "list",
		run: (s) => s.jumpSelection("bottom"),
	},
	{
		id: "releases.open-details",
		title: "View release",
		keys: ["return"],
		when: (s) => s.panel === "list",
		enabled: (s) => (s.hasSelection ? true : "No release selected."),
		run: (s) => s.openDetails(),
	},
	{
		id: "releases.open-browser",
		title: "Open in browser",
		keys: ["o"],
		enabled: (s) => (s.panel === "details" || s.hasSelection ? true : "No release selected."),
		run: (s) => s.openInBrowser(),
	},
	{
		id: "releases.copy-url",
		title: "Copy URL",
		keys: ["y"],
		enabled: (s) => (s.panel === "details" || s.hasSelection ? true : "No release selected."),
		run: (s) => s.copyUrl(),
	},
	{
		id: "releases.refresh",
		title: "Refresh",
		keys: ["r"],
		when: (s) => s.panel === "list",
		run: (s) => s.refresh(),
	},
	{
		id: "releases.load-more",
		title: "Load more",
		keys: ["]"],
		when: (s) => s.panel === "list",
		enabled: (s) => (s.loadingMore ? "Already loading more." : s.hasNextPage ? true : "No more releases."),
		run: (s) => s.loadMore(),
	},
	{
		id: "releases.new",
		title: "New release",
		keys: ["n"],
		when: (s) => s.panel === "list",
		run: (s) => s.newRelease(),
	},
	{
		id: "releases.edit",
		title: "Edit release",
		keys: ["e"],
		when: (s) => s.panel === "list",
		enabled: (s) => (s.hasSelection ? true : "No release selected."),
		run: (s) => s.editRelease(),
	},
)
