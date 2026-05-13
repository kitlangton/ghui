// Pure modal sizing math. Each modal gets a rectangle centered in the
// terminal, sized between min/max bounds and clamped to fit the
// terminal. Splitting this out keeps App.tsx free of layout numbers
// and lets the rendering be tested without OpenTUI.

export interface ModalRect {
	readonly width: number
	readonly height: number
	readonly left: number
	readonly top: number
}

const centeredOffset = (outer: number, inner: number) => Math.floor((outer - inner) / 2)

const sizedRect =
	(contentWidth: number, terminalHeight: number) =>
	(minW: number, maxW: number, padX: number, maxH: number): ModalRect => {
		const width = Math.min(maxW, Math.max(minW, contentWidth - padX))
		const height = Math.min(maxH, terminalHeight - 4)
		return { width, height, left: centeredOffset(contentWidth, width), top: centeredOffset(terminalHeight, height) }
	}

export interface ModalLayoutInput {
	readonly contentWidth: number
	readonly terminalHeight: number
	readonly longestLabelName: number
	readonly longestDiffFileName: number
	readonly changedFilesModalActive: boolean
}

export interface ModalLayouts {
	readonly label: ModalRect
	readonly changedFiles: ModalRect
	readonly close: ModalRect
	readonly deleteComment: ModalRect
	readonly pullRequestState: ModalRect
	readonly comment: ModalRect
	readonly commentThread: ModalRect
	readonly filter: ModalRect
	readonly submitReview: ModalRect
	readonly merge: ModalRect
	readonly theme: ModalRect
	readonly openRepository: ModalRect
	readonly commandPalette: ModalRect
}

export const computeModalLayouts = ({ contentWidth, terminalHeight, longestLabelName, longestDiffFileName, changedFilesModalActive }: ModalLayoutInput): ModalLayouts => {
	const sized = sizedRect(contentWidth, terminalHeight)
	const labelWidth = Math.min(Math.max(42, longestLabelName + 16), 56, contentWidth - 4)
	const labelHeight = Math.min(20, terminalHeight - 4)
	const label: ModalRect = {
		width: labelWidth,
		height: labelHeight,
		left: centeredOffset(contentWidth, labelWidth),
		top: centeredOffset(terminalHeight, labelHeight),
	}
	const changedFilesWidth = changedFilesModalActive ? Math.min(Math.max(46, longestDiffFileName + 16), 88, contentWidth - 4) : 46
	const changedFilesHeight = Math.min(22, terminalHeight - 4)
	const changedFiles: ModalRect = {
		width: changedFilesWidth,
		height: changedFilesHeight,
		left: centeredOffset(contentWidth, changedFilesWidth),
		top: centeredOffset(terminalHeight, changedFilesHeight),
	}
	return {
		label,
		changedFiles,
		close: sized(46, 68, 12, 12),
		deleteComment: sized(46, 68, 12, 12),
		pullRequestState: sized(46, 68, 12, 9),
		comment: sized(46, 76, 8, 16),
		commentThread: sized(50, 86, 8, 22),
		filter: sized(58, 76, 10, 12),
		submitReview: sized(54, 84, 8, 18),
		merge: sized(46, 68, 14, 20),
		theme: sized(38, 58, 12, 16),
		openRepository: sized(46, 76, 8, 8),
		commandPalette: sized(50, 88, 8, 24),
	}
}
