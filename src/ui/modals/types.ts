import { Data } from "effect"
import type { DiffCommentSide, PullRequestLabel, PullRequestMergeInfo, PullRequestMergeKind, PullRequestMergeMethod, RepositoryMergeMethods } from "../../domain.js"
import type { ThemeConfig, ThemeMode } from "../../themeConfig.js"
import type { ThemeId, ThemeTone } from "../colors.js"
import type { WorkspaceSurface } from "../../workspaceSurfaces.js"

export interface LabelModalState {
	readonly repository: string | null
	readonly target: {
		readonly kind: "pullRequest" | "issue"
		readonly repository: string
		readonly number: number
		readonly url: string
		readonly labels: readonly PullRequestLabel[]
	} | null
	readonly query: string
	readonly selectedIndex: number
	readonly availableLabels: readonly PullRequestLabel[]
	readonly loading: boolean
}

export interface MergeModalState {
	readonly repository: string | null
	readonly number: number | null
	readonly selectedIndex: number
	readonly loading: boolean
	readonly running: boolean
	readonly info: PullRequestMergeInfo | null
	readonly error: string | null
	readonly selectedMethod: PullRequestMergeMethod
	readonly allowedMethods: RepositoryMergeMethods | null
	readonly pendingConfirm: { readonly kind: PullRequestMergeKind; readonly method: PullRequestMergeMethod } | null
}

export interface CloseModalState {
	readonly kind: "pullRequest" | "issue"
	readonly repository: string | null
	readonly number: number | null
	readonly title: string
	readonly url: string | null
	readonly running: boolean
	readonly error: string | null
}

export interface PullRequestStateModalState {
	readonly repository: string | null
	readonly number: number | null
	readonly title: string
	readonly url: string | null
	readonly isDraft: boolean
	readonly selectedIsDraft: boolean
	readonly running: boolean
	readonly error: string | null
}

export interface FrozenCommentSubject {
	readonly repository: string
	readonly number: number
	readonly key: string
	readonly issueUrl: string | null
}

export type CommentModalTarget =
	| {
			readonly kind: "diff"
			readonly target?: {
				readonly repository: string
				readonly number: number
				readonly commitId: string
				readonly diffKey: string
				readonly anchor: { readonly path: string; readonly line: number; readonly side: DiffCommentSide }
				readonly range: {
					readonly start: { readonly line: number; readonly side: DiffCommentSide }
					readonly end: { readonly line: number; readonly side: DiffCommentSide }
				} | null
			}
	  }
	| { readonly kind: "issue"; readonly subject?: FrozenCommentSubject }
	| { readonly kind: "reply"; readonly subject: FrozenCommentSubject; readonly inReplyTo: string; readonly anchorLabel: string }
	| { readonly kind: "edit"; readonly subject: FrozenCommentSubject; readonly commentId: string; readonly commentTag: "comment" | "review-comment"; readonly anchorLabel: string }

export interface CommentModalState {
	readonly body: string
	readonly cursor: number
	readonly error: string | null
	readonly target: CommentModalTarget
}

export interface DeleteCommentModalState {
	readonly subject: FrozenCommentSubject | null
	readonly commentId: string
	readonly commentTag: "comment" | "review-comment"
	readonly author: string
	readonly preview: string
	readonly running: boolean
	readonly error: string | null
}

export interface CommentThreadModalState {
	readonly scrollOffset: number
}

export interface ChangedFilesModalState {
	readonly query: string
	readonly selectedIndex: number
}

export interface FilterModalState {
	readonly surface: Extract<WorkspaceSurface, "pullRequests" | "issues">
	readonly selectedIndex: number
}

export interface SubmitReviewModalState {
	readonly repository: string | null
	readonly number: number | null
	readonly focus: "action" | "body"
	readonly selectedIndex: number
	readonly body: string
	readonly cursor: number
	readonly running: boolean
	readonly error: string | null
}

export interface ThemeModalState {
	readonly query: string
	readonly filterMode: boolean
	readonly mode: ThemeMode
	readonly tone: ThemeTone
	readonly fixedTheme: ThemeId
	readonly darkTheme: ThemeId
	readonly lightTheme: ThemeId
	readonly initialThemeConfig: ThemeConfig
}

