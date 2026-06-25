// Pure layout math for the workspace shell.
//
// All numbers come from terminal width/height + a couple of mode flags.
// Splitting this out means surfaces can be rendered in a snapshot test
// with hand-picked layout numbers; App.tsx only consults `computeLayout`.

export interface LayoutInput {
	readonly terminalWidth: number
	readonly terminalHeight: number
	readonly showWorkspaceTabs: boolean
	readonly showDiffFilePanel: boolean
	readonly diffFilePanelWidth: number
}

export interface WorkspaceLayout {
	readonly contentWidth: number
	readonly isWideLayout: boolean
	readonly splitGap: number
	readonly sectionPadding: number
	readonly leftPaneWidth: number
	readonly rightPaneWidth: number
	readonly leftContentWidth: number
	readonly rightContentWidth: number
	readonly dividerJunctionAt: number
	readonly wideBodyHeight: number
	readonly wideDetailLines: number
	readonly headerFooterWidth: number
	readonly fullscreenContentWidth: number
	readonly fullscreenBodyLines: number
	// Width of the docked diff-file panel (0 when hidden).
	readonly diffFilePanelEffectiveWidth: number
	// Outer width allocated to the diff pane itself. With the panel hidden
	// this is the whole content width; with it shown, panel + 1-col divider
	// are subtracted.
	readonly diffPaneWidth: number
}

const WIDE_BREAKPOINT = 100

export const MIN_TERMINAL_WIDTH = 60
export const MIN_TERMINAL_HEIGHT = 16

export const isTerminalTooSmall = (terminalWidth: number, terminalHeight: number): boolean => terminalWidth < MIN_TERMINAL_WIDTH || terminalHeight < MIN_TERMINAL_HEIGHT

// Panel width scales with the terminal so it gets a fair share on wide
// terminals (more room for long paths) without overwhelming the diff. The
// floor/ceiling keep the column readable; the 0.22 factor lands a 200-col
// terminal at ~44 cols, leaving the diff ~155 cols.
export const diffFilePanelWidthFor = (terminalWidth: number): number => Math.min(60, Math.max(28, Math.floor(terminalWidth * 0.22)))

export const computeLayout = ({ terminalWidth, terminalHeight, showWorkspaceTabs, showDiffFilePanel, diffFilePanelWidth }: LayoutInput): WorkspaceLayout => {
	const contentWidth = Math.max(1, terminalWidth)
	const isWideLayout = terminalWidth >= WIDE_BREAKPOINT
	const splitGap = 1
	const sectionPadding = 1
	const leftPaneWidth = isWideLayout ? Math.max(44, Math.floor((contentWidth - splitGap) * 0.56)) : contentWidth
	const rightPaneWidth = isWideLayout ? Math.max(28, contentWidth - leftPaneWidth - splitGap) : contentWidth
	const dividerJunctionAt = Math.max(1, leftPaneWidth)
	const leftContentWidth = isWideLayout ? Math.max(24, leftPaneWidth - 2) : Math.max(24, contentWidth - sectionPadding * 2)
	const rightContentWidth = isWideLayout ? Math.max(24, rightPaneWidth - sectionPadding * 2) : Math.max(24, contentWidth - sectionPadding * 2)
	const wideDetailLines = Math.max(8, terminalHeight - 10)
	const wideBodyHeight = Math.max(8, terminalHeight - (showWorkspaceTabs ? 6 : 4))
	const headerFooterWidth = Math.max(24, contentWidth - 2)
	const fullscreenContentWidth = Math.max(24, contentWidth - 2)
	const fullscreenBodyLines = Math.max(8, terminalHeight - 8)
	// The docked file panel eats into the diff's outer width. We clamp so the
	// diff retains at least 60 cols of *outer* width even at edge cases — past
	// that point the auto-visibility threshold is the real guard.
	const diffFilePanelDividerWidth = showDiffFilePanel ? 1 : 0
	const diffFilePanelEffectiveWidth = showDiffFilePanel ? Math.min(diffFilePanelWidth, Math.max(0, contentWidth - diffFilePanelDividerWidth - 60)) : 0
	const diffPaneWidth = Math.max(24, contentWidth - diffFilePanelEffectiveWidth - diffFilePanelDividerWidth)
	return {
		contentWidth,
		isWideLayout,
		splitGap,
		sectionPadding,
		leftPaneWidth,
		rightPaneWidth,
		leftContentWidth,
		rightContentWidth,
		dividerJunctionAt,
		wideBodyHeight,
		wideDetailLines,
		headerFooterWidth,
		fullscreenContentWidth,
		fullscreenBodyLines,
		diffFilePanelEffectiveWidth,
		diffPaneWidth,
	}
}
