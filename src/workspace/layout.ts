// Pure layout math for the workspace shell.
//
// All numbers come from terminal width/height + a couple of mode flags.
// Splitting this out means surfaces can be rendered in a snapshot test
// with hand-picked layout numbers; App.tsx only consults `computeLayout`.

export interface LayoutInput {
	readonly terminalWidth: number
	readonly terminalHeight: number
	readonly showWorkspaceTabs: boolean
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
}

const WIDE_BREAKPOINT = 100

export const computeLayout = ({ terminalWidth, terminalHeight, showWorkspaceTabs }: LayoutInput): WorkspaceLayout => {
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
	}
}