export interface CommandPaletteState {
	readonly query: string
	readonly selectedIndex: number
}

export interface OpenRepositoryModalState {
	readonly query: string
	readonly error: string | null
}

export const initialLabelModalState: LabelModalState = {
	repository: null,
	target: null,
	query: "",
	selectedIndex: 0,
	availableLabels: [],
	loading: false,
}

export const initialMergeModalState: MergeModalState = {
	repository: null,
	number: null,
	selectedIndex: 0,
	loading: false,
	running: false,
	info: null,
	error: null,
	selectedMethod: "squash",
	allowedMethods: null,
	pendingConfirm: null,
}

export const initialCloseModalState: CloseModalState = {
	kind: "pullRequest",
	repository: null,
	number: null,
	title: "",
	url: null,
	running: false,
	error: null,
}

export const initialPullRequestStateModalState: PullRequestStateModalState = {
	repository: null,
	number: null,
	title: "",
	url: null,
	isDraft: false,
	selectedIsDraft: true,
	running: false,
	error: null,
}

export const initialCommentModalState: CommentModalState = {
	body: "",
	cursor: 0,
	error: null,
	target: { kind: "diff" },
}

export const initialDeleteCommentModalState: DeleteCommentModalState = {
	subject: null,
	commentId: "",
	commentTag: "comment",
	author: "",
	preview: "",
	running: false,
	error: null,
}

export const initialCommentThreadModalState: CommentThreadModalState = {
	scrollOffset: 0,
}

export const initialChangedFilesModalState: ChangedFilesModalState = {
	query: "",
	selectedIndex: 0,
}

export const initialFilterModalState: FilterModalState = {
	surface: "pullRequests",
	selectedIndex: 0,
}

export const initialSubmitReviewModalState: SubmitReviewModalState = {
	repository: null,
	number: null,
	focus: "action",
	selectedIndex: 0,
	body: "",
	cursor: 0,
	running: false,
	error: null,
}

export const initialThemeModalState: ThemeModalState = {
	query: "",
	filterMode: false,
	mode: "fixed",
	tone: "dark",
	fixedTheme: "ghui",
	darkTheme: "ghui",
	lightTheme: "catppuccin-latte",
	initialThemeConfig: { mode: "fixed", theme: "ghui" },
}

export const initialCommandPaletteState: CommandPaletteState = {
	query: "",
	selectedIndex: 0,
}

export const initialOpenRepositoryModalState: OpenRepositoryModalState = {
	query: "",
	error: null,
}

export type Modal = Data.TaggedEnum<{
	None: {}
	Label: LabelModalState
	Close: CloseModalState
	PullRequestState: PullRequestStateModalState
	Merge: MergeModalState
	Comment: CommentModalState
	DeleteComment: DeleteCommentModalState
	CommentThread: CommentThreadModalState
	ChangedFiles: ChangedFilesModalState
	Filter: FilterModalState
	SubmitReview: SubmitReviewModalState
	Theme: ThemeModalState
	CommandPalette: CommandPaletteState
	OpenRepository: OpenRepositoryModalState
}>

export const Modal = Data.taggedEnum<Modal>()
export const initialModal: Modal = Modal.None()

export type ModalTag = Modal["_tag"]
export type ModalState<Tag extends Exclude<ModalTag, "None">> = Omit<Extract<Modal, { _tag: Tag }>, "_tag">

export const modalInitialStates = {
	Label: initialLabelModalState,
	Close: initialCloseModalState,
	PullRequestState: initialPullRequestStateModalState,
	Merge: initialMergeModalState,
	Comment: initialCommentModalState,
	DeleteComment: initialDeleteCommentModalState,
	CommentThread: initialCommentThreadModalState,
	ChangedFiles: initialChangedFilesModalState,
	Filter: initialFilterModalState,
	SubmitReview: initialSubmitReviewModalState,
	Theme: initialThemeModalState,
	CommandPalette: initialCommandPaletteState,
	OpenRepository: initialOpenRepositoryModalState,
} as const satisfies { [Tag in Exclude<ModalTag, "None">]: ModalState<Tag> }
