import { context } from "@ghui/keymap"

export interface ReleaseFormCtx {
	readonly bodyFocused: boolean
	readonly toggleFocused: boolean
	readonly canSubmit: boolean
	readonly canGenerate: boolean
	readonly nextFocus: () => void
	readonly previousFocus: () => void
	readonly cancel: () => void
	readonly publish: () => void
	readonly saveDraft: () => void
	readonly generateNotes: () => void
	readonly toggleField: () => void
	readonly insertNewline: () => void
	readonly moveLeft: () => void
	readonly moveRight: () => void
	readonly moveUp: () => void
	readonly moveDown: () => void
	readonly moveLineStart: () => void
	readonly moveLineEnd: () => void
	readonly moveWordBackward: () => void
	readonly moveWordForward: () => void
	readonly backspace: () => void
	readonly deleteForward: () => void
	readonly deleteWordBackward: () => void
	readonly deleteWordForward: () => void
	readonly deleteToLineStart: () => void
	readonly deleteToLineEnd: () => void
}

const ReleaseForm = context<ReleaseFormCtx>()

export const releaseFormKeymap = ReleaseForm(
	{ id: "release-form.cancel", title: "Cancel", keys: ["escape"], run: (s) => s.cancel() },

	// Field navigation (always available — works on every focus state).
	{ id: "release-form.next", title: "Next field", keys: ["tab"], run: (s) => s.nextFocus() },
	{ id: "release-form.previous", title: "Previous field", keys: ["shift+tab"], run: (s) => s.previousFocus() },

	// Submit shortcuts (work everywhere).
	{
		id: "release-form.publish",
		title: "Publish",
		keys: ["ctrl+return", "shift+return"],
		when: (s) => !s.bodyFocused,
		enabled: (s) => (s.canSubmit ? true : "Enter a tag first."),
		run: (s) => s.publish(),
	},
	{
		id: "release-form.publish-from-body",
		title: "Publish",
		keys: ["ctrl+return"],
		when: (s) => s.bodyFocused,
		enabled: (s) => (s.canSubmit ? true : "Enter a tag first."),
		run: (s) => s.publish(),
	},
	{
		id: "release-form.save-draft",
		title: "Save draft",
		keys: ["ctrl+s"],
		enabled: (s) => (s.canSubmit ? true : "Enter a tag first."),
		run: (s) => s.saveDraft(),
	},
	{
		id: "release-form.generate-notes",
		title: "Generate notes",
		keys: ["ctrl+g"],
		enabled: (s) => (s.canGenerate ? true : "Enter a tag first."),
		run: (s) => s.generateNotes(),
	},

	// Toggle space when focused on prerelease/makeLatest.
	{
		id: "release-form.toggle",
		title: "Toggle",
		keys: ["space"],
		when: (s) => s.toggleFocused,
		run: (s) => s.toggleField(),
	},
	// Enter on toggle row also advances the value.
	{
		id: "release-form.toggle-enter",
		title: "Toggle",
		keys: ["return"],
		when: (s) => s.toggleFocused,
		run: (s) => s.toggleField(),
	},

	// Body editing (only active when focus === "body").
	{ id: "release-form.body-newline", title: "Newline", keys: ["return"], when: (s) => s.bodyFocused, run: (s) => s.insertNewline() },
	{ id: "release-form.body-left", title: "Cursor left", keys: ["left", "ctrl+b"], when: (s) => s.bodyFocused, run: (s) => s.moveLeft() },
	{ id: "release-form.body-right", title: "Cursor right", keys: ["right", "ctrl+f"], when: (s) => s.bodyFocused, run: (s) => s.moveRight() },
	{ id: "release-form.body-up", title: "Cursor up", keys: ["up"], when: (s) => s.bodyFocused, run: (s) => s.moveUp() },
	{ id: "release-form.body-down", title: "Cursor down", keys: ["down"], when: (s) => s.bodyFocused, run: (s) => s.moveDown() },
	{ id: "release-form.body-line-start", title: "Line start", keys: ["home", "ctrl+a"], when: (s) => s.bodyFocused, run: (s) => s.moveLineStart() },
	{ id: "release-form.body-line-end", title: "Line end", keys: ["end", "ctrl+e"], when: (s) => s.bodyFocused, run: (s) => s.moveLineEnd() },
	{ id: "release-form.body-word-back", title: "Word backward", keys: ["meta+b", "meta+left"], when: (s) => s.bodyFocused, run: (s) => s.moveWordBackward() },
	{ id: "release-form.body-word-fwd", title: "Word forward", keys: ["meta+f", "meta+right"], when: (s) => s.bodyFocused, run: (s) => s.moveWordForward() },
	{ id: "release-form.body-backspace", title: "Backspace", keys: ["backspace"], when: (s) => s.bodyFocused, run: (s) => s.backspace() },
	{ id: "release-form.body-delete", title: "Delete", keys: ["delete", "ctrl+d"], when: (s) => s.bodyFocused, run: (s) => s.deleteForward() },
	{ id: "release-form.body-del-word-back", title: "Delete word back", keys: ["ctrl+w", "meta+backspace"], when: (s) => s.bodyFocused, run: (s) => s.deleteWordBackward() },
	{ id: "release-form.body-del-word-fwd", title: "Delete word forward", keys: ["meta+delete"], when: (s) => s.bodyFocused, run: (s) => s.deleteWordForward() },
	{ id: "release-form.body-del-to-start", title: "Delete to line start", keys: ["ctrl+u"], when: (s) => s.bodyFocused, run: (s) => s.deleteToLineStart() },
	{ id: "release-form.body-del-to-end", title: "Delete to line end", keys: ["ctrl+k"], when: (s) => s.bodyFocused, run: (s) => s.deleteToLineEnd() },
)
