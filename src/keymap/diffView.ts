import { context } from "@ghui/keymap"
import { countedVerticalBindings } from "./helpers.ts"

export type DiffSide = "LEFT" | "RIGHT"
export type DiffAlign = "center" | "top" | "bottom"

export interface DiffViewCtx {
	readonly halfPage: number
	readonly handleEscape: () => void // closes diff, or clears comment range if active
	readonly openSelectedComment: () => void
	readonly toggleRange: () => void
	readonly toggleView: () => void
	readonly toggleWrap: () => void
	readonly reload: () => void
	readonly nextThread: () => void
	readonly previousThread: () => void
	readonly nextHunk: () => void
	readonly previousHunk: () => void
	readonly copyHunk: () => void
	readonly copyFileDiff: () => void
	readonly moveAnchor: (delta: number, opts?: { preserveViewportRow?: boolean }) => void
	readonly moveAnchorToBoundary: (boundary: "first" | "last") => void
	readonly alignAnchor: (align: DiffAlign) => void
	readonly selectSide: (side: DiffSide) => void
	readonly openChangedFiles: () => void
	readonly openSubmitReview: () => void
	readonly nextFile: () => void
	readonly previousFile: () => void
	readonly openInBrowser: () => void
}

const Diff = context<DiffViewCtx>()

export const diffViewKeymap = Diff(
	{ id: "diff.escape", title: "Close diff / clear range", keys: ["escape"], run: (s) => s.handleEscape() },
	{ id: "diff.open-comment", title: "Open / add comment", keys: ["return"], run: (s) => s.openSelectedComment() },
	{ id: "diff.toggle-range", title: "Toggle comment range", keys: ["v"], run: (s) => s.toggleRange() },
	{ id: "diff.toggle-view", title: "Toggle split/unified", keys: ["shift+v"], run: (s) => s.toggleView() },
	{ id: "diff.toggle-wrap", title: "Toggle wrap", keys: ["w"], run: (s) => s.toggleWrap() },
	{ id: "diff.reload", title: "Reload diff", keys: ["r"], run: (s) => s.reload() },
	{ id: "diff.next-thread", title: "Next thread", keys: ["n"], run: (s) => s.nextThread() },
	{ id: "diff.previous-thread", title: "Previous thread", keys: ["p"], run: (s) => s.previousThread() },
	{ id: "diff.next-hunk", title: "Next hunk", keys: ["}"], run: (s) => s.nextHunk() },
	{ id: "diff.previous-hunk", title: "Previous hunk", keys: ["{"], run: (s) => s.previousHunk() },
	{ id: "diff.copy-hunk", title: "Copy hunk", keys: ["y"], run: (s) => s.copyHunk() },
	{ id: "diff.copy-file", title: "Copy file diff", keys: ["shift+y"], run: (s) => s.copyFileDiff() },

	// Half-page anchor moves preserve viewport row (true vim semantics)
	{
		id: "diff.half-up",
		title: "Half page up",
		keys: ["pageup", "ctrl+u"],
		run: (s) => s.moveAnchor(-s.halfPage, { preserveViewportRow: true }),
	},
	{
		id: "diff.half-down",
		title: "Half page down",
		keys: ["pagedown", "ctrl+d", "ctrl+v"],
		run: (s) => s.moveAnchor(s.halfPage, { preserveViewportRow: true }),
	},

	// Jump-by-8 (shift+arrow / meta+arrow / shift+letter / meta+letter)
	{
		id: "diff.jump-up",
		title: "Jump up",
		keys: ["shift+up", "shift+k", "meta+up", "meta+k"],
		run: (s) => s.moveAnchor(-8),
	},
	{
		id: "diff.jump-down",
		title: "Jump down",
		keys: ["shift+down", "shift+j", "meta+down", "meta+j"],
		run: (s) => s.moveAnchor(8),
	},

	// Vim count prefixes ("2 k", "15 j", etc.)
	...countedVerticalBindings<DiffViewCtx>((s, delta) => s.moveAnchor(delta)),

	// Single-step
	{ id: "diff.up", title: "Up", keys: ["up", "k"], run: (s) => s.moveAnchor(-1) },
	{ id: "diff.down", title: "Down", keys: ["down", "j"], run: (s) => s.moveAnchor(1) },

	// Side selection
	{ id: "diff.side-left", title: "Old side", keys: ["left", "h"], run: (s) => s.selectSide("LEFT") },
	{ id: "diff.side-right", title: "New side", keys: ["right", "l"], run: (s) => s.selectSide("RIGHT") },

	// File nav
	{ id: "diff.changed-files", title: "Changed files", keys: ["f"], run: (s) => s.openChangedFiles() },
	{ id: "diff.next-file", title: "Next file", keys: ["]"], run: (s) => s.nextFile() },
	{ id: "diff.previous-file", title: "Previous file", keys: ["["], run: (s) => s.previousFile() },
	{ id: "diff.submit-review", title: "Review pull request", keys: ["shift+r"], run: (s) => s.openSubmitReview() },

	// Boundary jumps + align
	{ id: "diff.first", title: "First comment", keys: ["g g"], run: (s) => s.moveAnchorToBoundary("first") },
	{ id: "diff.last", title: "Last comment", keys: ["shift+g"], run: (s) => s.moveAnchorToBoundary("last") },
	{ id: "diff.align-center", title: "Align center", keys: ["z z"], run: (s) => s.alignAnchor("center") },
	{ id: "diff.align-top", title: "Align top", keys: ["z t"], run: (s) => s.alignAnchor("top") },
	{ id: "diff.align-bottom", title: "Align bottom", keys: ["z b"], run: (s) => s.alignAnchor("bottom") },

	{ id: "diff.open-browser", title: "Open in browser", keys: ["o"], run: (s) => s.openInBrowser() },
)
