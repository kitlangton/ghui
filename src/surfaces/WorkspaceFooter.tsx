import { colors } from "../ui/colors.js"
import { FooterHints, type RetryProgress } from "../ui/FooterHints.js"
import { PlainLine } from "../ui/primitives.js"

export interface WorkspaceFooterProps {
	readonly footerNotice: string | null
	readonly filterMode: boolean
	readonly visibleFilterText: string
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

export const WorkspaceFooter = ({ footerNotice, ...hints }: WorkspaceFooterProps) => (
	<box paddingLeft={1} paddingRight={1} backgroundColor={colors.background}>
		{footerNotice ? (
			<PlainLine text={footerNotice} fg={colors.count} />
		) : (
			<FooterHints
				filterEditing={hints.filterMode}
				filterText={hints.visibleFilterText}
				filterPlaceholder={hints.filterPlaceholder}
				showFilterClear={hints.showFilterClear}
				detailFullView={hints.detailFullView}
				diffFullView={hints.diffFullView}
				diffRangeActive={hints.diffRangeActive}
				commentsViewActive={hints.commentsViewActive}
				commentsViewOnRealComment={hints.commentsViewOnRealComment}
				commentsViewCanEditSelected={hints.commentsViewCanEditSelected}
				commentsViewCount={hints.commentsViewCount}
				hasSelection={hints.hasSelection}
				canOpenDetails={hints.canOpenDetails}
				canOpenRepository={hints.canOpenRepository}
				canAddRepository={hints.canAddRepository}
				canRemoveRepository={hints.canRemoveRepository}
				canCycleScopeFilter={hints.canCycleScopeFilter}
				canOpenDiff={hints.canOpenDiff}
				canOpenComments={hints.canOpenComments}
				hasError={hints.hasError}
				isLoading={hints.isLoading}
				loadingIndicator={hints.loadingIndicator}
				retryProgress={hints.retryProgress}
			/>
		)}
	</box>
)
