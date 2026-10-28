import { context } from "@ghui/keymap"
import { countedVerticalBindings } from "./helpers.ts"

// The runs view has two sub-modes that share one keymap layer:
//   - list (A): no run selected — `enter` opens a run, ↑↓ walks runs
//   - detail (B): a run selected — `enter` expands a step log, ↑↓ walks job/step rows
// `inDetail` switches which sub-mode the shared keys act on.

export interface RunsViewCtx {
	readonly halfPage: number
	readonly inDetail: boolean
	readonly handleEscape: () => void // back from detail → list, or close runs view
	readonly moveSelection: (delta: number) => void
	readonly moveSelectionToBoundary: (boundary: "first" | "last") => void
	readonly openSelected: () => void // list: open run; detail: expand/collapse step log
	readonly nextFailure: () => void
	readonly previousFailure: () => void
	readonly refresh: () => void
	readonly openInBrowser: () => void
}

const Runs = context<RunsViewCtx>()

export const runsViewKeymap = Runs(
	{ id: "runs.escape", title: "Back / close runs", keys: ["escape"], run: (s) => s.handleEscape() },
	{ id: "runs.open", title: "Open run / expand log", keys: ["return", "right", "l"], run: (s) => s.openSelected() },

	{ id: "runs.half-up", title: "Half page up", keys: ["pageup", "ctrl+u"], run: (s) => s.moveSelection(-s.halfPage) },
	{ id: "runs.half-down", title: "Half page down", keys: ["pagedown", "ctrl+d"], run: (s) => s.moveSelection(s.halfPage) },
	{ id: "runs.page-up", title: "Page up", keys: ["ctrl+b"], run: (s) => s.moveSelection(-2 * s.halfPage) },
	{ id: "runs.page-down", title: "Page down", keys: ["ctrl+f"], run: (s) => s.moveSelection(2 * s.halfPage) },

	...countedVerticalBindings<RunsViewCtx>((s, delta) => s.moveSelection(delta)),

	{ id: "runs.up", title: "Up", keys: ["up", "k"], run: (s) => s.moveSelection(-1) },
	{ id: "runs.down", title: "Down", keys: ["down", "j"], run: (s) => s.moveSelection(1) },

	{ id: "runs.next-failure", title: "Next failure", keys: ["n"], run: (s) => s.nextFailure() },
	{ id: "runs.previous-failure", title: "Previous failure", keys: ["p"], run: (s) => s.previousFailure() },

	{ id: "runs.first", title: "First", keys: ["g g"], run: (s) => s.moveSelectionToBoundary("first") },
	{ id: "runs.last", title: "Last", keys: ["shift+g"], run: (s) => s.moveSelectionToBoundary("last") },

	{ id: "runs.refresh", title: "Refresh runs", keys: ["r"], run: (s) => s.refresh() },
	{ id: "runs.open-browser", title: "Open in browser", keys: ["o"], run: (s) => s.openInBrowser() },
)
