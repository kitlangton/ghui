import { context } from "@ghui/keymap"
import { countedVerticalBindings } from "./helpers.ts"
import type { WorkspaceSurface } from "../workspaceSurfaces.ts"

export interface ListNavCtx {
	readonly halfPage: number
	readonly visibleCount: number
	readonly hasFilter: boolean
	readonly activeSurface: WorkspaceSurface
	readonly surfaces: readonly WorkspaceSurface[]
	readonly canGoUpWorkspace: boolean
	readonly canScrollDetailPreview: boolean
	readonly runCommandById: (id: string) => void
	readonly openSelection: () => void
	readonly openRepositoryPicker: () => void
	readonly toggleFavoriteRepository: () => void
	readonly removeSelectedRepository: () => void
	readonly openFilterModal: () => void
	readonly goUpWorkspace: () => void
	readonly switchQueueMode: (delta: 1 | -1) => void
	readonly switchWorkspaceSurface: (surface: WorkspaceSurface) => void
	readonly cycleWorkspaceSurface: (delta: 1 | -1) => void
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
const itemSelected = (s: ListNavCtx) => (s.visibleCount > 0 ? true : "No item selected.")
const reposActive = (s: ListNavCtx) => s.activeSurface === "repos"
const filterableSurfaceActive = (s: ListNavCtx) => s.canGoUpWorkspace && (s.activeSurface === "pullRequests" || s.activeSurface === "issues")
const pullRequestsActive = (s: ListNavCtx) => s.activeSurface === "pullRequests"
const issuesActive = (s: ListNavCtx) => s.activeSurface === "issues"
const surfaceAt = (s: ListNavCtx, index: number) => s.surfaces[index] ?? null
const goHome = (s: ListNavCtx) => {
	if (s.canGoUpWorkspace) s.goUpWorkspace()
	else s.switchWorkspaceSurface("repos")
}

export const listNavKeymap = List(
	// Single-key command shortcuts (delegate to existing AppCommand registry)
	{ id: "workspace.first", title: "First surface", keys: ["1"], run: (s) => (surfaceAt(s, 0) ? s.switchWorkspaceSurface(surfaceAt(s, 0)!) : undefined) },
	{ id: "workspace.second", title: "Second surface", keys: ["2"], run: (s) => (surfaceAt(s, 1) ? s.switchWorkspaceSurface(surfaceAt(s, 1)!) : undefined) },
	{ id: "workspace.third", title: "Third surface", keys: ["3"], run: (s) => (surfaceAt(s, 2) ? s.switchWorkspaceSurface(surfaceAt(s, 2)!) : undefined) },
	{ id: "workspace.next-tab", title: "Next surface", keys: ["tab"], run: (s) => s.cycleWorkspaceSurface(1) },
	{ id: "workspace.prev-tab", title: "Previous surface", keys: ["shift+tab"], run: (s) => s.cycleWorkspaceSurface(-1) },
	{ id: "workspace.go-home", title: "Go home", keys: ["g h"], run: goHome },
	{ id: "workspace.go-repos", title: "Go to repositories", keys: ["g r"], run: goHome },
	{ id: "workspace.go-pulls", title: "Go to pull requests", keys: ["g p"], run: (s) => s.switchWorkspaceSurface("pullRequests") },
	{ id: "workspace.go-issues", title: "Go to issues", keys: ["g i"], run: (s) => s.switchWorkspaceSurface("issues") },
	{ id: "list.filter", title: "Filter", keys: ["/"], run: (s) => s.runCommandById("filter.open") },
	{ id: "list.add-repo", title: "Add repository", keys: ["a"], when: reposActive, run: (s) => s.openRepositoryPicker() },
	{ id: "list.favorite-repo", title: "Favorite repository", keys: ["f"], when: reposActive, run: (s) => s.toggleFavoriteRepository() },
	{ id: "list.scope-filter", title: "Filter items", keys: ["f"], when: filterableSurfaceActive, run: (s) => s.openFilterModal() },
	{ id: "list.remove-repo", title: "Remove repository", keys: ["x"], when: reposActive, run: (s) => s.removeSelectedRepository() },
	{ id: "list.refresh", title: "Refresh", keys: ["r"], when: pullRequestsActive, run: (s) => s.runCommandById("pull.refresh") },
	{ id: "list.refresh-issues", title: "Refresh issues", keys: ["r"], when: (s) => s.activeSurface === "issues", run: (s) => s.runCommandById("issue.refresh") },
	{ id: "list.theme", title: "Theme", keys: ["t"], run: (s) => s.runCommandById("theme.open") },
	{ id: "list.diff", title: "Open diff", keys: ["d"], when: pullRequestsActive, run: (s) => s.runCommandById("diff.open") },
	{ id: "list.comments", title: "Open comments", keys: ["c"], enabled: itemSelected, run: (s) => s.runCommandById("comments.open") },
	{ id: "list.review", title: "Review pull request", keys: ["shift+r"], when: pullRequestsActive, run: (s) => s.runCommandById("pull.submit-review") },
	{ id: "list.labels", title: "Labels", keys: ["l"], enabled: itemSelected, run: (s) => s.runCommandById("pull.labels") },
	{ id: "list.merge", title: "Merge", keys: ["m", "shift+m"], when: pullRequestsActive, run: (s) => s.runCommandById("pull.merge") },
	{ id: "list.close-pr", title: "Close PR", keys: ["x"], when: pullRequestsActive, run: (s) => s.runCommandById("pull.close") },
	{ id: "list.close-issue", title: "Close issue", keys: ["x"], when: issuesActive, run: (s) => s.runCommandById("issue.close") },
	{ id: "list.open-browser", title: "Open in browser", keys: ["o"], when: pullRequestsActive, run: (s) => s.runCommandById("pull.open-browser") },
	{ id: "list.issue-open-browser", title: "Open in browser", keys: ["o"], when: issuesActive, run: (s) => s.runCommandById("issue.open-browser") },
	{ id: "list.toggle-draft", title: "Toggle draft", keys: ["s", "shift+s"], when: pullRequestsActive, run: (s) => s.runCommandById("pull.toggle-draft") },
	{ id: "list.copy", title: "Copy metadata", keys: ["y"], when: pullRequestsActive, run: (s) => s.runCommandById("pull.copy-metadata") },
	{ id: "list.issue-copy", title: "Copy metadata", keys: ["y"], when: issuesActive, run: (s) => s.runCommandById("issue.copy-metadata") },
	{ id: "list.detail.open", title: "Open selected", keys: ["return"], enabled: itemSelected, run: (s) => s.openSelection() },

	// Escape goes one level up: clear local filter first, otherwise leave repo scope.
	{
		id: "workspace.escape",
		title: "Clear filter / go up workspace",
		keys: ["escape"],
		enabled: (s) => (s.hasFilter || s.canGoUpWorkspace ? true : "Already at top workspace."),
		run: (s) => {
			if (s.hasFilter) s.clearFilter()
			else s.goUpWorkspace()
		},
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
