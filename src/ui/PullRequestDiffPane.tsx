import type { DiffRenderable, MouseEvent, ScrollBoxRenderable } from "@opentui/core"
import { useMemo, type Ref } from "react"
import type { DiffCommentSide, PullRequestItem, PullRequestReviewComment } from "../domain.js"
import { colors, type ThemeId } from "./colors.js"
import { createDiffSyntaxStyle, diffFileStats, diffFileStatsText, diffStatText, stackedDiffFileAtLine, type DiffFileStats, type DiffView, type DiffWrapMode, type PullRequestDiffState, type StackedDiffCommentAnchor, type StackedDiffFilePatch } from "./diff.js"
import { LoadingPane, StatusCard } from "./DetailsPane.js"
import { Divider, fitCell, PlainLine, TextLine } from "./primitives.js"
import { shortRepoName } from "./pullRequests.js"

const DiffStats = ({ pullRequest }: { pullRequest: PullRequestItem }) => {
	if (!pullRequest.detailLoaded) return <span fg={colors.muted}>loading details</span>
	const files = pullRequest.changedFiles === 1 ? "1 file" : `${pullRequest.changedFiles} files`
	type Part = { key: string; text: string; color: string }
	const rawParts: Array<Part | null> = [
		pullRequest.additions > 0 ? { key: "additions", text: `+${pullRequest.additions}`, color: colors.status.passing } : null,
		pullRequest.deletions > 0 ? { key: "deletions", text: `-${pullRequest.deletions}`, color: colors.status.failing } : null,
		{ key: "files", text: files, color: colors.muted },
	]
	const parts = rawParts.filter((part): part is Part => part !== null)

	return (
		<>
			{parts.map((part, index) => (
				<span key={part.key} fg={part.color}>{`${index > 0 ? " " : ""}${part.text}`}</span>
			))}
		</>
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
			{statsText ? <span fg={colors.muted}>  </span> : null}
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
	wrapMode,
	paneWidth,
	height,
	loadingIndicator,
	scrollRef,
	setDiffRef,
	commentMode,
	selectedCommentAnchor,
	selectedCommentThread,
	onSelectCommentLine,
	themeId,
}: {
	pullRequest: PullRequestItem | null
	diffState: PullRequestDiffState | undefined
	stackedFiles: readonly StackedDiffFilePatch[]
	scrollTop: number
	view: DiffView
	wrapMode: DiffWrapMode
	paneWidth: number
	height: number
	loadingIndicator: string
	scrollRef: Ref<ScrollBoxRenderable>
	setDiffRef: (index: number, diff: DiffRenderable | null) => void
	commentMode: boolean
	selectedCommentAnchor: StackedDiffCommentAnchor | null
	selectedCommentThread: readonly PullRequestReviewComment[]
	onSelectCommentLine: (renderLine: number, side: DiffCommentSide | null) => void
	themeId: ThemeId
}) => {
	const readyFiles = diffState?._tag === "Ready" ? diffState.files : []
	const syntaxStyle = useMemo(() => createDiffSyntaxStyle(), [themeId])

	if (!pullRequest) {
		return <LoadingPane content={{ title: "No pull request selected", hint: "Press esc to go back" }} width={paneWidth} height={height} />
	}

	const stats = diffStatText(pullRequest)
	const headerWidth = Math.max(24, paneWidth - 2)
	const leftHeader = `#${pullRequest.number} ${shortRepoName(pullRequest.repository)}`
	const headerGap = Math.max(2, headerWidth - leftHeader.length - stats.length)

	if (!diffState || diffState._tag === "Loading") {
		return (
			<box height={height} flexDirection="column">
				<box height={1} paddingLeft={1} paddingRight={1}>
					<TextLine>
						<span fg={colors.count}>#{pullRequest.number}</span>
						<span fg={colors.muted}> {shortRepoName(pullRequest.repository)}</span>
						<span fg={colors.muted}>{" ".repeat(headerGap)}</span>
						<DiffStats pullRequest={pullRequest} />
					</TextLine>
				</box>
				<Divider width={paneWidth} />
				<LoadingPane content={{ title: `${loadingIndicator} Loading diff`, hint: "Fetching patch from GitHub" }} width={paneWidth} height={Math.max(1, height - 2)} />
			</box>
		)
	}

	if (diffState._tag === "Error") {
		return (
			<box height={height} flexDirection="column">
				<box height={1} paddingLeft={1} paddingRight={1}>
					<PlainLine text={`#${pullRequest.number} ${shortRepoName(pullRequest.repository)} diff`} fg={colors.count} bold />
				</box>
				<Divider width={paneWidth} />
				<StatusCard content={{ title: "Could not load diff", hint: diffState.error }} width={paneWidth} />
			</box>
		)
	}

	if (readyFiles.length === 0 || stackedFiles.length === 0) {
		return <LoadingPane content={{ title: "No diff", hint: "This PR has no patch contents" }} width={paneWidth} height={height} />
	}

	const selectedSideLabel = selectedCommentAnchor?.side === "RIGHT" ? "right" : selectedCommentAnchor?.side === "LEFT" ? "left" : null
	const commentPeek = commentMode && selectedCommentAnchor && selectedCommentThread.length > 0
		? selectedCommentThread[selectedCommentThread.length - 1]!
		: null
	const commentPeekCount = selectedCommentThread.length === 1 ? "1 comment" : `${selectedCommentThread.length} comments`
	const commentPeekBody = commentPeek?.body.split("\n")[0]?.trim() || "(empty comment)"
	const commentPeekMeta = commentPeek && selectedCommentAnchor
		? `${selectedSideLabel ?? "line"} ${selectedCommentAnchor.side === "RIGHT" ? "+" : "-"}${selectedCommentAnchor.line}  ${commentPeek.author}  ${commentPeekCount}  enter thread  a comment`
		: ""
	const stickyScrollTop = Math.max(0, Math.floor(scrollTop))
	const stickyFile = stackedDiffFileAtLine(stackedFiles, stickyScrollTop) ?? stackedFiles[0]
	const stickyArrayIndex = stickyFile ? stackedFiles.indexOf(stickyFile) : -1
	const incomingStickyFile = stickyArrayIndex >= 0 ? stackedFiles[stickyArrayIndex + 1] : undefined
	const incomingHeaderDistance = incomingStickyFile ? incomingStickyFile.headerLine - stickyScrollTop : Number.POSITIVE_INFINITY
	const incomingFile = incomingHeaderDistance === 1 ? incomingStickyFile : undefined
	const stickyCommentLabelFor = (stackedFile: StackedDiffFilePatch | undefined) => {
		if (!commentMode) return ""
		if (!selectedCommentAnchor) return "  c no lines"
		if (selectedCommentAnchor.fileIndex !== stackedFile?.index) return ""
		return `  ${selectedCommentAnchor.side === "RIGHT" ? "right" : "left"} ${selectedCommentAnchor.side === "RIGHT" ? "+" : "-"}${selectedCommentAnchor.line}`
	}
	const stickyCommentColor = selectedCommentAnchor?.side === "LEFT" ? colors.status.failing : colors.status.passing
	const handleDiffMouseDown = function (this: ScrollBoxRenderable, event: MouseEvent) {
		if (event.button !== 0) return
		const localY = event.y - this.viewport.y
		if (localY < 0 || localY >= this.viewport.height) return
		const localX = event.x - this.viewport.x
		const side = view === "split"
			? localX < Math.floor(paneWidth / 2) ? "LEFT" : "RIGHT"
			: null
		onSelectCommentLine(Math.max(0, Math.floor(this.scrollTop + localY)), side)
		event.preventDefault()
		event.stopPropagation()
	}

	return (
		<box height={height} flexDirection="column">
			<box height={1} paddingLeft={1} paddingRight={1}>
				<TextLine>
					<span fg={colors.count}>#{pullRequest.number}</span>
					<span fg={colors.muted}> {shortRepoName(pullRequest.repository)}</span>
					<span fg={colors.muted}>{" ".repeat(headerGap)}</span>
					<DiffStats pullRequest={pullRequest} />
				</TextLine>
			</box>
			<Divider width={paneWidth} />
			<scrollbox ref={scrollRef} focused={!commentMode} flexGrow={1} scrollY scrollX={false} onMouseDown={handleDiffMouseDown}>
				{stackedFiles.map((stackedFile) => (
					<box key={`${pullRequest.url}-${stackedFile.index}-${view}-${wrapMode}`} flexDirection="column" flexShrink={0}>
						{stackedFile.index > 0 ? <Divider width={paneWidth} /> : null}
						<box height={1} paddingLeft={1} paddingRight={1}>
							<FileHeader file={stackedFile.file} index={stackedFile.index} count={readyFiles.length} width={paneWidth} />
						</box>
						<Divider width={paneWidth} />
						<diff
							ref={(diff: DiffRenderable | null) => setDiffRef(stackedFile.index, diff)}
							diff={stackedFile.file.patch}
							view={view}
							syncScroll
							filetype={stackedFile.file.filetype ?? "text"}
							syntaxStyle={syntaxStyle}
							showLineNumbers
							wrapMode={wrapMode}
							addedBg={colors.diff.addedBg}
							removedBg={colors.diff.removedBg}
							contextBg={colors.diff.contextBg}
							addedSignColor={colors.status.passing}
							removedSignColor={colors.status.failing}
							lineNumberFg={colors.muted}
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
							<box height={1} paddingLeft={1} paddingRight={1} backgroundColor={colors.background}>
								<FileHeader file={incomingFile.file} index={incomingFile.index} count={readyFiles.length} width={paneWidth} suffix={stickyCommentLabelFor(incomingFile)} suffixColor={stickyCommentColor} />
							</box>
						</>
					) : (
						<>
							<box height={1} paddingLeft={1} paddingRight={1} backgroundColor={colors.background}>
								<FileHeader file={stickyFile.file} index={stickyFile.index} count={readyFiles.length} width={paneWidth} suffix={stickyCommentLabelFor(stickyFile)} suffixColor={stickyCommentColor} />
							</box>
							<Divider width={paneWidth} />
						</>
					)}
				</box>
			) : null}
			{commentPeek ? (
				<>
					<Divider width={paneWidth} />
					<box height={1} paddingLeft={1} paddingRight={1}>
						<PlainLine text={fitCell(commentPeekMeta, Math.max(1, paneWidth - 2))} fg={colors.count} />
					</box>
					<box height={1} paddingLeft={1} paddingRight={1}>
						<PlainLine text={fitCell(commentPeekBody, Math.max(1, paneWidth - 2))} fg={colors.text} />
					</box>
				</>
			) : null}
		</box>
	)
}
