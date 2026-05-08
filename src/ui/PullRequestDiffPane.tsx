import type { DiffRenderable, LineSign, MouseEvent, ScrollBoxRenderable } from "@opentui/core"
import { useEffect, useMemo, useRef, type MutableRefObject, type Ref } from "react"
import type { DiffCommentSide, PullRequestItem, PullRequestReviewComment } from "../domain.js"
import { colors, lineNumberTextColor, type ThemeId } from "./colors.js"
import { CommentBodyLine, commentCountText, commentMetaSegments, CommentSegmentsLine } from "./comments.js"
import {
	createDiffSyntaxStyle,
	diffCommentAnchorLabel,
	diffCommentLineLabel,
	diffFileStats,
	diffFileStatsText,
	diffStatText,
	stackedDiffFileIndexAtLine,
	type DiffFileStats,
	type DiffView,
	type DiffWhitespaceMode,
	type DiffWrapMode,
	type PullRequestDiffState,
	type StackedDiffHunk,
	type StackedDiffCommentAnchor,
	type StackedDiffFilePatch,
} from "./diff.js"
import { LoadingPane, StatusCard } from "./DetailsPane.js"
import { DiffStats } from "./diffStats.js"
import { Divider, fitCell, PaddedRow, PlainLine, TextLine } from "./primitives.js"
import { shortRepoName } from "./pullRequests.js"

const DiffPaneHeader = ({ pullRequest, paneWidth }: { pullRequest: PullRequestItem; paneWidth: number }) => {
	const stats = diffStatText(pullRequest)
	const headerWidth = Math.max(24, paneWidth - 2)
	const leftHeader = `#${pullRequest.number} ${shortRepoName(pullRequest.repository)}`
	const headerGap = Math.max(2, headerWidth - leftHeader.length - stats.length)
	return (
		<PaddedRow>
			<TextLine>
				<span fg={colors.count}>#{pullRequest.number}</span>
				<span fg={colors.muted}> {shortRepoName(pullRequest.repository)}</span>
				<span fg={colors.muted}>{" ".repeat(headerGap)}</span>
				<DiffStats pullRequest={pullRequest} />
			</TextLine>
		</PaddedRow>
	)
}

const FileStats = ({ stats }: { stats: DiffFileStats }) => {
	return (
		<>
			{stats.additions > 0 ? <span fg={colors.status.passing}>{`+${stats.additions}`}</span> : null}
			{stats.additions > 0 && stats.deletions > 0 ? <span fg={colors.muted}> </span> : null}
			{stats.deletions > 0 ? <span fg={colors.status.failing}>{`-${stats.deletions}`}</span> : null}
		</>
	)
}

type MarkableSide = {
	readonly getLineSigns: () => Map<number, LineSign>
	readonly setLineSign: (line: number, sign: LineSign) => void
	readonly clearLineSign: (line: number) => void
}

type MarkableDiffInternals = {
	readonly leftSide?: unknown
	readonly rightSide?: unknown
}

interface HunkMarkerSnapshot {
	readonly fileIndex: number
	readonly left: Map<number, LineSign | null>
	readonly right: Map<number, LineSign | null>
}

const hunkMarkerSign = "│"

const hunkRangeText = (header: string | undefined) => header?.match(/^@@ [^@]+ @@/)?.[0] ?? header

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const isMarkableSide = (side: unknown): side is MarkableSide =>
	isRecord(side) && typeof side.getLineSigns === "function" && typeof side.setLineSign === "function" && typeof side.clearLineSign === "function"

const diffMarkableSides = (diff: DiffRenderable) => {
	const candidate: unknown = diff
	const internals: MarkableDiffInternals = isRecord(candidate) ? { leftSide: candidate.leftSide, rightSide: candidate.rightSide } : {}
	return {
		left: isMarkableSide(internals.leftSide) ? internals.leftSide : undefined,
		right: isMarkableSide(internals.rightSide) ? internals.rightSide : undefined,
	}
}

const saveLineSigns = (side: MarkableSide | undefined, start: number, end: number) => {
	const saved = new Map<number, LineSign | null>()
	if (!side) return saved

	const signs = side.getLineSigns()
	for (let line = start; line <= end; line++) {
		const existing = signs.get(line)
		saved.set(line, existing ? { ...existing } : null)
	}
	return saved
}

const restoreLineSigns = (side: MarkableSide | undefined, saved: Map<number, LineSign | null>) => {
	if (!side) return

	for (const [line, sign] of saved) {
		if (sign) {
			side.setLineSign(line, sign)
		} else {
			side.clearLineSign(line)
		}
	}
}

