import { useEffect, useMemo, useRef } from "react"
import type { ScrollBoxRenderable } from "@opentui/core"
import type { PullRequestComment, PullRequestItem } from "../domain.js"
import { colors } from "./colors.js"
import { commentBodyRows, commentCountText, commentMetaSegments, type CommentDisplayLine } from "./comments.js"
import { centerCell, Divider, Filler, fitCell, HintRow, PaddedRow, PlainLine, TextLine, type HintItem } from "./primitives.js"
import { shortRepoName } from "./pullRequests.js"

const META_PREFIX_WIDTH = 2 // "• "

interface CommentBlock {
	readonly comment: PullRequestComment
	readonly meta: CommentDisplayLine
	readonly body: readonly CommentDisplayLine[]
	readonly height: number
}

const reviewContextGroups = (comment: PullRequestComment, width: number): readonly (readonly { readonly text: string; readonly fg: string }[])[] => {
	if (comment._tag !== "review-comment") return []
	const lineSuffix = `:${comment.line}`
	const pathLabel = `${comment.path}${lineSuffix}`
	const room = Math.max(8, width - META_PREFIX_WIDTH - comment.author.length - 16)
	const truncated = pathLabel.length <= room ? pathLabel : `…${pathLabel.slice(-(room - 1))}`
	return [[{ text: truncated, fg: colors.inlineCode }]]
}

const buildBlocks = (comments: readonly PullRequestComment[], width: number): readonly CommentBlock[] =>
	comments.map((comment) => {
		const meta: CommentDisplayLine = { key: `${comment.id}:meta`, segments: commentMetaSegments({ item: comment, groups: reviewContextGroups(comment, width) }) }
		const body = commentBodyRows({ keyPrefix: comment.id, body: comment.body, width })
		// Each block: 1 meta line + body lines + 1 spacer line.
		return { comment, meta, body, height: 1 + body.length + 1 }
	})

const blockOffsets = (blocks: readonly CommentBlock[]): readonly number[] => {
	const offsets: number[] = []
	let cursor = 0
	for (const block of blocks) {
		offsets.push(cursor)
		cursor += block.height
	}
	return offsets
}

export const CommentsPane = ({
	pullRequest,
	comments,
	status,
	selectedIndex,
	contentWidth,
	paneWidth,
	height,
	loadingIndicator,
}: {
	pullRequest: PullRequestItem
	comments: readonly PullRequestComment[]
	status: "idle" | "loading" | "ready"
	selectedIndex: number
	contentWidth: number
	paneWidth: number
	height: number
	loadingIndicator: string
}) => {
	const blocks = useMemo(() => buildBlocks(comments, contentWidth), [comments, contentWidth])
	const offsets = useMemo(() => blockOffsets(blocks), [blocks])
	const scrollboxRef = useRef<ScrollBoxRenderable | null>(null)
	const safeIndex = blocks.length === 0 ? 0 : Math.max(0, Math.min(selectedIndex, blocks.length - 1))

	const headerLine = (() => {
		const repo = shortRepoName(pullRequest.repository)
		const count = status === "loading" ? `${loadingIndicator} loading` : commentCountText(comments.length)
		const left = `Comments #${pullRequest.number}  ${repo}`
		const gap = Math.max(2, contentWidth - left.length - count.length)
		return { left, gap, count }
	})()

	const bodyHeight = Math.max(1, height - 4) // header + 2 dividers + footer

	useEffect(() => {
		const scrollbox = scrollboxRef.current
		if (!scrollbox || blocks.length === 0) return
		const blockTop = offsets[safeIndex] ?? 0
		const blockBottom = blockTop + (blocks[safeIndex]?.height ?? 1)
		const viewportTop = scrollbox.scrollTop
		const viewportBottom = viewportTop + bodyHeight
		if (blockTop < viewportTop) scrollbox.scrollTo({ x: 0, y: blockTop })
		else if (blockBottom > viewportBottom) scrollbox.scrollTo({ x: 0, y: Math.max(0, blockBottom - bodyHeight) })
	}, [safeIndex, blocks, offsets, bodyHeight])

	const footerItems: readonly HintItem[] = [
		{ key: "↑↓", label: "move", disabled: blocks.length <= 1 },
		{ key: "o", label: "open", disabled: blocks.length === 0 },
		{ key: "r", label: "refresh" },
		{ key: "esc", label: "close" },
	]

	const isReady = status === "ready" || comments.length > 0
	const showLoading = status === "loading" && comments.length === 0
	const showEmpty = isReady && comments.length === 0

	return (
		<box flexDirection="column" height={height} backgroundColor={colors.background}>
			<PaddedRow>
				<TextLine>
					<span fg={colors.accent} attributes={1}>
						{headerLine.left}
					</span>
					<span fg={colors.muted}>{" ".repeat(headerLine.gap)}</span>
					<span fg={colors.muted}>{headerLine.count}</span>
				</TextLine>
			</PaddedRow>
			<Divider width={paneWidth} />
			<box height={bodyHeight} flexDirection="column">
				{showLoading ? (
					<>
						<Filler rows={Math.max(0, Math.floor((bodyHeight - 1) / 2))} prefix="loading-top" />
						<PlainLine text={centerCell(`${loadingIndicator} Loading comments`, contentWidth)} fg={colors.muted} />
						<Filler rows={Math.max(0, Math.ceil((bodyHeight - 1) / 2))} prefix="loading-bottom" />
					</>
				) : showEmpty ? (
					<>
						<Filler rows={Math.max(0, Math.floor((bodyHeight - 1) / 2))} prefix="empty-top" />
						<PlainLine text={centerCell("No comments yet.", contentWidth)} fg={colors.muted} />
						<Filler rows={Math.max(0, Math.ceil((bodyHeight - 1) / 2))} prefix="empty-bottom" />
					</>
				) : (
					<scrollbox ref={scrollboxRef} focusable={false} flexGrow={1} verticalScrollbarOptions={{ visible: true }}>
						{blocks.map((block, index) => {
							const isSelected = index === safeIndex
							return (
								<box key={block.comment.id} flexDirection="column">
									<TextLine bg={isSelected ? colors.selectedBg : undefined}>
										<span> </span>
										{block.meta.segments.map((segment, segmentIndex) =>
											segment.bold ? (
												<span key={segmentIndex} fg={isSelected ? colors.selectedText : segment.fg} attributes={1}>
													{segment.text}
												</span>
											) : (
												<span key={segmentIndex} fg={isSelected ? colors.selectedText : segment.fg}>
													{segment.text}
												</span>
											),
										)}
									</TextLine>
									{block.body.map((line) => (
										<TextLine key={line.key}>
											<span> </span>
											{line.segments.map((segment, segmentIndex) =>
												segment.bold ? (
													<span key={segmentIndex} fg={segment.fg} attributes={1}>
														{segment.text}
													</span>
												) : (
													<span key={segmentIndex} fg={segment.fg}>
														{segment.text}
													</span>
												),
											)}
										</TextLine>
									))}
									<PlainLine text={fitCell("", contentWidth)} fg={colors.muted} />
								</box>
							)
						})}
					</scrollbox>
				)}
			</box>
			<Divider width={paneWidth} />
			<PaddedRow>
				<HintRow items={footerItems} />
			</PaddedRow>
		</box>
	)
}
