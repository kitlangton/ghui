import { useEffect, type MutableRefObject } from "react"
import type { ScrollBoxRenderable } from "@opentui/core"
import type { DiffCommentSide, PullRequestItem } from "../domain.js"
import type { DiffFilePatch, StackedDiffCommentAnchor, StackedDiffFilePatch } from "../ui/diff.js"
import {
	diffAnchorOnSide,
	diffCommentLocationKey,
	pullRequestDiffKey,
	safeDiffFileIndex,
	scrollTopForVisibleLine,
	stackedDiffFileIndexAtLine,
	verticalDiffAnchor,
} from "../ui/diff.js"
import { diffCommentRangeSelection, sameDiffCommentTarget } from "../ui/diff/comments.js"

const DIFF_STICKY_HEADER_LINES = 2
import type { ChangedFilesModalState, CommentModalState } from "../ui/modals/types.js"

export interface DiffCommentNavigatorInput {
	readonly diffFullView: boolean
	readonly diffFileIndex: number
	readonly setDiffFileIndex: (next: number | ((current: number) => number)) => void
	readonly setDiffScrollTop: (next: number | ((current: number) => number)) => void
	readonly diffCommentAnchorIndex: number
	readonly setDiffCommentAnchorIndex: (next: number | ((current: number) => number)) => void
	readonly diffPreferredSide: DiffCommentSide | null
	readonly setDiffPreferredSide: (next: DiffCommentSide | null) => void
	readonly diffCommentRangeStartAnchor: StackedDiffCommentAnchor | null
	readonly setDiffCommentRangeStartIndex: (next: number | null | ((current: number | null) => number | null)) => void
	readonly diffCommentAnchors: readonly StackedDiffCommentAnchor[]
	readonly diffCommentThreadAnchors: readonly StackedDiffCommentAnchor[]
	readonly selectedDiffCommentAnchor: StackedDiffCommentAnchor | null
	readonly selectedDiffCommentAnchorIndex: number
	readonly selectedDiffCommentThread: readonly unknown[]
	readonly diffCommentRangeActive: boolean
	readonly stackedDiffFiles: readonly StackedDiffFilePatch[]
	readonly readyDiffFiles: readonly DiffFilePatch[]
	readonly wideBodyHeight: number
	readonly diffScrollRef: MutableRefObject<ScrollBoxRenderable | null>
	readonly suppressNextDiffCommentScrollRef: MutableRefObject<boolean>
	readonly selectedPullRequest: PullRequestItem | null
	readonly changedFilesModal: ChangedFilesModalState
	readonly changedFileResults: readonly { readonly index: number }[]
	readonly closeActiveModal: () => void
	readonly setChangedFilesModal: (next: ChangedFilesModalState) => void
	readonly setCommentModal: (state: CommentModalState | ((prev: CommentModalState) => CommentModalState)) => void
	readonly setCommentThreadModal: (state: { scrollOffset: number }) => void
	readonly initialCommentModalState: CommentModalState
	readonly flashNotice: (msg: string) => void
}

export interface DiffCommentNavigator {
	readonly syncDiffScrollState: () => void
	readonly ensureDiffLineVisible: (line: number) => void
	readonly scrollToDiffFile: (index: number) => void
	readonly selectDiffFile: (index: number) => void
	readonly jumpDiffFile: (delta: 1 | -1) => void
	readonly openChangedFilesModal: () => void
	readonly selectChangedFile: () => void
	readonly navigableDiffCommentAnchors: () => readonly StackedDiffCommentAnchor[]
	readonly moveDiffCommentAnchor: (delta: number, options?: { readonly preserveViewportRow?: boolean }) => void
	readonly moveDiffCommentToBoundary: (boundary: "first" | "last") => void
	readonly alignSelectedDiffCommentAnchor: (position: "top" | "center" | "bottom") => void
	readonly selectDiffCommentSide: (side: DiffCommentSide) => void
	readonly selectDiffCommentLine: (renderLine: number, side: DiffCommentSide | null) => void
	readonly openDiffCommentModal: () => void
	readonly openDiffCommentThreadModal: () => void
	readonly openSelectedDiffComment: () => void
	readonly toggleDiffCommentRange: () => void
	readonly moveDiffCommentThread: (delta: 1 | -1) => void
}

