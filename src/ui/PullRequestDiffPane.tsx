import type { ScrollBoxRenderable } from "@opentui/core"
import { useMemo, type Ref } from "react"
import type { PullRequestItem } from "../domain.js"
import { colors, type ThemeId } from "./colors.js"
import { createDiffSyntaxStyle, diffStatText, patchRenderableLineCount, type PullRequestDiffState } from "./diff.js"
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

export const PullRequestDiffPane = ({
	pullRequest,
	diffState,
	fileIndex,
	view,
	wrapMode,
	paneWidth,
	height,
	loadingIndicator,
	scrollRef,
	themeId,
}: {
	pullRequest: PullRequestItem | null
	diffState: PullRequestDiffState | undefined
	fileIndex: number
	view: "unified" | "split"
	wrapMode: "none" | "word"
	paneWidth: number
	height: number
	loadingIndicator: string
	scrollRef: Ref<ScrollBoxRenderable>
	themeId: ThemeId
}) => {
	const readyFiles = diffState?.status === "ready" ? diffState.files : []
	const safeIndex = readyFiles.length > 0 ? Math.max(0, Math.min(fileIndex, readyFiles.length - 1)) : 0
	const file = readyFiles[safeIndex] ?? null
	const diffHeight = useMemo(
		() => file ? patchRenderableLineCount(file.patch, view, wrapMode, paneWidth) : 1,
		[file?.patch, view, wrapMode, paneWidth],
	)
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
	const fileNameWidth = Math.max(8, headerWidth - fileCounter.length - 2)

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
				</TextLine>
			</box>
			<Divider width={paneWidth} />
			<scrollbox ref={scrollRef} focused flexGrow={1} scrollY scrollX={false}>
				<diff
					key={`${pullRequest.url}-${safeIndex}-${view}-${wrapMode}`}
					diff={file.patch}
					view={view}
					syncScroll
					filetype={file.filetype ?? "text"}
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
					height={diffHeight}
					style={{ flexShrink: 0 }}
				/>
			</scrollbox>
		</box>
	)
}
