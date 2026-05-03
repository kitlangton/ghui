import { TextAttributes } from "@opentui/core"
import { formatRelativeDate } from "../date.js"
import type { DiffCommentSide } from "../domain.js"
import { colors } from "./colors.js"
import { fitCell, TextLine } from "./primitives.js"

export interface CommentSegment {
	readonly text: string
	readonly fg: string
	readonly bold?: boolean
	readonly underline?: boolean
	readonly url?: string
}

export interface CommentDisplayLine {
	readonly key: string
	readonly segments: readonly CommentSegment[]
}

export interface CommentDisplayItem {
	readonly id: string
	readonly author: string
	readonly body: string
	readonly createdAt: Date | null
	readonly side?: DiffCommentSide | null
}

export const commentCountText = (count: number) => (count === 1 ? "1 comment" : `${count} comments`)

export const commentSideColor = (side: DiffCommentSide | null | undefined) => (side === "LEFT" ? colors.status.failing : side === "RIGHT" ? colors.status.passing : colors.count)

const commentTimestamp = (date: Date | null) => {
	if (!date) return ""
	const ageMs = Date.now() - date.getTime()
	const minuteMs = 60_000
	const hourMs = 60 * minuteMs
	if (ageMs < minuteMs) return "just now"
	if (ageMs < hourMs) return `${Math.max(1, Math.floor(ageMs / minuteMs))}m ago`
	if (ageMs < 24 * hourMs) return `${Math.max(1, Math.floor(ageMs / hourMs))}h ago`
	return formatRelativeDate(date)
}

const inlineCommentSegments = (text: string, fg = colors.text): readonly CommentSegment[] =>
	text
		.split(/(`[^`]+`)/g)
		.filter((part) => part.length > 0)
		.map((part) => (part.startsWith("`") && part.endsWith("`") ? { text: part.slice(1, -1), fg: colors.inlineCode } : { text: part, fg }))

interface WrappedLine {
	readonly text: string
	readonly quote: boolean
}

const QUOTE_PREFIX = /^>\s?/

const wrapCommentText = (body: string, width: number): readonly WrappedLine[] => {
	const safeWidth = Math.max(1, width)
	const sourceLines =
		body.trim().length === 0
			? [{ text: "(empty comment)", quote: false }]
			: body
					.replace(/\r/g, "")
					.trim()
					.split("\n")
					.flatMap((raw) => {
						const trimmed = raw.trim()
						if (trimmed.length === 0) return []
						const isQuote = QUOTE_PREFIX.test(trimmed)
						return [{ text: isQuote ? trimmed.replace(QUOTE_PREFIX, "") : trimmed, quote: isQuote }]
					})
	return sourceLines.flatMap(({ text, quote }) => {
		const chunks: WrappedLine[] = []
		const effectiveWidth = quote ? Math.max(1, safeWidth - 2) : safeWidth
		if (text.length === 0) chunks.push({ text: "", quote })
		else for (let index = 0; index < text.length; index += effectiveWidth) chunks.push({ text: text.slice(index, index + effectiveWidth), quote })
		return chunks
	})
}

const appendMetaGroup = (segments: CommentSegment[], group: readonly CommentSegment[]) => {
	if (group.length === 0) return
	segments.push({ text: " · ", fg: colors.muted }, ...group)
}

export const commentMetaSegments = ({
	item,
	markerLabel,
	groups = [],
	marker,
}: {
	readonly item: CommentDisplayItem
	readonly markerLabel?: string | null | undefined
	readonly groups?: readonly (readonly CommentSegment[])[] | undefined
	// Override the leading glyph + color (e.g. "↳" in muted for a thread reply).
	readonly marker?: { readonly text: string; readonly fg: string } | undefined
}): readonly CommentSegment[] => {
	const sideColor = commentSideColor(item.side)
	const timestamp = commentTimestamp(item.createdAt)
	const m = marker ?? { text: "●", fg: colors.count }
	const segments: CommentSegment[] = [
		{ text: m.text, fg: m.fg, bold: true },
		...(markerLabel ? [{ text: ` ${markerLabel}`, fg: sideColor, bold: true }] : []),
		{ text: " ", fg: colors.muted },
		{ text: item.author, fg: colors.count, bold: true },
	]
	if (timestamp) appendMetaGroup(segments, [{ text: timestamp, fg: colors.muted }])
	for (const group of groups) appendMetaGroup(segments, group)
	return segments
}

// Body indent aligns content under the author name in the meta line above.
export const COMMENT_BODY_INDENT = "  "
const COMMENT_QUOTE_PREFIX = `${COMMENT_BODY_INDENT}▎ `

export const commentBodyRows = ({ keyPrefix, body, width }: { readonly keyPrefix: string; readonly body: string; readonly width: number }): readonly CommentDisplayLine[] =>
	wrapCommentText(body, Math.max(1, width - COMMENT_BODY_INDENT.length)).map((line, index) => ({
		key: `${keyPrefix}:body:${index}`,
		segments: line.quote
			? [{ text: COMMENT_QUOTE_PREFIX, fg: colors.separator }, ...inlineCommentSegments(line.text, colors.muted)]
			: [{ text: COMMENT_BODY_INDENT, fg: colors.muted }, ...inlineCommentSegments(line.text)],
	}))

export const commentDisplayRows = ({
	item,
	width,
	markerLabel,
	groups,
}: {
	readonly item: CommentDisplayItem
	readonly width: number
	readonly markerLabel?: string | null | undefined
	readonly groups?: readonly (readonly CommentSegment[])[] | undefined
}): readonly CommentDisplayLine[] => [
	{ key: `${item.id}:meta`, segments: commentMetaSegments({ item, markerLabel, groups }) },
	...commentBodyRows({ keyPrefix: item.id, body: item.body, width }),
]

export const firstCommentBodyLine = (body: string) => {
	const text = body.trim().length > 0 ? body : "(empty comment)"
	const newlineIndex = text.indexOf("\n")
	return (newlineIndex >= 0 ? text.slice(0, newlineIndex) : text).trim() || "(empty comment)"
}

// `selected` lifts every segment to bold + accent fg so the row reads as the
// active focus without painting a background bar.
export const CommentSegmentsLine = ({
	segments,
	hoveredUrl,
	bg,
	selected,
}: {
	segments: readonly CommentSegment[]
	hoveredUrl?: string | null
	bg?: string
	selected?: boolean
}) => (
	<TextLine bg={bg}>
		{segments.map((segment, index) => {
			const attributes = (segment.bold || selected ? TextAttributes.BOLD : 0) | (segment.underline ? TextAttributes.UNDERLINE : 0)
			const isHovered = segment.url !== undefined && segment.url === hoveredUrl
			const fg = selected ? colors.accent : isHovered ? colors.accent : segment.fg
			return (
				<span key={index} fg={fg} {...(attributes !== 0 ? { attributes } : {})} {...(segment.url !== undefined ? { link: { url: segment.url } } : {})}>
					{segment.text}
				</span>
			)
		})}
	</TextLine>
)

export const CommentBodyLine = ({ body, width }: { body: string; width: number }) => (
	<CommentSegmentsLine
		segments={[
			{ text: COMMENT_BODY_INDENT, fg: colors.muted },
			{ text: fitCell(firstCommentBodyLine(body), Math.max(1, width - COMMENT_BODY_INDENT.length)), fg: colors.text },
		]}
	/>
)
