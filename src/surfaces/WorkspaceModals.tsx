import type { AppCommand } from "../commands.js"
import type { PullRequestLabel, PullRequestReviewComment } from "../domain.js"
import { CommandPalette } from "../ui/CommandPalette.js"
import {
	ChangedFilesModal,
	type ChangedFileSearchResult,
	CloseModal,
	CommentModal,
	CommentThreadModal,
	DeleteCommentModal,
	FilterModal,
	LabelModal,
	MergeModal,
	OpenRepositoryModal,
	PullRequestStateModal,
	SubmitReviewModal,
	ThemeModal,
} from "../ui/modals.js"
import { Modal, type ModalTag } from "../ui/modals/types.js"

export interface ModalLayout {
	readonly width: number
	readonly height: number
	readonly left: number
	readonly top: number
}

// Tag-keyed layout map. WorkspaceModals only renders the active modal, but App
// computes layouts up-front so they stay stable across renders.
export type ModalLayouts = { readonly [Tag in Exclude<ModalTag, "None">]: ModalLayout }

export interface WorkspaceModalsProps {
	readonly activeModal: Modal
	readonly layouts: ModalLayouts
	readonly loadingIndicator: string
	readonly selectedItemLabels: readonly PullRequestLabel[]
	readonly commentAnchorLabel: string
	readonly selectedDiffCommentThread: readonly PullRequestReviewComment[]
	readonly changedFileResults: readonly ChangedFileSearchResult[]
	readonly readyDiffFileCount: number
	readonly commandPaletteCommands: readonly AppCommand[]
	readonly selectedCommandIndex: number
	readonly onSelectCommandIndex: (index: number) => void
	readonly onRunCommand: (command: AppCommand) => void
	readonly onCommentChange: (body: string, cursor: number) => void
	readonly onCommentSubmit: () => void
	// When the docked diff-file panel is rendering the picker inline, the
	// modal must stand down so both presentations don't fight for the screen.
	readonly suppressChangedFilesModal: boolean
}

const layoutToProps = (layout: ModalLayout) => ({
	modalWidth: layout.width,
	modalHeight: layout.height,
	offsetLeft: layout.left,
	offsetTop: layout.top,
})

export const WorkspaceModals = (props: WorkspaceModalsProps) =>
	Modal.$match(props.activeModal, {
		None: () => null,
		Label: (state) => <LabelModal state={state} currentLabels={props.selectedItemLabels} loadingIndicator={props.loadingIndicator} {...layoutToProps(props.layouts.Label)} />,
		Close: (state) => <CloseModal state={state} loadingIndicator={props.loadingIndicator} {...layoutToProps(props.layouts.Close)} />,
		PullRequestState: (state) => <PullRequestStateModal state={state} loadingIndicator={props.loadingIndicator} {...layoutToProps(props.layouts.PullRequestState)} />,
		Merge: (state) => <MergeModal state={state} loadingIndicator={props.loadingIndicator} {...layoutToProps(props.layouts.Merge)} />,
		Comment: (state) => (
			<CommentModal
				state={state}
				anchorLabel={props.commentAnchorLabel}
				onChange={props.onCommentChange}
				onSubmit={props.onCommentSubmit}
				{...layoutToProps(props.layouts.Comment)}
			/>
		),
		DeleteComment: (state) => <DeleteCommentModal state={state} loadingIndicator={props.loadingIndicator} {...layoutToProps(props.layouts.DeleteComment)} />,
		CommentThread: (state) => (
			<CommentThreadModal state={state} anchorLabel={props.commentAnchorLabel} comments={props.selectedDiffCommentThread} {...layoutToProps(props.layouts.CommentThread)} />
		),
		ChangedFiles: (state) =>
			props.suppressChangedFilesModal ? null : (
				<ChangedFilesModal state={state} results={props.changedFileResults} totalCount={props.readyDiffFileCount} {...layoutToProps(props.layouts.ChangedFiles)} />
			),
		Filter: (state) => <FilterModal state={state} {...layoutToProps(props.layouts.Filter)} />,
		SubmitReview: (state) => <SubmitReviewModal state={state} {...layoutToProps(props.layouts.SubmitReview)} />,
		Theme: (state) => <ThemeModal state={state} {...layoutToProps(props.layouts.Theme)} />,
		OpenRepository: (state) => <OpenRepositoryModal state={state} {...layoutToProps(props.layouts.OpenRepository)} />,
		CommandPalette: (state) => (
			<CommandPalette
				commands={props.commandPaletteCommands}
				query={state.query}
				selectedIndex={props.selectedCommandIndex}
				onSelectCommandIndex={props.onSelectCommandIndex}
				onRunCommand={props.onRunCommand}
				{...layoutToProps(props.layouts.CommandPalette)}
			/>
		),
	})
