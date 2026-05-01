export type ThemeId = "ghui" | "tokyo-night" | "opencode"

export interface ColorPalette {
	readonly background: string
	readonly panel: string
	readonly modalBackground: string
	readonly text: string
	readonly muted: string
	readonly separator: string
	readonly accent: string
	readonly inlineCode: string
	readonly error: string
	readonly selectedBg: string
	readonly selectedText: string
	readonly count: string
	readonly status: {
		readonly draft: string
		readonly approved: string
		readonly changes: string
		readonly review: string
		readonly none: string
		readonly passing: string
		readonly pending: string
		readonly failing: string
	}
	readonly repos: {
		readonly opencode: string
		readonly "effect-smol": string
		readonly "opencode-console": string
		readonly opencontrol: string
		readonly default: string
	}
	readonly diff: {
		readonly addedBg: string
		readonly removedBg: string
		readonly contextBg: string
		readonly lineNumberBg: string
		readonly addedLineNumberBg: string
		readonly removedLineNumberBg: string
	}
}

export interface ThemeDefinition {
	readonly id: ThemeId
	readonly name: string
	readonly description: string
	readonly colors: ColorPalette
}

const ghuiColors: ColorPalette = {
	background: "#111018",
	panel: "#161923",
	modalBackground: "#1a1a2e",
	text: "#ede7da",
	muted: "#9f9788",
	separator: "#6f685d",
	accent: "#f4a51c",
	inlineCode: "#d7c5a1",
	error: "#f97316",
	selectedBg: "#1d2430",
	selectedText: "#f8fafc",
	count: "#d7c5a1",
	status: {
		draft: "#f59e0b",
		approved: "#7dd3a3",
		changes: "#f87171",
		review: "#93c5fd",
		none: "#9f9788",
		passing: "#7dd3a3",
		pending: "#f4a51c",
		failing: "#f87171",
	},
	repos: {
		opencode: "#60a5fa",
		"effect-smol": "#34d399",
		"opencode-console": "#f472b6",
		opencontrol: "#f59e0b",
		default: "#93c5fd",
	},
	diff: {
		addedBg: "#17351f",
		removedBg: "#3a1e22",
		contextBg: "transparent",
		lineNumberBg: "#151515",
		addedLineNumberBg: "#12301a",
		removedLineNumberBg: "#35171b",
	},
}

const tokyoNightColors: ColorPalette = {
	background: "#1a1b26",
	panel: "#16161e",
	modalBackground: "#24283b",
	text: "#c0caf5",
	muted: "#787c99",
	separator: "#3b4261",
	accent: "#7aa2f7",
	inlineCode: "#bb9af7",
	error: "#f7768e",
	selectedBg: "#283457",
	selectedText: "#ffffff",
	count: "#ff9e64",
	status: {
		draft: "#e0af68",
		approved: "#9ece6a",
		changes: "#f7768e",
		review: "#7dcfff",
		none: "#787c99",
		passing: "#9ece6a",
		pending: "#e0af68",
		failing: "#f7768e",
	},
	repos: {
		opencode: "#7aa2f7",
		"effect-smol": "#9ece6a",
		"opencode-console": "#bb9af7",
		opencontrol: "#ff9e64",
		default: "#7dcfff",
	},
	diff: {
		addedBg: "#203326",
		removedBg: "#3a222c",
		contextBg: "transparent",
		lineNumberBg: "#16161e",
		addedLineNumberBg: "#1b2f23",
		removedLineNumberBg: "#33202a",
	},
}

const opencodeColors: ColorPalette = {
	background: "#0a0a0a",
	panel: "#141414",
	modalBackground: "#1e1e1e",
	text: "#eeeeee",
	muted: "#808080",
	separator: "#484848",
	accent: "#fab283",
	inlineCode: "#7fd88f",
	error: "#e06c75",
	selectedBg: "#323232",
	selectedText: "#eeeeee",
	count: "#fab283",
	status: {
		draft: "#f5a742",
		approved: "#7fd88f",
		changes: "#e06c75",
		review: "#5c9cf5",
		none: "#808080",
		passing: "#7fd88f",
		pending: "#f5a742",
		failing: "#e06c75",
	},
	repos: {
		opencode: "#fab283",
		"effect-smol": "#7fd88f",
		"opencode-console": "#9d7cd8",
		opencontrol: "#f5a742",
		default: "#5c9cf5",
	},
	diff: {
		addedBg: "#20303b",
		removedBg: "#37222c",
		contextBg: "transparent",
		lineNumberBg: "#141414",
		addedLineNumberBg: "#1b2b34",
		removedLineNumberBg: "#2d1f26",
	},
}

export const themeDefinitions: readonly ThemeDefinition[] = [
	{ id: "ghui", name: "GHUI", description: "Warm parchment accents on a deep slate background", colors: ghuiColors },
	{ id: "tokyo-night", name: "Tokyo Night", description: "Cool indigo surfaces with neon editor accents", colors: tokyoNightColors },
	{ id: "opencode", name: "OpenCode", description: "Charcoal panels with peach, violet, and blue highlights", colors: opencodeColors },
] as const

let activeTheme = themeDefinitions[0]!

export const colors: ColorPalette = { ...ghuiColors }

export const getThemeDefinition = (id: ThemeId) => themeDefinitions.find((theme) => theme.id === id) ?? themeDefinitions[0]!

export const setActiveTheme = (id: ThemeId) => {
	activeTheme = getThemeDefinition(id)
	Object.assign(colors, activeTheme.colors)
}