const restoreHunkMarker = (diffRefs: ReadonlyMap<number, DiffRenderable>, snapshot: HunkMarkerSnapshot | null) => {
	if (!snapshot) return
	const diff = diffRefs.get(snapshot.fileIndex)
	if (!diff) return
	const sides = diffMarkableSides(diff)
	restoreLineSigns(sides.left, snapshot.left)
	restoreLineSigns(sides.right, snapshot.right)
	diff.requestRender()
}

const clearHunkMarker = (diffRefs: ReadonlyMap<number, DiffRenderable>, previousRef: MutableRefObject<HunkMarkerSnapshot | null>) => {
	restoreHunkMarker(diffRefs, previousRef.current)
	previousRef.current = null
}

const applyMarkerToSide = (side: MarkableSide | undefined, hunk: StackedDiffHunk) => {
	if (!side) return

	const signs = side.getLineSigns()
	for (let line = hunk.lineRange.start; line <= hunk.lineRange.end; line++) {
		const existing = signs.get(line)
		side.setLineSign(line, { ...existing, before: hunkMarkerSign, beforeColor: colors.accent })
	}
}

const applyHunkMarker = (diffRefs: ReadonlyMap<number, DiffRenderable>, hunk: StackedDiffHunk | null, previousRef: MutableRefObject<HunkMarkerSnapshot | null>) => {
	clearHunkMarker(diffRefs, previousRef)
	if (!hunk || hunk.hunkCount <= 1) return

	const diff = diffRefs.get(hunk.fileIndex)
	if (!diff) return
	const sides = diffMarkableSides(diff)
	if (!sides.left && !sides.right) return

	const snapshot: HunkMarkerSnapshot = {
		fileIndex: hunk.fileIndex,
		left: saveLineSigns(sides.left, hunk.lineRange.start, hunk.lineRange.end),
		right: saveLineSigns(sides.right, hunk.lineRange.start, hunk.lineRange.end),
	}
	previousRef.current = snapshot
	applyMarkerToSide(sides.left, hunk)
	applyMarkerToSide(sides.right, hunk)
	diff.requestRender()
}

const FileHeader = ({
	file,
	index,
	count,
	width,
	suffix = "",
	suffixColor = colors.muted,
}: {
	file: StackedDiffFilePatch["file"]
	index: number
	count: number
	width: number
	suffix?: string
	suffixColor?: string
}) => {
	const counter = `${index + 1}/${count}`
	const stats = diffFileStats(file)
	const statsText = diffFileStatsText(stats)
	const nameWidth = Math.max(1, width - counter.length - statsText.length - suffix.length - 5)
	return (
		<TextLine>
			<span fg={colors.muted}>{counter} </span>
			<span fg={colors.text}>{fitCell(file.name, nameWidth)}</span>
			{statsText ? <span fg={colors.muted}> </span> : null}
			<FileStats stats={stats} />
			{suffix ? <span fg={suffixColor}>{suffix}</span> : null}
		</TextLine>
	)
}

