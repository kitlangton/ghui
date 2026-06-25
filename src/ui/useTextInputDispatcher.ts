import { useKeyboard } from "@opentui/react"
import type { WorkspaceSurface } from "../workspaceSurfaces.js"
import { type CommentEditorValue, insertText } from "./commentEditor.js"
import type { ChangedFilesModalState, CommandPaletteState, LabelModalState, OpenRepositoryModalState, SubmitReviewModalState, ThemeModalState } from "./modals.js"
import { editSingleLineInput, isSingleLineInputKey, printableKeyText } from "./singleLineInput.js"

export interface UseTextInputDispatcherInput {
	readonly disabled: boolean

	// Modal active flags
	readonly commandPaletteActive: boolean
	readonly openRepositoryModalActive: boolean
	readonly themeModalActive: boolean
	readonly commentModalActive: boolean
	readonly submitReviewModalActive: boolean
	readonly changedFilesModalActive: boolean
	readonly labelModalActive: boolean
	readonly filterMode: boolean
	readonly detailFullView: boolean
	readonly diffFullView: boolean
	readonly commentsViewActive: boolean

	// Modal sub-state needed for routing
	readonly themeModal: ThemeModalState
	readonly submitReviewModal: SubmitReviewModalState

	// Workspace surface tabs (for 1/2/3 numeric shortcuts)
	readonly workspaceTabSurfaces: readonly WorkspaceSurface[]
	readonly activeWorkspaceSurface: WorkspaceSurface
	readonly switchWorkspaceSurface: (surface: WorkspaceSurface) => void

	// Per-modal text-input setters
	readonly setCommandPalette: (next: CommandPaletteState | ((prev: CommandPaletteState) => CommandPaletteState)) => void
	readonly setOpenRepositoryModal: (next: OpenRepositoryModalState | ((prev: OpenRepositoryModalState) => OpenRepositoryModalState)) => void
	readonly setChangedFilesModal: (next: ChangedFilesModalState | ((prev: ChangedFilesModalState) => ChangedFilesModalState)) => void
	readonly setLabelModal: (next: LabelModalState | ((prev: LabelModalState) => LabelModalState)) => void
	readonly setFilterDraft: (next: string | ((prev: string) => string)) => void
	readonly editThemeQuery: (transform: (query: string) => string) => void
	readonly editSubmitReview: (transform: (state: CommentEditorValue) => CommentEditorValue) => void
}

/**
 * Routes raw text keystrokes to whichever modal owns input right now.
 * The precedence order encodes the modal stack:
 *
 *   command palette > open-repo > numeric tabs (when in list mode) >
 *   theme > comment > submit-review > changed-files > label > filter
 *
 * This is the load-bearing invariant — any module that wants to claim
 * raw keyboard input registers via this dispatcher rather than a
 * separate useKeyboard call so the precedence stays linearizable.
 *
 * Modal-action keys (q/ctrl+c/escape/return/etc.) live in the keymap
 * layer; this hook only handles characters that need byte-by-byte
 * accumulation into a query/body string.
 */
export const useTextInputDispatcher = (input: UseTextInputDispatcherInput): void => {
	useKeyboard((key) => {
		if (input.disabled) return

		if (input.commandPaletteActive) {
			if (isSingleLineInputKey(key)) {
				input.setCommandPalette((current) => {
					const query = editSingleLineInput(current.query, key) ?? current.query
					return current.query === query && current.selectedIndex === 0 ? current : { ...current, query, selectedIndex: 0 }
				})
			}
			return
		}

		if (input.openRepositoryModalActive) {
			if (isSingleLineInputKey(key)) {
				input.setOpenRepositoryModal((current) => ({
					...current,
					query: editSingleLineInput(current.query, key) ?? current.query,
					error: null,
				}))
			}
			return
		}

		// Numeric tab shortcuts (1/2/3) — only active in list mode (no modal,
		// no full-view, no filter editing).
		if (!input.filterMode && !input.detailFullView && !input.diffFullView && !input.commentsViewActive) {
			const text = printableKeyText(key)
			if (text === "1") {
				input.switchWorkspaceSurface(input.workspaceTabSurfaces[0] ?? input.activeWorkspaceSurface)
				return
			}
			if (text === "2") {
				input.switchWorkspaceSurface(input.workspaceTabSurfaces[1] ?? input.activeWorkspaceSurface)
				return
			}
			if (text === "3") {
				input.switchWorkspaceSurface(input.workspaceTabSurfaces[2] ?? input.activeWorkspaceSurface)
				return
			}
		}

		if (input.themeModalActive) {
			if (input.themeModal.filterMode && isSingleLineInputKey(key)) {
				input.editThemeQuery((query) => editSingleLineInput(query, key) ?? query)
			}
			return
		}

		if (input.commentModalActive) return

		if (input.submitReviewModalActive) {
			if (input.submitReviewModal.focus !== "body") return
			const text = printableKeyText(key)
			if (text) input.editSubmitReview((state) => insertText(state, text))
			return
		}

		if (input.changedFilesModalActive) {
			if (isSingleLineInputKey(key)) {
				input.setChangedFilesModal((current) => {
					const query = editSingleLineInput(current.query, key) ?? current.query
					return query === current.query ? current : { ...current, query, selectedIndex: 0 }
				})
			}
			return
		}

		if (input.labelModalActive) {
			if (isSingleLineInputKey(key)) {
				input.setLabelModal((current) => ({
					...current,
					query: editSingleLineInput(current.query, key) ?? current.query,
					selectedIndex: 0,
				}))
			}
			return
		}

		if (input.filterMode) {
			if (isSingleLineInputKey(key)) {
				input.setFilterDraft((current) => editSingleLineInput(current, key) ?? current)
			}
		}
	})
}