/**
 * Bundles the imperative actions that mutate the diff-view's selected
 * comment anchor / file index / scroll position. Each action closes
 * over a shared cluster of atoms + refs; centralizing keeps App.tsx
 * free of ~150 LOC of tightly-coupled handlers.
 */
export const useDiffCommentNavigator = (input: DiffCommentNavigatorInput): DiffCommentNavigator => {
	const {
		diffFullView,
		diffFileIndex,
		setDiffFileIndex,
		setDiffScrollTop,
		setDiffCommentAnchorIndex,
		diffPreferredSide,
		setDiffPreferredSide,
		diffCommentRangeStartAnchor,
		setDiffCommentRangeStartIndex,
		diffCommentAnchors,
		diffCommentThreadAnchors,
		selectedDiffCommentAnchor,
		selectedDiffCommentAnchorIndex,
		selectedDiffCommentThread,
		diffCommentRangeActive,
		stackedDiffFiles,
		readyDiffFiles,
		wideBodyHeight,
		diffScrollRef,
		suppressNextDiffCommentScrollRef,
		selectedPullRequest,
		changedFilesModal,
		changedFileResults,
		closeActiveModal,
		setChangedFilesModal,
		setCommentModal,
		setCommentThreadModal,
		initialCommentModalState,
		flashNotice,
	} = input

	const syncDiffScrollState = () => {
		const scrollTop = diffScrollRef.current?.scrollTop
		if (scrollTop === undefined || stackedDiffFiles.length === 0) return
		setDiffScrollTop((current) => (current === scrollTop ? current : scrollTop))
		const nextIndex = Math.max(0, stackedDiffFileIndexAtLine(stackedDiffFiles, scrollTop))
		setDiffFileIndex((current) => (current === nextIndex ? current : nextIndex))
	}

	const ensureDiffLineVisible = (line: number) => {
		const scroll = diffScrollRef.current
		if (!scroll) return
		const viewportHeight = Math.max(1, wideBodyHeight - (selectedDiffCommentThread.length > 0 ? 6 : 3))
		const nextTop = scrollTopForVisibleLine(scroll.scrollTop, viewportHeight, line, DIFF_STICKY_HEADER_LINES)
		if (nextTop !== scroll.scrollTop) {
			scroll.scrollTo({ x: 0, y: nextTop })
			syncDiffScrollState()
		}
	}

	useEffect(() => {
		if (!diffFullView) return
		const interval = globalThis.setInterval(syncDiffScrollState, 80)
		return () => globalThis.clearInterval(interval)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [diffFullView, stackedDiffFiles])

	const scrollToDiffFile = (index: number) => {
		const stackedFile = stackedDiffFiles[index]
		diffScrollRef.current?.scrollTo({ x: 0, y: stackedFile?.headerLine ?? 0 })
		syncDiffScrollState()
	}

	const selectDiffFile = (index: number) => {
		if (readyDiffFiles.length === 0) return
		const nextIndex = safeDiffFileIndex(readyDiffFiles, index)
		setDiffFileIndex(nextIndex)
		setDiffCommentRangeStartIndex(null)
		const targetSide = diffPreferredSide ?? selectedDiffCommentAnchor?.side
		const nextAnchor =
			diffCommentAnchors.find((anchor) => anchor.fileIndex === nextIndex && anchor.side === targetSide) ?? diffCommentAnchors.find((anchor) => anchor.fileIndex === nextIndex)
		if (nextAnchor) setDiffCommentAnchorIndex(diffCommentAnchors.indexOf(nextAnchor))
		scrollToDiffFile(nextIndex)
	}

	const jumpDiffFile = (delta: 1 | -1) => {
		selectDiffFile(diffFileIndex + delta)
	}

	const openChangedFilesModal = () => {
		if (readyDiffFiles.length === 0) return
		setChangedFilesModal({
			query: "",
			selectedIndex: safeDiffFileIndex(readyDiffFiles, diffFileIndex),
		})
	}

	const selectChangedFile = () => {
		const selectedIndex = changedFileResults.length === 0 ? 0 : Math.max(0, Math.min(changedFilesModal.selectedIndex, changedFileResults.length - 1))
		const entry = changedFileResults[selectedIndex]
		if (!entry) return
		closeActiveModal()
		selectDiffFile(entry.index)
	}

	const navigableDiffCommentAnchors = (): readonly StackedDiffCommentAnchor[] =>
		diffCommentRangeStartAnchor ? diffCommentAnchors.filter((anchor) => sameDiffCommentTarget(anchor, diffCommentRangeStartAnchor)) : diffCommentAnchors

	const moveDiffCommentAnchor = (delta: number, options: { readonly preserveViewportRow?: boolean } = {}) => {
		const anchors = navigableDiffCommentAnchors()
		if (anchors.length === 0) return
		const currentAnchor = selectedDiffCommentAnchor && anchors.includes(selectedDiffCommentAnchor) ? selectedDiffCommentAnchor : anchors[0]
		const nextAnchor = verticalDiffAnchor(anchors, currentAnchor ?? null, delta, diffPreferredSide)
		if (!nextAnchor) return
		if (options.preserveViewportRow) {
			const scroll = diffScrollRef.current
			if (scroll && currentAnchor) {
				const maxScreenOffset = Math.max(DIFF_STICKY_HEADER_LINES, scroll.viewport.height - 2)
				const screenOffset = Math.max(DIFF_STICKY_HEADER_LINES, Math.min(maxScreenOffset, currentAnchor.renderLine - scroll.scrollTop))
				const maxScrollTop = Math.max(0, scroll.scrollHeight - scroll.viewport.height)
				const nextTop = Math.max(0, Math.min(maxScrollTop, nextAnchor.renderLine - screenOffset))
				suppressNextDiffCommentScrollRef.current = true
				scroll.scrollTo({ x: 0, y: nextTop })
				syncDiffScrollState()
			}
		}
		setDiffCommentAnchorIndex(diffCommentAnchors.indexOf(nextAnchor))
	}

	const moveDiffCommentToBoundary = (boundary: "first" | "last") => {
		const anchors = navigableDiffCommentAnchors()
		const nextAnchor = boundary === "first" ? anchors[0] : anchors[anchors.length - 1]
		if (!nextAnchor) return
		setDiffCommentAnchorIndex(diffCommentAnchors.indexOf(nextAnchor))
		setDiffFileIndex(nextAnchor.fileIndex)
	}

	const alignSelectedDiffCommentAnchor = (position: "top" | "center" | "bottom") => {
		if (!selectedDiffCommentAnchor) return
		const scroll = diffScrollRef.current
		if (!scroll) return
		const viewportHeight = Math.max(1, scroll.viewport.height)
		const offset =
			position === "top"
				? DIFF_STICKY_HEADER_LINES
				: position === "center"
					? Math.max(DIFF_STICKY_HEADER_LINES, Math.floor(viewportHeight / 2))
					: Math.max(DIFF_STICKY_HEADER_LINES, viewportHeight - 2)
		const maxScrollTop = Math.max(0, scroll.scrollHeight - viewportHeight)
		const nextTop = Math.max(0, Math.min(maxScrollTop, selectedDiffCommentAnchor.renderLine - offset))
		scroll.scrollTo({ x: 0, y: nextTop })
		syncDiffScrollState()
	}

	const selectDiffCommentSide = (side: DiffCommentSide) => {
		setDiffPreferredSide(side)
		if (!selectedDiffCommentAnchor) return
		const nextAnchor = diffAnchorOnSide(diffCommentAnchors, selectedDiffCommentAnchor, side)
		if (!nextAnchor) return
		setDiffCommentRangeStartIndex(null)
		setDiffCommentAnchorIndex(diffCommentAnchors.indexOf(nextAnchor))
	}

	const selectDiffCommentLine = (renderLine: number, side: DiffCommentSide | null) => {
		const fileIndex = stackedDiffFileIndexAtLine(stackedDiffFiles, renderLine)
		const stackedFile = stackedDiffFiles[fileIndex]
		if (!stackedFile || renderLine < stackedFile.diffStartLine || renderLine >= stackedFile.diffStartLine + stackedFile.diffHeight) return
		const fileAnchors = diffCommentAnchors.filter((anchor) => anchor.fileIndex === fileIndex)
		const lineAnchors = fileAnchors.filter((anchor) => anchor.renderLine === renderLine)
		const nextAnchor =
			(side ? lineAnchors.find((anchor) => anchor.side === side) : undefined) ?? lineAnchors[0] ?? [...fileAnchors].reverse().find((anchor) => anchor.renderLine <= renderLine)
		if (!nextAnchor) return
		suppressNextDiffCommentScrollRef.current = true
		setDiffPreferredSide(side ?? nextAnchor.side)
		if (diffCommentRangeStartAnchor && !sameDiffCommentTarget(diffCommentRangeStartAnchor, nextAnchor)) {
			setDiffCommentRangeStartIndex(null)
		}
		setDiffCommentAnchorIndex(diffCommentAnchors.indexOf(nextAnchor))
		setDiffFileIndex(nextAnchor.fileIndex)
	}

	const openDiffCommentModal = () => {
		if (!selectedDiffCommentAnchor || !selectedPullRequest) return
		const normalizedRange = diffCommentRangeActive ? diffCommentRangeSelection(diffCommentRangeStartAnchor, selectedDiffCommentAnchor) : null
		const targetAnchor = normalizedRange?.end ?? selectedDiffCommentAnchor
		const range = normalizedRange
			? {
					start: { line: normalizedRange.start.line, side: normalizedRange.start.side },
					end: { line: normalizedRange.end.line, side: normalizedRange.end.side },
				}
			: null
		setCommentModal({
			...initialCommentModalState,
			target: {
				kind: "diff",
				target: {
					repository: selectedPullRequest.repository,
					number: selectedPullRequest.number,
					commitId: selectedPullRequest.headRefOid,
					diffKey: pullRequestDiffKey(selectedPullRequest),
					anchor: { path: targetAnchor.path, line: targetAnchor.line, side: targetAnchor.side },
					range,
				},
			},
		})
	}

	const openDiffCommentThreadModal = () => {
		if (!selectedDiffCommentAnchor || selectedDiffCommentThread.length === 0) return
		setCommentThreadModal({ scrollOffset: 0 })
	}

	const openSelectedDiffComment = () => {
		if (diffCommentRangeActive) {
			openDiffCommentModal()
			return
		}
		if (selectedDiffCommentThread.length > 0) openDiffCommentThreadModal()
		else openDiffCommentModal()
	}

	const toggleDiffCommentRange = () => {
		if (!selectedDiffCommentAnchor) return
		setDiffCommentRangeStartIndex((current) => (current === null ? selectedDiffCommentAnchorIndex : null))
	}

	const moveDiffCommentThread = (delta: 1 | -1) => {
		if (diffCommentThreadAnchors.length === 0) {
			flashNotice("No diff comments")
			return
		}
		const currentIndex = selectedDiffCommentAnchor
			? diffCommentThreadAnchors.findIndex((anchor) => diffCommentLocationKey(anchor) === diffCommentLocationKey(selectedDiffCommentAnchor))
			: -1
		const nextAnchor =
			currentIndex >= 0
				? diffCommentThreadAnchors[(currentIndex + delta + diffCommentThreadAnchors.length) % diffCommentThreadAnchors.length]
				: delta > 0
					? (diffCommentThreadAnchors.find((anchor) => !selectedDiffCommentAnchor || anchor.renderLine > selectedDiffCommentAnchor.renderLine) ?? diffCommentThreadAnchors[0])
					: ([...diffCommentThreadAnchors].reverse().find((anchor) => !selectedDiffCommentAnchor || anchor.renderLine < selectedDiffCommentAnchor.renderLine) ??
						diffCommentThreadAnchors[diffCommentThreadAnchors.length - 1])
		if (!nextAnchor) return
		setDiffCommentRangeStartIndex(null)
		setDiffCommentAnchorIndex(diffCommentAnchors.indexOf(nextAnchor))
		setDiffFileIndex(nextAnchor.fileIndex)
	}

	return {
		syncDiffScrollState,
		ensureDiffLineVisible,
		scrollToDiffFile,
		selectDiffFile,
		jumpDiffFile,
		openChangedFilesModal,
		selectChangedFile,
		navigableDiffCommentAnchors,
		moveDiffCommentAnchor,
		moveDiffCommentToBoundary,
		alignSelectedDiffCommentAnchor,
		selectDiffCommentSide,
		selectDiffCommentLine,
		openDiffCommentModal,
		openDiffCommentThreadModal,
		openSelectedDiffComment,
		toggleDiffCommentRange,
		moveDiffCommentThread,
	}
}