export const PullRequestDiffPane = ({
	pullRequest,
	diffState,
	stackedFiles,
	scrollTop,
	view,
	whitespaceMode,
	wrapMode,
	paneWidth,
	height,
	loadingIndicator,
	scrollRef,
	setDiffRef,
	selectedCommentAnchor,
	selectedCommentLabel,
	selectedCommentThread,
	selectedHunk,
	onSelectCommentLine,
	themeId,
	themeGeneration,
}: {
	pullRequest: PullRequestItem | null
	diffState: PullRequestDiffState | undefined
	stackedFiles: readonly StackedDiffFilePatch[]
	scrollTop: number
	view: DiffView
	whitespaceMode: DiffWhitespaceMode
	wrapMode: DiffWrapMode
	paneWidth: number
	height: number
	loadingIndicator: string
	scrollRef: Ref<ScrollBoxRenderable>
	setDiffRef: (index: number, diff: DiffRenderable | null) => void
	selectedCommentAnchor: StackedDiffCommentAnchor | null
	selectedCommentLabel: string | null
	selectedCommentThread: readonly PullRequestReviewComment[]
	selectedHunk: StackedDiffHunk | null
	onSelectCommentLine: (renderLine: number, side: DiffCommentSide | null) => void
	themeId: ThemeId
	themeGeneration: number
}) => {
	const readyFiles = diffState?._tag === "Ready" ? diffState.files : []
	const diffRefs = useRef(new Map<number, DiffRenderable>())
	const hunkMarkerRef = useRef<HunkMarkerSnapshot | null>(null)
	const syntaxStyle = useMemo(() => createDiffSyntaxStyle(), [themeId, themeGeneration])

	useEffect(() => {
		applyHunkMarker(diffRefs.current, selectedHunk, hunkMarkerRef)
		return () => clearHunkMarker(diffRefs.current, hunkMarkerRef)
	}, [selectedHunk?.fileIndex, selectedHunk?.hunkIndex, selectedHunk?.lineRange.start, selectedHunk?.lineRange.end, view, stackedFiles])

	if (!pullRequest) {
		return <LoadingPane content={{ title: "No pull request selected", hint: "Press esc to go back" }} width={paneWidth} height={height} />
	}

	if (!diffState || diffState._tag === "Loading") {
		return (
			<box height={height} flexDirection="column">
				<DiffPaneHeader pullRequest={pullRequest} paneWidth={paneWidth} />
				<Divider width={paneWidth} />
				<LoadingPane content={{ title: `${loadingIndicator} Loading diff`, hint: "Fetching patch from GitHub" }} width={paneWidth} height={Math.max(1, height - 2)} />
			</box>
		)
	}

	if (diffState._tag === "Error") {
		return (
			<box height={height} flexDirection="column">
				<PaddedRow>
					<PlainLine text={`#${pullRequest.number} ${shortRepoName(pullRequest.repository)} diff`} fg={colors.count} bold />
				</PaddedRow>
				<Divider width={paneWidth} />
				<StatusCard content={{ title: "Could not load diff", hint: diffState.error }} width={paneWidth} />
			</box>
		)
	}

	if (readyFiles.length === 0 || stackedFiles.length === 0) {
		return (
			<LoadingPane
				content={{
					title: whitespaceMode === "ignore" ? "No non-whitespace diff" : "No diff",
					hint: whitespaceMode === "ignore" ? "Use the command palette to show whitespace changes" : "This PR has no patch contents",
				}}
				width={paneWidth}
				height={height}
			/>
		)
	}

	const hasSelectedCommentAnchor = selectedCommentAnchor !== null
	const commentPeek = hasSelectedCommentAnchor && selectedCommentThread.length > 0 ? selectedCommentThread[selectedCommentThread.length - 1]! : null
	const commentPeekMeta =
		commentPeek && selectedCommentAnchor
			? commentMetaSegments({
					item: commentPeek,
					markerLabel: diffCommentLineLabel(selectedCommentAnchor),
					groups: [
						[{ text: commentCountText(selectedCommentThread.length), fg: colors.muted }],
						[
							{ text: "enter", fg: colors.text },
							{ text: " thread", fg: colors.muted },
						],
					],
				})
			: []
	const stickyScrollTop = Math.max(0, Math.floor(scrollTop))
	const stickyArrayIndex = stackedDiffFileIndexAtLine(stackedFiles, stickyScrollTop)
	const stickyFile = stickyArrayIndex >= 0 ? stackedFiles[stickyArrayIndex] : stackedFiles[0]
	const incomingStickyFile = stickyArrayIndex >= 0 ? stackedFiles[stickyArrayIndex + 1] : undefined
	const incomingHeaderDistance = incomingStickyFile ? incomingStickyFile.headerLine - stickyScrollTop : Number.POSITIVE_INFINITY
	const incomingFile = incomingHeaderDistance === 1 ? incomingStickyFile : undefined
	const hunkLabelFor = (stackedFile: StackedDiffFilePatch | undefined) => {
		if (!selectedHunk || selectedHunk.fileIndex !== stackedFile?.index) return ""
		return `  hunk ${selectedHunk.hunkIndex + 1}/${selectedHunk.hunkCount} ${hunkRangeText(selectedHunk.header) ?? ""}`
	}
	const stickyCommentLabelFor = (stackedFile: StackedDiffFilePatch | undefined) => {
		if (!selectedCommentAnchor) return "  no lines"
		if (selectedCommentAnchor.fileIndex !== stackedFile?.index) return ""
		return `  ${selectedCommentLabel ?? diffCommentAnchorLabel(selectedCommentAnchor)}`
	}
	const headerSuffixFor = (stackedFile: StackedDiffFilePatch | undefined) => {
		const comment = stickyCommentLabelFor(stackedFile)
		const hunk = hunkLabelFor(stackedFile)
		if (comment && hunk) return `${comment}${hunk}`
		return comment || hunk
	}
	const stickyCommentColor = selectedCommentAnchor?.side === "LEFT" ? colors.status.failing : colors.status.passing
	const diffLineNumberFg = lineNumberTextColor(colors.diff.lineNumberBg, colors.text)
	const handleDiffMouseDown = function (this: ScrollBoxRenderable, event: MouseEvent) {
		if (event.button !== 0) return
		const localY = event.y - this.viewport.y
		if (localY < 0 || localY >= this.viewport.height) return
		const localX = event.x - this.viewport.x
		const side = view === "split" ? (localX < Math.floor(paneWidth / 2) ? "LEFT" : "RIGHT") : null
		onSelectCommentLine(Math.max(0, Math.floor(this.scrollTop + localY)), side)
		event.preventDefault()
		event.stopPropagation()
	}

	return (
		<box height={height} flexDirection="column">
			<DiffPaneHeader pullRequest={pullRequest} paneWidth={paneWidth} />
			<Divider width={paneWidth} />
			<scrollbox ref={scrollRef} focusable={false} flexGrow={1} scrollY scrollX={false} onMouseDown={handleDiffMouseDown}>
				{stackedFiles.map((stackedFile) => (
					<box key={`${pullRequest.url}-${stackedFile.index}-${view}-${wrapMode}`} flexDirection="column" flexShrink={0}>
						{stackedFile.index > 0 ? <Divider width={paneWidth} /> : null}
						<PaddedRow>
							<FileHeader
								file={stackedFile.file}
								index={stackedFile.index}
								count={readyFiles.length}
								width={paneWidth}
								suffix={headerSuffixFor(stackedFile)}
								suffixColor={stickyCommentLabelFor(stackedFile) ? stickyCommentColor : colors.count}
							/>
						</PaddedRow>
						<Divider width={paneWidth} />
						<diff
							ref={(diff: DiffRenderable | null) => {
								if (!diff && hunkMarkerRef.current?.fileIndex === stackedFile.index) {
									clearHunkMarker(diffRefs.current, hunkMarkerRef)
								}
								if (diff) {
									diffRefs.current.set(stackedFile.index, diff)
								} else {
									diffRefs.current.delete(stackedFile.index)
								}
								setDiffRef(stackedFile.index, diff)
							}}
							diff={stackedFile.file.patch}
							view={view}
							syncScroll
							filetype={stackedFile.file.filetype ?? "text"}
							syntaxStyle={syntaxStyle}
							fg={colors.text}
							showLineNumbers
							wrapMode={wrapMode}
							addedBg={colors.diff.addedBg}
							removedBg={colors.diff.removedBg}
							contextBg={colors.diff.contextBg}
							addedSignColor={colors.status.passing}
							removedSignColor={colors.status.failing}
							lineNumberFg={diffLineNumberFg}
							lineNumberBg={colors.diff.lineNumberBg}
							addedLineNumberBg={colors.diff.addedLineNumberBg}
							removedLineNumberBg={colors.diff.removedLineNumberBg}
							selectionBg={colors.selectedBg}
							selectionFg={colors.selectedText}
							height={stackedFile.diffHeight}
							style={{ flexShrink: 0 }}
						/>
					</box>
				))}
			</scrollbox>
			{stickyFile ? (
				<box position="absolute" top={2} left={0} width={paneWidth} height={2} zIndex={10} flexDirection="column" backgroundColor={colors.background}>
					{incomingFile ? (
						<>
							<Divider width={paneWidth} />
							<PaddedRow backgroundColor={colors.background}>
								<FileHeader
									file={incomingFile.file}
									index={incomingFile.index}
									count={readyFiles.length}
									width={paneWidth}
									suffix={headerSuffixFor(incomingFile)}
									suffixColor={stickyCommentLabelFor(incomingFile) ? stickyCommentColor : colors.count}
								/>
							</PaddedRow>
						</>
					) : (
						<>
							<PaddedRow backgroundColor={colors.background}>
								<FileHeader
									file={stickyFile.file}
									index={stickyFile.index}
									count={readyFiles.length}
									width={paneWidth}
									suffix={headerSuffixFor(stickyFile)}
									suffixColor={stickyCommentLabelFor(stickyFile) ? stickyCommentColor : colors.count}
								/>
							</PaddedRow>
							<Divider width={paneWidth} />
						</>
					)}
				</box>
			) : null}
			{commentPeek ? (
				<>
					<Divider width={paneWidth} />
					<PaddedRow>
						<CommentSegmentsLine segments={commentPeekMeta} />
					</PaddedRow>
					<PaddedRow>
						<CommentBodyLine body={commentPeek.body} width={Math.max(1, paneWidth - 2)} />
					</PaddedRow>
				</>
			) : null}
		</box>
	)
}
