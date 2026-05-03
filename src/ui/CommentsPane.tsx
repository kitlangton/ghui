import { useEffect, useMemo, useRef } from "react"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import type { PullRequestComment, PullRequestItem } from "../domain.js"
import { colors } from "./colors.js"
import { commentBodyRows, commentCountText, commentMetaSegments, CommentSegmentsLine, type CommentDisplayLine, type CommentSegment } from "./comments.js"
import { centerCell, Divider, Filler, HintRow, PaddedRow, PlainLine, TextLine, type HintItem } from "./primitives.js"
import { shortRepoName } from "./pullRequests.js"

const META_PREFIX_WIDTH = 2 // "• "
const PLACEHOLDER_KEY = "__placeholder_new_comment"

// Comments view always exposes one virtual "+ Add new comment" row at the
// bottom, so the selectable row count is comments.length + this.
export const COMMENTS_VIEW_PLACEHOLDER_ROWS = 1
export const commentsViewRowCount = (count: number) => count + COMMENTS_VIEW_PLACEHOLDER_ROWS

// Cap nesting depth — deep chains otherwise eat the pane width.
const MAX_INDENT_LEVELS = 3
const REPLY_INDENT_COLS = 4

interface CommentBlock {
	readonly key: string
	readonly comment: PullRequestComment | null
	readonly meta: CommentDisplayLine
	readonly body: readonly CommentDisplayLine[]
	readonly height: number
	readonly indent: number
	readonly isPlaceholder: boolean
}

const reviewContextGroups = (comment: PullRequestComment, width: number): readonly (readonly { readonly text: string; readonly fg: string }[])[] => {
	if (comment._tag !== "review-comment") return []
	const lineSuffix = `:${comment.line}`
	const pathLabel = `${comment.path}${lineSuffix}`
	const room = Math.max(8, width - META_PREFIX_WIDTH - comment.author.length - 16)
	const truncated = pathLabel.length <= room ? pathLabel : `…${pathLabel.slice(-(room - 1))}`
	return [[{ text: truncated, fg: colors.inlineCode }]]
}

// GitHub doesn't thread issue comments, but our quote-reply UX produces a body
// like `> @author wrote:\n> <quoted>\n\n<reply>`. We use that prefix to find a
// likely parent so the reply visually nests instead of falling to the bottom.
const QUOTE_HEADER_RE = /^>\s*@(\S+)\s+wrote:\s*\n((?:>[^\n]*(?:\n|$))+)/

// When we nest a quote-reply under its parent, the quoted block becomes visual
// noise — the parent is already shown right above. Strip the leading quote
// header so the rendered body is just the user's actual reply text.
const stripQuoteHeader = (body: string): string => {
	const match = QUOTE_HEADER_RE.exec(body)
	if (!match) return body
	return body.slice(match[0].length).replace(/^\n+/, "")
}

// Whitespace-tolerant compare: collapse blank lines and trailing spaces so the
// quote text we extracted from a child matches its parent's body even when the
// parent has its own blank line between the quote header and the reply text.
const collapseWhitespace = (text: string): string =>
	text
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0)
		.join("\n")
		.trim()

const issueQuoteParent = (comment: PullRequestComment & { readonly _tag: "comment" }, candidates: readonly PullRequestComment[]): string | null => {
	const match = QUOTE_HEADER_RE.exec(comment.body)
	if (!match) return null
	const author = match[1] ?? ""
	const quoted = collapseWhitespace(
		(match[2] ?? "")
			.split("\n")
			.map((line) => line.replace(/^>\s?/, ""))
			.join("\n"),
	)
	if (quoted.length === 0) return null
	for (const candidate of candidates) {
		if (candidate.id === comment.id) continue
		if (candidate._tag !== "comment") continue
		if (candidate.author !== author) continue
		const body = collapseWhitespace(candidate.body)
		if (body.length === 0) continue
		if (body === quoted || body.startsWith(quoted) || quoted.startsWith(body)) return candidate.id
	}
	return null
}

export interface OrderedComment {
	readonly comment: PullRequestComment
	readonly indent: number
}

// Order comments so replies sit right after their parent: review threads via
// `inReplyTo`, issue-comment quote replies via the heuristic above. Roots
// preserve overall createdAt order; replies render at the parent's depth + 1
// (capped at MAX_INDENT_LEVELS so deep chains don't run off the pane).
export const orderCommentsForDisplay = (comments: readonly PullRequestComment[]): readonly OrderedComment[] => {
	const byId = new Map<string, PullRequestComment>()
	for (const comment of comments) byId.set(comment.id, comment)

	const parentIdFor = (comment: PullRequestComment): string | null => {
		if (comment._tag === "review-comment") return comment.inReplyTo
		return issueQuoteParent(comment, comments)
	}

	const childrenByParent = new Map<string, PullRequestComment[]>()
	const roots: PullRequestComment[] = []
	for (const comment of comments) {
		const parentId = parentIdFor(comment)
		if (parentId && byId.has(parentId)) {
			const list = childrenByParent.get(parentId) ?? []
			list.push(comment)
			childrenByParent.set(parentId, list)
		} else {
			roots.push(comment)
		}
	}

	const byTime = (left: PullRequestComment, right: PullRequestComment) => (left.createdAt?.getTime() ?? 0) - (right.createdAt?.getTime() ?? 0)
	const ordered: { readonly comment: PullRequestComment; readonly indent: number }[] = []
	const visited = new Set<string>()
	const visit = (comment: PullRequestComment, indent: number): void => {
		if (visited.has(comment.id)) return
		visited.add(comment.id)
		ordered.push({ comment, indent: Math.min(indent, MAX_INDENT_LEVELS) })
		const children = (childrenByParent.get(comment.id) ?? []).slice().sort(byTime)
		for (const child of children) visit(child, indent + 1)
	}
	for (const root of roots) visit(root, 0)
	return ordered
}

