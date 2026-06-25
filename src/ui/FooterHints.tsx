import { Data } from "effect"
import { colors } from "./colors.js"
import { HintRow, TextLine, type HintItem } from "./primitives.js"

export type RetryProgress = Data.TaggedEnum<{
	Idle: {}
	Retrying: { readonly attempt: number; readonly max: number }
}>

export const RetryProgress = Data.taggedEnum<RetryProgress>()
export const initialRetryProgress: RetryProgress = RetryProgress.Idle()

interface HintsContext {
	readonly filterEditing: boolean
	readonly filterText: string
	readonly filterPlaceholder: string
	readonly showFilterClear: boolean
	readonly detailFullView: boolean
	readonly diffFullView: boolean
	readonly diffRangeActive: boolean
	readonly commentsViewActive: boolean
	readonly commentsViewOnRealComment: boolean
	readonly commentsViewCanEditSelected: boolean
	readonly commentsViewCount: number
	readonly hasSelection: boolean
	readonly canOpenDetails: boolean
	readonly canOpenRepository: boolean
	readonly canAddRepository: boolean
	readonly canRemoveRepository: boolean
	readonly canCycleScopeFilter: boolean
	readonly canOpenDiff: boolean
	readonly canOpenComments: boolean
	readonly hasError: boolean
	readonly isLoading: boolean
	readonly loadingIndicator: string
	readonly retryProgress: RetryProgress
}

const FILTER_CURSOR = "█"

const filterPlaceholder = (ctx: HintsContext) => `${ctx.filterPlaceholder.charAt(0).toUpperCase()}${ctx.filterPlaceholder.slice(1)}`
const activeFilterLabel = (ctx: HintsContext) => (ctx.filterText.length > 0 ? ctx.filterText : filterPlaceholder(ctx))

const FilterEditingPrompt = (ctx: HintsContext) => {
	const placeholder = filterPlaceholder(ctx)
	const placeholderCursor = placeholder.charAt(0)
	const placeholderRest = placeholder.slice(1)
	return (
		<TextLine>
			<span fg={colors.count}>/</span>
			<span fg={colors.muted}> </span>
			{ctx.filterText.length > 0 ? (
				<>
					<span fg={colors.text}>{ctx.filterText}</span>
					<span fg={colors.muted}>{FILTER_CURSOR}</span>
				</>
			) : (
				<>
					<span fg={colors.background} bg={colors.muted}>
						{placeholderCursor}
					</span>
					<span fg={colors.muted}>{placeholderRest}</span>
				</>
			)}
		</TextLine>
	)
}

const diffViewHints = (ctx: HintsContext): readonly HintItem[] => [
	{ key: "esc", label: "back" },
	{ key: "↑↓", label: ctx.diffRangeActive ? "range" : "line" },
	{ key: "enter", label: ctx.diffRangeActive ? "comment" : "open" },
	{ key: "v", label: ctx.diffRangeActive ? "clear" : "range" },
	{ key: "w", label: "wrap" },
	{ key: "[]", label: "files" },
	{ key: "r", label: "reload" },
]

const detailFullViewHints = (ctx: HintsContext): readonly HintItem[] => [
	{ key: "esc", label: "back" },
	{ key: "↑↓", label: "scroll" },
	{ key: "r", label: ctx.hasError ? "retry" : "refresh" },
	{ key: "d", label: "diff", when: ctx.canOpenDiff },
]

const commentsViewHints = (ctx: HintsContext): readonly HintItem[] => [
	{ key: "↑↓", label: "move", disabled: ctx.commentsViewCount <= 1 },
	{ key: "enter", label: ctx.commentsViewOnRealComment ? "reply" : "new" },
	{ key: "a", label: "new" },
	{ key: "e", label: "edit", disabled: !ctx.commentsViewCanEditSelected },
	{ key: "x", label: "delete", disabled: !ctx.commentsViewCanEditSelected },
	{ key: "o", label: "open", disabled: !ctx.commentsViewOnRealComment },
	{ key: "r", label: "refresh" },
	{ key: "esc", label: "close" },
]

const defaultHints = (ctx: HintsContext): readonly HintItem[] => {
	const retrying = ctx.retryProgress._tag === "Retrying"
	return [
		{ key: "/", label: ctx.showFilterClear ? activeFilterLabel(ctx) : "filter" },
		{ key: "esc", label: "clear", when: ctx.showFilterClear },
		{
			key: "retry",
			label: retrying ? `${(ctx.retryProgress as { attempt: number; max: number }).attempt}/${(ctx.retryProgress as { attempt: number; max: number }).max}` : "",
			when: retrying,
			keyFg: colors.status.pending,
		},
		{ key: ctx.loadingIndicator, label: "loading", when: !retrying && ctx.isLoading, keyFg: colors.status.pending },
		{ key: "r", label: "retry", when: ctx.hasError },
		{ key: "a", label: "add repo", when: ctx.canAddRepository },
		{ key: "enter", label: "open repo", when: ctx.canOpenRepository },
		{ key: "x", label: "remove", when: ctx.canRemoveRepository },
		{ key: "f", label: "filter", when: ctx.canCycleScopeFilter },
		{ key: "enter", label: "details", when: ctx.canOpenDetails },
		{ key: "c", label: "comments", when: ctx.canOpenComments },
		{ key: "d", label: "diff", when: ctx.canOpenDiff },
		{ key: "ctrl-p", label: "commands" },
	]
}

const footerHints = (ctx: HintsContext): readonly HintItem[] => {
	if (ctx.commentsViewActive) return commentsViewHints(ctx)
	if (ctx.diffFullView) return diffViewHints(ctx)
	if (ctx.detailFullView) return detailFullViewHints(ctx)
	return defaultHints(ctx)
}

export const FooterHints = (props: HintsContext) => (props.filterEditing ? <FilterEditingPrompt {...props} /> : <HintRow items={footerHints(props)} />)
