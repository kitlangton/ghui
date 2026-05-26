// Barrel re-export for modal components, types, initial states, and shared
// helpers. Per-modal files live under ./modals/. Existing consumers import
// from "./modals" — this barrel preserves that surface.

export { ChangedFilesModal } from "./modals/ChangedFilesModal.js"
export { CloseModal } from "./modals/CloseModal.js"
export { CommentModal } from "./modals/CommentModal.js"
export { CommentThreadModal } from "./modals/CommentThreadModal.js"
export { DeleteCommentModal } from "./modals/DeleteCommentModal.js"
export { FilterModal, filterOptions } from "./modals/FilterModal.js"
export { LabelModal } from "./modals/LabelModal.js"
export { MergeModal } from "./modals/MergeModal.js"
export { OpenRepositoryModal } from "./modals/OpenRepositoryModal.js"
export { PullRequestStateModal } from "./modals/PullRequestStateModal.js"
export { SubmitReviewModal } from "./modals/SubmitReviewModal.js"
export { ThemeModal } from "./modals/ThemeModal.js"

export type { ChangedFileSearchResult, SubmitReviewOption } from "./modals/shared.js"
export { filterChangedFiles, filterLabels, submitReviewOptions } from "./modals/shared.js"

export type {
	ChangedFilesModalState,
	CloseModalState,
	CommandPaletteState,
	CommentModalState,
	CommentModalTarget,
	CommentThreadModalState,
	DeleteCommentModalState,
	FilterModalState,
	FrozenCommentSubject,
	LabelModalState,
	MergeModalState,
	ModalState,
	ModalTag,
	OpenRepositoryModalState,
	PullRequestStateModalState,
	SubmitReviewModalState,
	ThemeModalState,
} from "./modals/types.js"
export {
	initialChangedFilesModalState,
	initialCloseModalState,
	initialCommandPaletteState,
	initialCommentModalState,
	initialCommentThreadModalState,
	initialDeleteCommentModalState,
	initialFilterModalState,
	initialLabelModalState,
	initialMergeModalState,
	initialModal,
	initialOpenRepositoryModalState,
	initialPullRequestStateModalState,
	initialSubmitReviewModalState,
	initialThemeModalState,
	Modal,
	modalInitialStates,
} from "./modals/types.js"
