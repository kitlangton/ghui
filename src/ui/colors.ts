export type ThemeId =
	| "ghui"
	| "tokyo-night"
	| "catppuccin"
	| "rose-pine"
	| "gruvbox"
	| "nord"
	| "dracula"
	| "kanagawa"
	| "one-dark"
	| "monokai"
	| "solarized-dark"
	| "everforest"
	| "vesper"
	| "opencode"

export interface ColorPalette {
	readonly background: string
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

const catppuccinColors: ColorPalette = {
	background: "#1e1e2e",
	modalBackground: "#313244",
	text: "#cdd6f4",
	muted: "#7f849c",
	separator: "#45475a",
	accent: "#cba6f7",
	inlineCode: "#f5c2e7",
	error: "#f38ba8",
	selectedBg: "#45475a",
	selectedText: "#f5e0dc",
	count: "#fab387",
	status: {
		draft: "#f9e2af",
		approved: "#a6e3a1",
		changes: "#f38ba8",
		review: "#89b4fa",
		none: "#7f849c",
		passing: "#a6e3a1",
		pending: "#f9e2af",
		failing: "#f38ba8",
	},
	repos: {
		opencode: "#89b4fa",
		"effect-smol": "#a6e3a1",
		"opencode-console": "#f5c2e7",
		opencontrol: "#fab387",
		default: "#74c7ec",
	},
	diff: {
		addedBg: "#243927",
		removedBg: "#3b2532",
		contextBg: "transparent",
		lineNumberBg: "#181825",
		addedLineNumberBg: "#203524",
		removedLineNumberBg: "#36232f",
	},
}

const rosePineColors: ColorPalette = {
	background: "#191724",
	modalBackground: "#26233a",
	text: "#e0def4",
	muted: "#908caa",
	separator: "#524f67",
	accent: "#c4a7e7",
	inlineCode: "#f6c177",
	error: "#eb6f92",
	selectedBg: "#403d52",
	selectedText: "#f6f1ff",
	count: "#ebbcba",
	status: {
		draft: "#f6c177",
		approved: "#9ccfd8",
		changes: "#eb6f92",
		review: "#31748f",
		none: "#908caa",
		passing: "#9ccfd8",
		pending: "#f6c177",
		failing: "#eb6f92",
	},
	repos: {
		opencode: "#31748f",
		"effect-smol": "#9ccfd8",
		"opencode-console": "#c4a7e7",
		opencontrol: "#f6c177",
		default: "#ebbcba",
	},
	diff: {
		addedBg: "#23343a",
		removedBg: "#3a2534",
		contextBg: "transparent",
		lineNumberBg: "#1f1d2e",
		addedLineNumberBg: "#203137",
		removedLineNumberBg: "#352330",
	},
}

const gruvboxColors: ColorPalette = {
	background: "#282828",
	modalBackground: "#3c3836",
	text: "#ebdbb2",
	muted: "#928374",
	separator: "#665c54",
	accent: "#fabd2f",
	inlineCode: "#d3869b",
	error: "#fb4934",
	selectedBg: "#504945",
	selectedText: "#fbf1c7",
	count: "#fe8019",
	status: {
		draft: "#fabd2f",
		approved: "#b8bb26",
		changes: "#fb4934",
		review: "#83a598",
		none: "#928374",
		passing: "#b8bb26",
		pending: "#fabd2f",
		failing: "#fb4934",
	},
	repos: {
		opencode: "#83a598",
		"effect-smol": "#b8bb26",
		"opencode-console": "#d3869b",
		opencontrol: "#fe8019",
		default: "#8ec07c",
	},
	diff: {
		addedBg: "#32361f",
		removedBg: "#3c2927",
		contextBg: "transparent",
		lineNumberBg: "#1d2021",
		addedLineNumberBg: "#2f331e",
		removedLineNumberBg: "#382726",
	},
}

const nordColors: ColorPalette = {
	background: "#2e3440",
	modalBackground: "#3b4252",
	text: "#eceff4",
	muted: "#8892a7",
	separator: "#4c566a",
	accent: "#88c0d0",
	inlineCode: "#b48ead",
	error: "#bf616a",
	selectedBg: "#434c5e",
	selectedText: "#eceff4",
	count: "#ebcb8b",
	status: {
		draft: "#ebcb8b",
		approved: "#a3be8c",
		changes: "#bf616a",
		review: "#81a1c1",
		none: "#8892a7",
		passing: "#a3be8c",
		pending: "#ebcb8b",
		failing: "#bf616a",
	},
	repos: {
		opencode: "#81a1c1",
		"effect-smol": "#a3be8c",
		"opencode-console": "#b48ead",
		opencontrol: "#d08770",
		default: "#88c0d0",
	},
	diff: {
		addedBg: "#334033",
		removedBg: "#433238",
		contextBg: "transparent",
		lineNumberBg: "#242933",
		addedLineNumberBg: "#303d31",
		removedLineNumberBg: "#3f3036",
	},
}

const draculaColors: ColorPalette = {
	background: "#282a36",
	modalBackground: "#343746",
	text: "#f8f8f2",
	muted: "#8f94b8",
	separator: "#4f5268",
	accent: "#bd93f9",
	inlineCode: "#ff79c6",
	error: "#ff5555",
	selectedBg: "#44475a",
	selectedText: "#f8f8f2",
	count: "#ffb86c",
	status: {
		draft: "#f1fa8c",
		approved: "#50fa7b",
		changes: "#ff5555",
		review: "#8be9fd",
		none: "#8f94b8",
		passing: "#50fa7b",
		pending: "#f1fa8c",
		failing: "#ff5555",
	},
	repos: {
		opencode: "#8be9fd",
		"effect-smol": "#50fa7b",
		"opencode-console": "#ff79c6",
		opencontrol: "#ffb86c",
		default: "#bd93f9",
	},
	diff: {
		addedBg: "#203a29",
		removedBg: "#43272f",
		contextBg: "transparent",
		lineNumberBg: "#21222c",
		addedLineNumberBg: "#1d3627",
		removedLineNumberBg: "#3d252c",
	},
}

const kanagawaColors: ColorPalette = {
	background: "#1f1f28",
	modalBackground: "#2a2a37",
	text: "#dcd7ba",
	muted: "#727169",
	separator: "#54546d",
	accent: "#7e9cd8",
	inlineCode: "#d27e99",
	error: "#c34043",
	selectedBg: "#363646",
	selectedText: "#fff7d6",
	count: "#ffa066",
	status: {
		draft: "#c0a36e",
		approved: "#76946a",
		changes: "#c34043",
		review: "#7e9cd8",
		none: "#727169",
		passing: "#76946a",
		pending: "#c0a36e",
		failing: "#c34043",
	},
	repos: {
		opencode: "#7e9cd8",
		"effect-smol": "#98bb6c",
		"opencode-console": "#957fb8",
		opencontrol: "#ffa066",
		default: "#7fb4ca",
	},
	diff: {
		addedBg: "#253326",
		removedBg: "#3a2528",
		contextBg: "transparent",
		lineNumberBg: "#16161d",
		addedLineNumberBg: "#223025",
		removedLineNumberBg: "#352326",
	},
}

const oneDarkColors: ColorPalette = {
	background: "#282c34",
	modalBackground: "#2c313c",
	text: "#abb2bf",
	muted: "#7f848e",
	separator: "#4b5263",
	accent: "#61afef",
	inlineCode: "#c678dd",
	error: "#e06c75",
	selectedBg: "#3e4451",
	selectedText: "#ffffff",
	count: "#d19a66",
	status: {
		draft: "#e5c07b",
		approved: "#98c379",
		changes: "#e06c75",
		review: "#61afef",
		none: "#7f848e",
		passing: "#98c379",
		pending: "#e5c07b",
		failing: "#e06c75",
	},
	repos: {
		opencode: "#61afef",
		"effect-smol": "#98c379",
		"opencode-console": "#c678dd",
		opencontrol: "#d19a66",
		default: "#56b6c2",
	},
	diff: {
		addedBg: "#27362b",
		removedBg: "#3a282c",
		contextBg: "transparent",
		lineNumberBg: "#21252b",
		addedLineNumberBg: "#243228",
		removedLineNumberBg: "#35262a",
	},
}

const monokaiColors: ColorPalette = {
	background: "#272822",
	modalBackground: "#383830",
	text: "#f8f8f2",
	muted: "#90908a",
	separator: "#5b5b50",
	accent: "#66d9ef",
	inlineCode: "#ae81ff",
	error: "#f92672",
	selectedBg: "#49483e",
	selectedText: "#ffffff",
	count: "#fd971f",
	status: {
		draft: "#e6db74",
		approved: "#a6e22e",
		changes: "#f92672",
		review: "#66d9ef",
		none: "#90908a",
		passing: "#a6e22e",
		pending: "#e6db74",
		failing: "#f92672",
	},
	repos: {
		opencode: "#66d9ef",
		"effect-smol": "#a6e22e",
		"opencode-console": "#ae81ff",
		opencontrol: "#fd971f",
		default: "#a1efe4",
	},
	diff: {
		addedBg: "#2f3a22",
		removedBg: "#3d2430",
		contextBg: "transparent",
		lineNumberBg: "#1f201b",
		addedLineNumberBg: "#2b3620",
		removedLineNumberBg: "#38222d",
	},
}

const solarizedDarkColors: ColorPalette = {
	background: "#002b36",
	modalBackground: "#123d48",
	text: "#eee8d5",
	muted: "#839496",
	separator: "#586e75",
	accent: "#268bd2",
	inlineCode: "#2aa198",
	error: "#dc322f",
	selectedBg: "#174652",
	selectedText: "#fdf6e3",
	count: "#cb4b16",
	status: {
		draft: "#b58900",
		approved: "#859900",
		changes: "#dc322f",
		review: "#268bd2",
		none: "#839496",
		passing: "#859900",
		pending: "#b58900",
		failing: "#dc322f",
	},
	repos: {
		opencode: "#268bd2",
		"effect-smol": "#859900",
		"opencode-console": "#d33682",
		opencontrol: "#cb4b16",
		default: "#2aa198",
	},
	diff: {
		addedBg: "#123c2e",
		removedBg: "#3c262a",
		contextBg: "transparent",
		lineNumberBg: "#073642",
		addedLineNumberBg: "#10372b",
		removedLineNumberBg: "#362429",
	},
}

const everforestColors: ColorPalette = {
	background: "#2d353b",
	modalBackground: "#343f44",
	text: "#d3c6aa",
	muted: "#859289",
	separator: "#56635f",
	accent: "#7fbbb3",
	inlineCode: "#d699b6",
	error: "#e67e80",
	selectedBg: "#465258",
	selectedText: "#fff4d6",
	count: "#e69875",
	status: {
		draft: "#dbbc7f",
		approved: "#a7c080",
		changes: "#e67e80",
		review: "#7fbbb3",
		none: "#859289",
		passing: "#a7c080",
		pending: "#dbbc7f",
		failing: "#e67e80",
	},
	repos: {
		opencode: "#7fbbb3",
		"effect-smol": "#a7c080",
		"opencode-console": "#d699b6",
		opencontrol: "#e69875",
		default: "#83c092",
	},
	diff: {
		addedBg: "#33422f",
		removedBg: "#463333",
		contextBg: "transparent",
		lineNumberBg: "#232a2e",
		addedLineNumberBg: "#303d2d",
		removedLineNumberBg: "#403030",
	},
}

const vesperColors: ColorPalette = {
	background: "#101010",
	modalBackground: "#1A1A1A",
	text: "#FFFFFF",
	muted: "#A0A0A0",
	separator: "#282828",
	accent: "#FFC799",
	inlineCode: "#99FFE4",
	error: "#FF8080",
	selectedBg: "#232323",
	selectedText: "#FFFFFF",
	count: "#FFC799",
	status: {
		draft: "#FFC799",
		approved: "#99FFE4",
		changes: "#FF8080",
		review: "#B0B0B0",
		none: "#7E7E7E",
		passing: "#99FFE4",
		pending: "#FFC799",
		failing: "#FF8080",
	},
	repos: {
		opencode: "#FFC799",
		"effect-smol": "#99FFE4",
		"opencode-console": "#FFD1A8",
		opencontrol: "#FFC799",
		default: "#B0B0B0",
	},
	diff: {
		addedBg: "#17312d",
		removedBg: "#351f1f",
		contextBg: "transparent",
		lineNumberBg: "#101010",
		addedLineNumberBg: "#142b28",
		removedLineNumberBg: "#2f1c1c",
	},
}

export const themeDefinitions: readonly ThemeDefinition[] = [
	{ id: "ghui", name: "GHUI", description: "Warm parchment accents on a deep slate background", colors: ghuiColors },
	{ id: "tokyo-night", name: "Tokyo Night", description: "Cool indigo surfaces with neon editor accents", colors: tokyoNightColors },
	{ id: "catppuccin", name: "Catppuccin", description: "Mocha lavender, peach, and soft pastel contrast", colors: catppuccinColors },
	{ id: "rose-pine", name: "Rose Pine", description: "Muted rose, pine, and gold on dusky violet", colors: rosePineColors },
	{ id: "gruvbox", name: "Gruvbox", description: "Retro warm earth tones with punchy semantic accents", colors: gruvboxColors },
	{ id: "nord", name: "Nord", description: "Arctic blue-gray surfaces with frosty accents", colors: nordColors },
	{ id: "dracula", name: "Dracula", description: "High-contrast purple, pink, cyan, and green", colors: draculaColors },
	{ id: "kanagawa", name: "Kanagawa", description: "Ink-wash indigo, wave blues, and autumn accents", colors: kanagawaColors },
	{ id: "one-dark", name: "One Dark", description: "Atom-style charcoal with clean blue and green accents", colors: oneDarkColors },
	{ id: "monokai", name: "Monokai", description: "Classic dark olive with electric syntax colors", colors: monokaiColors },
	{ id: "solarized-dark", name: "Solarized Dark", description: "Low-contrast blue-green base with calibrated accents", colors: solarizedDarkColors },
	{ id: "everforest", name: "Everforest", description: "Soft green-gray forest tones with warm highlights", colors: everforestColors },
	{ id: "vesper", name: "Vesper", description: "Minimal black surfaces with peach and aqua accents", colors: vesperColors },
	{ id: "opencode", name: "OpenCode", description: "Charcoal panels with peach, violet, and blue highlights", colors: opencodeColors },
] as const

let activeTheme = themeDefinitions[0]!

export const colors: ColorPalette = { ...ghuiColors }

export const getThemeDefinition = (id: ThemeId) => themeDefinitions.find((theme) => theme.id === id) ?? themeDefinitions[0]!

export const isThemeId = (value: unknown): value is ThemeId => typeof value === "string" && themeDefinitions.some((theme) => theme.id === value)

export const filterThemeDefinitions = (query: string) => {
	const normalized = query.trim().toLowerCase()
	if (normalized.length === 0) return themeDefinitions
	return themeDefinitions.filter((theme) =>
		theme.id.includes(normalized) ||
		theme.name.toLowerCase().includes(normalized) ||
		theme.description.toLowerCase().includes(normalized),
	)
}

export const setActiveTheme = (id: ThemeId) => {
	if (activeTheme.id === id) return
	activeTheme = getThemeDefinition(id)
	Object.assign(colors, activeTheme.colors)
}
