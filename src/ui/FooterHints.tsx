import { colors } from "./colors.js"
import { TextLine } from "./primitives.js"

export interface RetryProgress {
	readonly attempt: number
	readonly max: number
}

export const FooterHints = ({
	filterEditing,
	showFilterClear,
	detailFullView,
	diffFullView,
	hasSelection,
	hasError,
	isLoading,
	loadingIndicator,
	retryProgress,
}: {
	filterEditing: boolean
	showFilterClear: boolean
	detailFullView: boolean
	diffFullView: boolean
	hasSelection: boolean
	hasError: boolean
	isLoading: boolean
	loadingIndicator: string
	retryProgress: RetryProgress | null
}) => {
	if (filterEditing) {
		return (
			<TextLine>
				<span fg={colors.count}>search</span>
				<span fg={colors.muted}> typing  </span>
				<span fg={colors.count}>↑↓</span>
				<span fg={colors.muted}> move  </span>
				<span fg={colors.count}>enter</span>
				<span fg={colors.muted}> apply  </span>
				<span fg={colors.count}>esc</span>
				<span fg={colors.muted}> cancel  </span>
				<span fg={colors.count}>ctrl-u</span>
				<span fg={colors.muted}> clear  </span>
				<span fg={colors.count}>ctrl-w</span>
				<span fg={colors.muted}> word</span>
			</TextLine>
		)
	}

	if (diffFullView) {
		return (
			<TextLine>
				<span fg={colors.count}>esc</span>
				<span fg={colors.muted}> back  </span>
				<span fg={colors.count}>v</span>
				<span fg={colors.muted}> view  </span>
				<span fg={colors.count}>w</span>
				<span fg={colors.muted}> wrap  </span>
				<span fg={colors.count}>[]</span>
				<span fg={colors.muted}> files  </span>
				<span fg={colors.count}>r</span>
				<span fg={colors.muted}> reload  </span>
				<span fg={colors.count}>o</span>
				<span fg={colors.muted}> open  </span>
				<span fg={colors.count}>q</span>
				<span fg={colors.muted}> quit</span>
			</TextLine>
		)
	}

	if (detailFullView) {
		return (
			<TextLine>
				<span fg={colors.count}>esc</span>
				<span fg={colors.muted}> back  </span>
				<span fg={colors.count}>o</span>
				<span fg={colors.muted}> open  </span>
				<span fg={colors.count}>y</span>
				<span fg={colors.muted}> copy  </span>
				<span fg={colors.count}>q</span>
				<span fg={colors.muted}> quit</span>
			</TextLine>
		)
	}

	return (
		<TextLine>
			<span fg={colors.count}>/</span>
			<span fg={colors.muted}> filter  </span>
			{showFilterClear ? (
				<>
					<span fg={colors.count}>esc</span>
					<span fg={colors.muted}> clear  </span>
				</>
			) : null}
			{retryProgress ? (
				<>
					<span fg={colors.status.pending}>retry</span>
					<span fg={colors.muted}> {retryProgress.attempt}/{retryProgress.max}  </span>
				</>
			) : isLoading ? (
				<>
					<span fg={colors.status.pending}>{loadingIndicator}</span>
					<span fg={colors.muted}> loading  </span>
				</>
			) : null}
			<span fg={colors.count}>r</span>
			<span fg={colors.muted}>{hasError ? " retry  " : " ref  "}</span>
			{hasSelection ? (
				<>
					<span fg={colors.count}>↑↓</span>
					<span fg={colors.muted}> move  </span>
				</>
			) : null}
			{hasSelection && detailFullView ? (
				<>
					<span fg={colors.count}>esc</span>
					<span fg={colors.muted}> back  </span>
				</>
			) : hasSelection ? (
				<>
					<span fg={colors.count}>enter</span>
					<span fg={colors.muted}> expand  </span>
				</>
			) : null}
			{hasSelection ? (
				<>
					<span fg={colors.count}>d</span>
					<span fg={colors.muted}> draft  </span>
					<span fg={colors.count}>p</span>
					<span fg={colors.muted}> diff  </span>
					<span fg={colors.count}>l</span>
					<span fg={colors.muted}> labels  </span>
					<span fg={colors.count}>M</span>
					<span fg={colors.muted}> merge  </span>
					<span fg={colors.count}>o</span>
					<span fg={colors.muted}> open  </span>
					<span fg={colors.count}>y</span>
					<span fg={colors.muted}> copy  </span>
				</>
			) : null}
			<span fg={colors.count}>q</span>
			<span fg={colors.muted}> quit</span>
		</TextLine>
	)
}