const buildBlocks = (ordered: readonly OrderedComment[], width: number): readonly CommentBlock[] =>
	ordered.map(({ comment, indent }) => {
		const usableWidth = Math.max(8, width - indent * REPLY_INDENT_COLS)
		// Don't repeat the file path for replies — the thread root carries it.
		const groups = indent > 0 ? [] : reviewContextGroups(comment, usableWidth)
		const marker = indent > 0 ? { text: "↳", fg: colors.muted } : undefined
		const meta: CommentDisplayLine = { key: `${comment.id}:meta`, segments: commentMetaSegments({ item: comment, groups, marker }) }
		// When nested, the parent is right above — the quote header becomes noise.
		const renderedBody = indent > 0 && comment._tag === "comment" ? stripQuoteHeader(comment.body) : comment.body
		const body = commentBodyRows({ keyPrefix: comment.id, body: renderedBody, width: usableWidth })
		// Reserve 1 spacer line between blocks for breathing room.
		return { key: comment.id, comment, meta, body, height: 1 + body.length + 1, indent, isPlaceholder: false }
	})

const placeholderBlock: CommentBlock = {
	key: PLACEHOLDER_KEY,
	comment: null,
	meta: { key: `${PLACEHOLDER_KEY}:meta`, segments: [] },
	body: [],
	height: 1,
	indent: 0,
	isPlaceholder: true,
}

const blockOffsets = (blocks: readonly CommentBlock[]): readonly number[] => {
	const offsets: number[] = []
	let cursor = 0
	for (const block of blocks) {
		offsets.push(cursor)
		cursor += block.height
	}
	return offsets
}

const withReplyIndent = (segments: readonly CommentSegment[], indent: number): readonly CommentSegment[] =>
	indent === 0 ? segments : [{ text: " ".repeat(indent * REPLY_INDENT_COLS), fg: colors.muted }, ...segments]

export const CommentsPane = ({
	pullRequest,
	comments,
	orderedComments,
	status,
	selectedIndex,
	contentWidth,
	paneWidth,
	height,
	loadingIndicator,
}: {
	pullRequest: PullRequestItem
	comments: readonly PullRequestComment[]
	orderedComments: readonly OrderedComment[]
	status: "idle" | "loading" | "ready"
	selectedIndex: number
	contentWidth: number
	paneWidth: number
	height: number
	loadingIndicator: string
}) => {
	const realBlocks = useMemo(() => buildBlocks(orderedComments, contentWidth), [orderedComments, contentWidth])
	const blocks = useMemo<readonly CommentBlock[]>(() => [...realBlocks, placeholderBlock], [realBlocks])
	const offsets = useMemo(() => blockOffsets(blocks), [blocks])
	const scrollboxRef = useRef<ScrollBoxRenderable | null>(null)
	const safeIndex = Math.max(0, Math.min(selectedIndex, blocks.length - 1))
	const placeholderSelected = blocks[safeIndex]?.isPlaceholder ?? false

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
		if (!scrollbox) return
		const blockTop = offsets[safeIndex] ?? 0
		const blockBottom = blockTop + (blocks[safeIndex]?.height ?? 1)
		const viewportTop = scrollbox.scrollTop
		const viewportBottom = viewportTop + bodyHeight
		if (blockTop < viewportTop) scrollbox.scrollTo({ x: 0, y: blockTop })
		else if (blockBottom > viewportBottom) scrollbox.scrollTo({ x: 0, y: Math.max(0, blockBottom - bodyHeight) })
	}, [safeIndex, blocks, offsets, bodyHeight])

	const showLoading = status === "loading" && comments.length === 0
	const onRealComment = !placeholderSelected && realBlocks.length > 0
	const replyTarget = onRealComment ? realBlocks[safeIndex]?.comment : null
	const enterLabel = replyTarget?._tag === "review-comment" ? "reply" : "new"

	const footerItems: readonly HintItem[] = [
		{ key: "↑↓", label: "move", disabled: blocks.length <= 1 },
		{ key: "enter", label: enterLabel },
		{ key: "a", label: "new" },
		{ key: "o", label: "open", disabled: !onRealComment },
		{ key: "r", label: "refresh" },
		{ key: "esc", label: "close" },
	]

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
				) : (
					<scrollbox ref={scrollboxRef} focusable={false} flexGrow={1}>
						{blocks.map((block, index) => {
							const isSelected = index === safeIndex
							if (block.isPlaceholder) {
								return (
									<TextLine key={block.key}>
										<span fg={isSelected ? colors.accent : colors.muted} attributes={isSelected ? TextAttributes.BOLD : 0}>
											+ Add new comment
										</span>
									</TextLine>
								)
							}
							return (
								<box key={block.key} flexDirection="column">
									<CommentSegmentsLine segments={withReplyIndent(block.meta.segments, block.indent)} selected={isSelected} />
									{block.body.map((line) => (
										<CommentSegmentsLine key={line.key} segments={withReplyIndent(line.segments, block.indent)} />
									))}
									<PlainLine text="" fg={colors.muted} />
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
