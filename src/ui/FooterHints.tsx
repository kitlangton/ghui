import { Data } from "effect"
import { colors } from "./colors.js"
import { HintRow, type HintItem } from "./primitives.js"

export type RetryProgress = Data.TaggedEnum<{
	Idle: {}
	Retrying: { readonly attempt: number; readonly max: number }
}>

export const RetryProgress = Data.taggedEnum<RetryProgress>()
export const initialRetryProgress: RetryProgress = RetryProgress.Idle()

interface HintsContext {
	readonly filterEditing: boolean
	readonly showFilterClear: boolean
	readonly detailFullView: boolean
	readonly diffFullView: boolean
	readonly diffRangeActive: boolean
	readonly commentsViewActive: boolean
	readonly actionsViewActive: boolean
	readonly actionsLevel: "runs" | "jobs" | "logs"
	readonly actionsLogFilterActive: boolean
	readonly actionsLogHasQuery: boolean
	readonly commentsViewOnRealComment: boolean
	readonly commentsViewCanEditSelected: boolean
	readonly commentsViewCount: number
	readonly hasSelection: boolean
	readonly hasError: boolean
	readonly isLoading: boolean
	readonly loadingIndicator: string
	readonly retryProgress: RetryProgress
}

const filterEditingHints: readonly HintItem[] = [
	{ key: "search", label: "typing" },
	{ key: "↑↓", label: "move" },
	{ key: "enter", label: "apply" },
	{ key: "esc", label: "cancel" },
	{ key: "ctrl-u", label: "clear" },
	{ key: "ctrl-w", label: "word" },
]

const diffViewHints = (ctx: HintsContext): readonly HintItem[] => [
	{ key: "esc", label: "back" },
	{ key: "↑↓", label: ctx.diffRangeActive ? "range" : "line" },
	{ key: "enter", label: ctx.diffRangeActive ? "comment" : "open" },
	{ key: "v", label: ctx.diffRangeActive ? "clear" : "range" },
	{ key: "[]", label: "files" },
	{ key: "r", label: "reload" },
]

const detailFullViewHints = (ctx: HintsContext): readonly HintItem[] => [
	{ key: "esc", label: "back" },
	{ key: "↑↓", label: "scroll" },
	{ key: "r", label: ctx.hasError ? "retry" : "refresh" },
	{ key: "d", label: "diff", when: ctx.hasSelection },
	{ key: "a", label: "actions", when: ctx.hasSelection },
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

const actionsViewHints = (ctx: HintsContext): readonly HintItem[] => [
	{ key: "↑↓", label: "move" },
	{ key: "←→", label: "graph", when: ctx.actionsLevel === "jobs" },
	{ key: "←→", label: "collapse/expand", when: ctx.actionsLevel === "logs" },
	{ key: "w", label: "wrap", when: ctx.actionsLevel === "logs" },
	{ key: "zh/zl", label: "h-scroll", when: ctx.actionsLevel === "logs" },
	{ key: "/", label: "filter", when: ctx.actionsLevel === "logs" && !ctx.actionsLogFilterActive },
	{ key: "esc", label: "clear", when: ctx.actionsLevel === "logs" && ctx.actionsLogFilterActive },
	{ key: "n/N", label: "match", when: ctx.actionsLevel === "logs" && ctx.actionsLogHasQuery && !ctx.actionsLogFilterActive },
	{ key: "s", label: "graph", when: ctx.actionsLevel === "jobs" },
	{ key: "enter", label: "open", when: ctx.actionsLevel !== "logs" },
	{ key: "o", label: "browser" },
	{ key: "r", label: "refresh" },
	{ key: "esc", label: "back" },
]

const defaultHints = (ctx: HintsContext): readonly HintItem[] => {
	const retrying = ctx.retryProgress._tag === "Retrying"
	return [
		{ key: "/", label: "filter" },
		{ key: "esc", label: "clear", when: ctx.showFilterClear },
		{
			key: "retry",
			label: retrying ? `${(ctx.retryProgress as { attempt: number; max: number }).attempt}/${(ctx.retryProgress as { attempt: number; max: number }).max}` : "",
			when: retrying,
			keyFg: colors.status.pending,
		},
		{ key: ctx.loadingIndicator, label: "loading", when: !retrying && ctx.isLoading, keyFg: colors.status.pending },
		{ key: "r", label: "retry", when: ctx.hasError },
		{ key: "enter", label: "details", when: ctx.hasSelection },
		{ key: "d", label: "diff", when: ctx.hasSelection },
		{ key: "ctrl-p", label: "commands" },
	]
}

const footerHints = (ctx: HintsContext): readonly HintItem[] => {
	if (ctx.filterEditing) return filterEditingHints
	if (ctx.commentsViewActive) return commentsViewHints(ctx)
	if (ctx.actionsViewActive) return actionsViewHints(ctx)
	if (ctx.diffFullView) return diffViewHints(ctx)
	if (ctx.detailFullView) return detailFullViewHints(ctx)
	return defaultHints(ctx)
}

export const FooterHints = (props: HintsContext) => <HintRow items={footerHints(props)} />
