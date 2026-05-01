import type { DiffRenderable, ScrollBoxRenderable } from "@opentui/core"
import { useMemo, type Ref } from "react"
import type { PullRequestItem, PullRequestReviewComment } from "../domain.js"
import { colors, type ThemeId } from "./colors.js"
import { createDiffSyntaxStyle, diffFileStats, diffFileStatText, diffStatText, safeDiffFileIndex, type DiffCommentAnchor, type PullRequestDiffState, type StackedDiffFilePatch } from "./diff.js"
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

const FileStats = ({ file }: { file: StackedDiffFilePatch["file"] }) => {
	const stats = diffFileStats(file)
	return (
		<>
			{stats.additions > 0 ? <span fg={colors.status.passing}>{`+${stats.additions}`}</span> : null}
			{stats.additions > 0 && stats.deletions > 0 ? <span fg={colors.muted}> </span> : null}
			{stats.deletions > 0 ? <span fg={colors.status.failing}>{`-${stats.deletions}`}</span> : null}
		</>
	)
}

const FileHeader = ({ file, index, count, width }: { file: StackedDiffFilePatch["file"]; index: number; count: number; width: number }) => {
	const counter = `${index + 1}/${count}`
	const statsText = diffFileStatText(file)
	const nameWidth = Math.max(1, width - counter.length - statsText.length - 5)
	return (
		<TextLine>
			<span fg={colors.muted}>{counter} </span>
			<span fg={colors.text}>{fitCell(file.name, nameWidth)}</span>
			{statsText ? <span fg={colors.muted}>  </span> : null}
			<FileStats file={file} />
		</TextLine>
	)
}

export const PullRequestDiffPane = ({
	pullRequest,
	diffState,
	stackedFiles,
	fileIndex,
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
	themeId,
}: {
	pullRequest: PullRequestItem | null
	diffState: PullRequestDiffState | undefined
	stackedFiles: readonly StackedDiffFilePatch[]
	fileIndex: number
	view: "unified" | "split"
	wrapMode: "none" | "word"
	paneWidth: number
	height: number
	loadingIndicator: string
	scrollRef: Ref<ScrollBoxRenderable>
	setDiffRef: (index: number, diff: DiffRenderable | null) => void
	commentMode: boolean
	selectedCommentAnchor: DiffCommentAnchor | null
	selectedCommentThread: readonly PullRequestReviewComment[]
	commentCount: number
	themeId: ThemeId
}) => {
	const readyFiles = diffState?.status === "ready" ? diffState.files : []
	const safeIndex = safeDiffFileIndex(readyFiles, fileIndex)
	const file = readyFiles[safeIndex] ?? null
	const syntaxStyle = useMemo(() => createDiffSyntaxStyle(), [themeId])

	if (!pullRequest) {
		return <LoadingPane content={{ title: "No pull request selected", hint: "Press esc to go back" }} width={paneWidth} height={height} />
	}

	const stats = diffStatText(pullRequest)
	const headerWidth = Math.max(24, paneWidth - 2)
	const leftHeader = `#${pullRequest.number} ${shortRepoName(pullRequest.repository)}`
	const headerGap = Math.max(2, headerWidth - leftHeader.length - stats.length)

	if (!diffState || diffState.status === "loading") {
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

	if (diffState.status === "error") {
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

	if (readyFiles.length === 0 || !file) {
		return <LoadingPane content={{ title: "No diff", hint: "This PR has no patch contents" }} width={paneWidth} height={height} />
	}

	const fileCounter = `${safeIndex + 1}/${readyFiles.length}`
	const currentFileStatsText = file ? diffFileStatText(file) : ""
	const selectedSideLabel = selectedCommentAnchor?.side === "RIGHT" ? "right" : selectedCommentAnchor?.side === "LEFT" ? "left" : null
	const commentLabel = commentMode && selectedCommentAnchor
		? `  ${selectedSideLabel} ${selectedCommentAnchor.side === "RIGHT" ? "+" : "-"}${selectedCommentAnchor.line}`
		: commentMode ? "  c no lines" : ""
	const commentLabelColor = commentMode && selectedCommentAnchor?.side === "LEFT"
		? colors.status.failing
		: commentMode ? colors.status.passing : colors.status.passing
	const fileNameWidth = Math.max(8, headerWidth - fileCounter.length - currentFileStatsText.length - commentLabel.length - 4)
	const commentPeek = commentMode && selectedCommentAnchor && selectedCommentThread.length > 0
		? selectedCommentThread[selectedCommentThread.length - 1]!
		: null
	const commentPeekCount = selectedCommentThread.length === 1 ? "1 comment" : `${selectedCommentThread.length} comments`
	const commentPeekBody = commentPeek?.body.split("\n")[0]?.trim() || "(empty comment)"
	const commentPeekMeta = commentPeek && selectedCommentAnchor
		? `${selectedSideLabel ?? "line"} ${selectedCommentAnchor.side === "RIGHT" ? "+" : "-"}${selectedCommentAnchor.line}  ${commentPeek.author}  ${commentPeekCount}  enter thread  a comment`
		: ""

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
			<box height={1} paddingLeft={1} paddingRight={1}>
				<TextLine>
					<span fg={colors.text}>{fitCell(file.name, fileNameWidth)}</span>
					<span fg={colors.muted}>  {fileCounter}</span>
					{currentFileStatsText ? <span fg={colors.muted}>  </span> : null}
					<FileStats file={file} />
					{commentLabel ? <span fg={commentLabelColor}>{commentLabel}</span> : null}
				</TextLine>
			</box>
			<Divider width={paneWidth} />
			<scrollbox ref={scrollRef} focused={!commentMode} flexGrow={1} scrollY scrollX={false}>
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
