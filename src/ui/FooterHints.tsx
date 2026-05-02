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
	readonly hasSelection: boolean
	readonly canCloseSelection: boolean
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
	{ key: "n/p", label: "threads" },
	{ key: "[]", label: "files" },
	{ key: "V", label: "view" },
	{ key: "w", label: "wrap" },
	{ key: "r", label: "reload" },
	{ key: "o", label: "open" },
]

const detailFullViewHints = (ctx: HintsContext): readonly HintItem[] => [
	{ key: "esc", label: "back" },
	{ key: "↑↓", label: "scroll" },
	{ key: "r", label: ctx.hasError ? "retry" : "refresh" },
	{ key: "t", label: "theme" },
	{ key: "s", label: "state", when: ctx.hasSelection },
	{ key: "d", label: "diff", when: ctx.hasSelection },
	{ key: "l", label: "labels", when: ctx.hasSelection },
	{ key: "m", label: "merge", when: ctx.hasSelection },
	{ key: "x", label: "close", when: ctx.hasSelection && ctx.canCloseSelection },
	{ key: "o", label: "open" },
	{ key: "y", label: "copy" },
	{ key: "q", label: "quit" },
]

const defaultHints = (ctx: HintsContext): readonly HintItem[] => {
	const retrying = ctx.retryProgress._tag === "Retrying"
	return [
		{ key: "/", label: "filter" },
		{ key: "t", label: "theme" },
		{ key: "esc", label: "clear", when: ctx.showFilterClear },
		{ key: "retry", label: retrying ? `${(ctx.retryProgress as { attempt: number; max: number }).attempt}/${(ctx.retryProgress as { attempt: number; max: number }).max}` : "", when: retrying, keyFg: colors.status.pending },
		{ key: ctx.loadingIndicator, label: "loading", when: !retrying && ctx.isLoading, keyFg: colors.status.pending },
		{ key: "r", label: "retry", when: ctx.hasError },
		{ key: "d", label: "diff", when: ctx.hasSelection },
		{ key: "l", label: "labels", when: ctx.hasSelection },
		{ key: "m", label: "merge", when: ctx.hasSelection },
		{ key: "x", label: "close", when: ctx.hasSelection && ctx.canCloseSelection },
		{ key: "o", label: "open", when: ctx.hasSelection },
		{ key: "y", label: "copy", when: ctx.hasSelection },
		{ key: "ctrl-p", label: "commands" },
	]
}

const footerHints = (ctx: HintsContext): readonly HintItem[] => {
	if (ctx.filterEditing) return filterEditingHints
	if (ctx.diffFullView) return diffViewHints(ctx)
	if (ctx.detailFullView) return detailFullViewHints(ctx)
	return defaultHints(ctx)
}

export const FooterHints = (props: HintsContext) => <HintRow items={footerHints(props)} />
