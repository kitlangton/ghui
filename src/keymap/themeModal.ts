import { context } from "@ghui/keymap"

export interface ThemeModalCtx {
	readonly filterMode: boolean
	readonly hasFilteredResults: boolean
	readonly closeWithoutSaving: () => void
	readonly clearFilter: () => void
	readonly enterFilterMode: () => void
	readonly toggleMode: () => void
	readonly toggleTone: () => void
	readonly confirmSelection: () => void
	readonly moveSelection: (delta: -1 | 1) => void
}

const Theme = context<ThemeModalCtx>()

export const themeModalKeymap = Theme(
	{
		id: "theme-modal.escape",
		title: "Cancel",
		keys: ["escape"],
		run: (s) => {
			if (s.filterMode) s.clearFilter()
			else s.closeWithoutSaving()
		},
	},
	{ id: "theme-modal.filter", title: "Filter themes", keys: ["/"], run: (s) => s.enterFilterMode() },
	{ id: "theme-modal.toggle-mode", title: "Toggle fixed/system theme mode", keys: ["m"], when: (s) => !s.filterMode, run: (s) => s.toggleMode() },
	{ id: "theme-modal.toggle-tone", title: "Toggle light/dark themes", keys: ["tab"], run: (s) => s.toggleTone() },
	{
		id: "theme-modal.confirm",
		title: "Apply theme",
		keys: ["return"],
		enabled: (s) => (!s.hasFilteredResults ? "No matching themes." : true),
		run: (s) => s.confirmSelection(),
	},
	{ id: "theme-modal.up-arrow", title: "Up", keys: ["up", "ctrl+p", "ctrl+k"], run: (s) => s.moveSelection(-1) },
	{ id: "theme-modal.down-arrow", title: "Down", keys: ["down", "ctrl+n", "ctrl+j"], run: (s) => s.moveSelection(1) },
	{
		id: "theme-modal.up-letter",
		title: "Up",
		keys: ["k"],
		when: (s) => !s.filterMode,
		run: (s) => s.moveSelection(-1),
	},
	{
		id: "theme-modal.down-letter",
		title: "Down",
		keys: ["j"],
		when: (s) => !s.filterMode,
		run: (s) => s.moveSelection(1),
	},
)
