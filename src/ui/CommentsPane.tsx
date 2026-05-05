import { useEffect, useMemo, useRef } from "react"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import type { PullRequestComment, PullRequestItem } from "../domain.js"
import { colors } from "./colors.js"
import {
	commentBodyRows,
	commentCountText,
	commentMetaSegments,
	CommentSegmentsLine,
	QUOTE_HEADER_RE,
	stripQuoteHeader,
	type CommentDisplayLine,
	type CommentSegment,
} from "./comments.js"
import { truncateConversationPath } from "./DetailsPane.js"
import { centerCell, Divider, Filler, PaddedRow, PlainLine, TextLine } from "./primitives.js"
import { shortRepoName } from "./pullRequests.js"

const META_PREFIX_WIDTH = 2 // "• "
const PLACEHOLDER_KEY = "__placeholder_new_comment"

// Comments view always exposes one virtual "+ Add new comment" row at the
// bottom, so the selectable row count is comments.length + this.
const PLACEHOLDER_ROWS = 1
export const commentsViewRowCount = (count: number) => count + PLACEHOLDER_ROWS

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
	const pathLabel = `${comment.path}:${comment.line}`
	const room = Math.max(8, width - META_PREFIX_WIDTH - comment.author.length - 16)
	return [[{ text: truncateConversationPath(pathLabel, room), fg: colors.inlineCode }]]
}

// GitHub doesn't thread issue comments, so `issueQuoteParent` reverse-engineers
// the parent from the `> @author wrote:` header that `quotedReplyBody` writes.
// `collapseWhitespace` makes the body comparison tolerant of the blank line
// the parent inserts between its own quote header and reply text.
const collapseWhitespace = (text: string): string =>
	text
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0)
		.join("\n")
		.trim()

const issueQuoteParent = (
	comment: PullRequestComment & { readonly _tag: "comment" },
	candidates: readonly PullRequestComment[],
	collapsedById: Map<string, string>,
): string | null => {
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
		const body = collapsedById.get(candidate.id) ?? ""
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
	const collapsedIssueBodies = new Map<string, string>()
	for (const comment of comments) {
		byId.set(comment.id, comment)
		if (comment._tag === "comment") collapsedIssueBodies.set(comment.id, collapseWhitespace(comment.body))
	}

	const parentIdFor = (comment: PullRequestComment): string | null => {
		if (comment._tag === "review-comment") return comment.inReplyTo
		return issueQuoteParent(comment, comments, collapsedIssueBodies)
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
	themeGeneration,
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
	themeGeneration: number
}) => {
	const realBlocks = useMemo(() => buildBlocks(orderedComments, contentWidth), [orderedComments, contentWidth, themeGeneration])
	const blocks = useMemo<readonly CommentBlock[]>(() => [...realBlocks, placeholderBlock], [realBlocks])
	const offsets = useMemo(() => blockOffsets(blocks), [blocks])
	const scrollboxRef = useRef<ScrollBoxRenderable | null>(null)
	const safeIndex = Math.max(0, Math.min(selectedIndex, blocks.length - 1))

	const headerLine = (() => {
		const repo = shortRepoName(pullRequest.repository)
		const count = status === "loading" ? `${loadingIndicator} loading` : commentCountText(comments.length)
		const left = `Comments #${pullRequest.number}  ${repo}`
		const gap = Math.max(2, contentWidth - left.length - count.length)
		return { left, gap, count }
	})()

	// height = header (1) + body divider (1) + body (variable). The bottom
	// divider + footer live in the App-level chrome (FooterHints) so the
	// CommentsPane stays consistent with DiffPane / DetailsPane.
	const bodyHeight = Math.max(1, height - 2)

	const showLoading = status !== "ready"
	const blockRows = blocks.reduce((total, block) => total + block.height, 0)
	const commentsNeedScroll = !showLoading && blockRows > bodyHeight

	useEffect(() => {
		if (!commentsNeedScroll) return
		const scrollbox = scrollboxRef.current
		if (!scrollbox) return
		const blockTop = offsets[safeIndex] ?? 0
		const blockBottom = blockTop + (blocks[safeIndex]?.height ?? 1)
		const viewportTop = scrollbox.scrollTop
		const viewportBottom = viewportTop + bodyHeight
		if (blockTop < viewportTop) scrollbox.scrollTo({ x: 0, y: blockTop })
		else if (blockBottom > viewportBottom) scrollbox.scrollTo({ x: 0, y: Math.max(0, blockBottom - bodyHeight) })
	}, [safeIndex, blocks, offsets, bodyHeight, commentsNeedScroll])

	const renderedBlocks = blocks.map((block, index) => {
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
	})

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
				) : !commentsNeedScroll ? (
					<box flexGrow={1} flexDirection="column">
						{renderedBlocks}
						<Filler rows={Math.max(0, bodyHeight - blockRows)} prefix="comments-pad" />
					</box>
				) : (
					<scrollbox ref={scrollboxRef} focusable={false} flexGrow={1} verticalScrollbarOptions={{ visible: true }}>
						{renderedBlocks}
					</scrollbox>
				)}
			</box>
		</box>
	)
}
