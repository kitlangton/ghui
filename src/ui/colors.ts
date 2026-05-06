export type ThemeId =
	| "system"
	| "ghui"
	| "tokyo-night"
	| "catppuccin"
	| "catppuccin-latte"
	| "rose-pine"
	| "rose-pine-dawn"
	| "gruvbox"
	| "gruvbox-light"
	| "nord"
	| "dracula"
	| "kanagawa"
	| "one-dark"
	| "one-light"
	| "monokai"
	| "solarized-dark"
	| "solarized-light"
	| "everforest"
	| "vesper"
	| "vague"
	| "ayu"
	| "ayu-mirage"
	| "ayu-light"
	| "github-dark-dimmed"
	| "palenight"
	| "opencode"
	| "cursor"

export type ThemeTone = "dark" | "light"

export interface ColorPalette {
	readonly background: string
	readonly modalBackground: string
	readonly text: string
	readonly muted: string
	readonly separator: string
	readonly accent: string
	readonly link: string
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
	readonly tone: ThemeTone
	readonly colors: ColorPalette
}

interface TerminalThemeColors {
	readonly palette: readonly (string | null)[]
	readonly defaultForeground: string | null
	readonly defaultBackground: string | null
	readonly highlightBackground: string | null
	readonly highlightForeground: string | null
}

const readableHex = (value: string | null | undefined, fallback: string) => (typeof value === "string" && /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(value) ? value : fallback)

const hexToRgb = (hex: string) => {
	const value = hex.replace(/^#/, "").slice(0, 6)
	return {
		r: parseInt(value.slice(0, 2), 16),
		g: parseInt(value.slice(2, 4), 16),
		b: parseInt(value.slice(4, 6), 16),
	}
}

const luminance = (hex: string) => {
	const { r, g, b } = hexToRgb(hex)
	return 0.299 * r + 0.587 * g + 0.114 * b
}

const rgbToHex = ({ r, g, b }: { readonly r: number; readonly g: number; readonly b: number }) =>
	`#${[r, g, b]
		.map((component) =>
			Math.max(0, Math.min(255, Math.round(component)))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`

export const mixHex = (base: string, overlay: string, amount: number) => {
	const from = hexToRgb(base)
	const to = hexToRgb(overlay)
	return rgbToHex({
		r: from.r + (to.r - from.r) * amount,
		g: from.g + (to.g - from.g) * amount,
		b: from.b + (to.b - from.b) * amount,
	})
}

export const rowHoverBackground = () => mixHex(colors.modalBackground, colors.selectedBg, 0.38)

const grayscaleRamp = (background: string) => {
	const bg = hexToRgb(background)
	const bgLum = luminance(background)
	const isDark = bgLum < 128
	const grays: Record<number, string> = {}

	for (let i = 1; i <= 12; i++) {
		const factor = i / 12
		let r: number
		let g: number
		let b: number

		if (isDark) {
			if (bgLum < 10) {
				const value = Math.floor(factor * 0.4 * 255)
				r = value
				g = value
				b = value
			} else {
				const nextLum = bgLum + (255 - bgLum) * factor * 0.4
				const ratio = nextLum / bgLum
				r = Math.min(bg.r * ratio, 255)
				g = Math.min(bg.g * ratio, 255)
				b = Math.min(bg.b * ratio, 255)
			}
		} else if (bgLum > 245) {
			const value = Math.floor(255 - factor * 0.4 * 255)
			r = value
			g = value
			b = value
		} else {
			const nextLum = bgLum * (1 - factor * 0.4)
			const ratio = nextLum / bgLum
			r = Math.max(bg.r * ratio, 0)
			g = Math.max(bg.g * ratio, 0)
			b = Math.max(bg.b * ratio, 0)
		}

		grays[i] = rgbToHex({ r, g, b })
	}

	return grays
}

const mutedTextColor = (background: string) => {
	const bgLum = luminance(background)
	const isDark = bgLum < 128
	const value = isDark ? (bgLum < 10 ? 180 : Math.min(Math.floor(160 + bgLum * 0.3), 200)) : bgLum > 245 ? 75 : Math.max(Math.floor(100 - (255 - bgLum) * 0.2), 60)
	return rgbToHex({ r: value, g: value, b: value })
}

const contrastText = (background: string) => (luminance(background) > 128 ? "#000000" : "#ffffff")

export const lineNumberTextColor = (background: string, foreground: string) => {
	const bg = readableHex(background, foreground)
	const fg = readableHex(foreground, contrastText(bg))
	const contrast = Math.abs(luminance(bg) - luminance(fg))
	return mixHex(bg, fg, contrast < 90 ? 0.62 : 0.5)
}

const ghuiColors: ColorPalette = {
	background: "#111018",
	modalBackground: "#1a1a2e",
	text: "#ede7da",
	muted: "#9f9788",
	separator: "#6f685d",
	accent: "#f4a51c",
	link: "#7fb4ca",
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

const makeSystemColors = (terminal?: TerminalThemeColors): ColorPalette => {
	const palette = terminal?.palette ?? []
	const terminalBackground = readableHex(terminal?.defaultBackground, readableHex(palette[0], "#000000"))
	const text = readableHex(terminal?.defaultForeground, readableHex(palette[7], "#ffffff"))
	const grays = grayscaleRamp(terminalBackground)
	const isDark = luminance(terminalBackground) < 128
	const red = readableHex(palette[1], "#cc0000")
	const green = readableHex(palette[2], "#4e9a06")
	const yellow = readableHex(palette[3], "#c4a000")
	const blue = readableHex(palette[4], "#3465a4")
	const magenta = readableHex(palette[5], "#75507b")
	const brightBlack = readableHex(palette[8], mutedTextColor(terminalBackground))
	const brightGreen = readableHex(palette[10], green)
	const brightBlue = readableHex(palette[12], blue)
	const brightMagenta = readableHex(palette[13], magenta)
	const primary = brightBlue
	const panel = grays[2] ?? mixHex(terminalBackground, text, isDark ? 0.07 : 0.08)
	const element = grays[3] ?? mixHex(terminalBackground, text, isDark ? 0.1 : 0.1)
	const border = grays[7] ?? mixHex(terminalBackground, text, isDark ? 0.24 : 0.24)
	const borderSubtle = grays[6] ?? border
	const diffAlpha = isDark ? 0.22 : 0.14

	return {
		background: "transparent",
		modalBackground: panel,
		text,
		muted: mutedTextColor(terminalBackground),
		separator: border,
		accent: primary,
		link: brightBlue,
		inlineCode: brightGreen,
		error: red,
		selectedBg: primary,
		selectedText: contrastText(primary),
		count: primary,
		status: {
			draft: yellow,
			approved: green,
			changes: red,
			review: primary,
			none: brightBlack,
			passing: green,
			pending: yellow,
			failing: red,
		},
		repos: {
			opencode: primary,
			"effect-smol": green,
			"opencode-console": brightMagenta,
			opencontrol: yellow,
			default: blue,
		},
		diff: {
			addedBg: mixHex(terminalBackground, green, diffAlpha),
			removedBg: mixHex(terminalBackground, red, diffAlpha),
			contextBg: panel,
			lineNumberBg: borderSubtle,
			addedLineNumberBg: mixHex(element, green, diffAlpha),
			removedLineNumberBg: mixHex(element, red, diffAlpha),
		},
	}
}

const systemColors: ColorPalette = makeSystemColors()

const tokyoNightColors: ColorPalette = {
	background: "#1a1b26",
	modalBackground: "#24283b",
	text: "#c0caf5",
	muted: "#787c99",
	separator: "#3b4261",
	accent: "#7aa2f7",
	link: "#7dcfff",
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
	link: "#5c9cf5",
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
	link: "#89b4fa",
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

const catppuccinLatteColors: ColorPalette = {
	background: "#eff1f5",
	modalBackground: "#e6e9ef",
	text: "#4c4f69",
	muted: "#8c8fa1",
	separator: "#ccd0da",
	accent: "#8839ef",
	link: "#1e66f5",
	inlineCode: "#ea76cb",
	error: "#d20f39",
	selectedBg: "#dce0e8",
	selectedText: "#4c4f69",
	count: "#fe640b",
	status: {
		draft: "#df8e1d",
		approved: "#40a02b",
		changes: "#d20f39",
		review: "#1e66f5",
		none: "#8c8fa1",
		passing: "#40a02b",
		pending: "#df8e1d",
		failing: "#d20f39",
	},
	repos: {
		opencode: "#1e66f5",
		"effect-smol": "#40a02b",
		"opencode-console": "#ea76cb",
		opencontrol: "#fe640b",
		default: "#209fb5",
	},
	diff: {
		addedBg: "#d9f0d1",
		removedBg: "#f5d8d6",
		contextBg: "transparent",
		lineNumberBg: "#e6e9ef",
		addedLineNumberBg: "#d1ebd0",
		removedLineNumberBg: "#f0dcd9",
	},
}

const rosePineColors: ColorPalette = {
	background: "#191724",
	modalBackground: "#26233a",
	text: "#e0def4",
	muted: "#908caa",
	separator: "#524f67",
	accent: "#c4a7e7",
	link: "#9ccfd8",
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

const rosePineDawnColors: ColorPalette = {
	background: "#faf4ed",
	modalBackground: "#f2e9e1",
	text: "#575279",
	muted: "#9893a5",
	separator: "#d5c6d3",
	accent: "#907aa9",
	link: "#56949f",
	inlineCode: "#ea9d34",
	error: "#b4637a",
	selectedBg: "#e6dfdb",
	selectedText: "#575279",
	count: "#d7827a",
	status: {
		draft: "#ea9d34",
		approved: "#56949f",
		changes: "#b4637a",
		review: "#286983",
		none: "#9893a5",
		passing: "#56949f",
		pending: "#ea9d34",
		failing: "#b4637a",
	},
	repos: {
		opencode: "#286983",
		"effect-smol": "#56949f",
		"opencode-console": "#907aa9",
		opencontrol: "#ea9d34",
		default: "#d7827a",
	},
	diff: {
		addedBg: "#e3f0e8",
		removedBg: "#f5e1e0",
		contextBg: "transparent",
		lineNumberBg: "#f2e9e1",
		addedLineNumberBg: "#dcede3",
		removedLineNumberBg: "#f0dede",
	},
}

const gruvboxColors: ColorPalette = {
	background: "#282828",
	modalBackground: "#3c3836",
	text: "#ebdbb2",
	muted: "#928374",
	separator: "#665c54",
	accent: "#fabd2f",
	link: "#83a598",
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

const gruvboxLightColors: ColorPalette = {
	background: "#fbf1c7",
	modalBackground: "#ebdbb2",
	text: "#3c3836",
	muted: "#928374",
	separator: "#d5c4a1",
	accent: "#b57614",
	link: "#076678",
	inlineCode: "#8f3f71",
	error: "#cc241d",
	selectedBg: "#d5c4a1",
	selectedText: "#3c3836",
	count: "#af3a03",
	status: {
		draft: "#b57614",
		approved: "#79740e",
		changes: "#cc241d",
		review: "#076678",
		none: "#928374",
		passing: "#79740e",
		pending: "#b57614",
		failing: "#cc241d",
	},
	repos: {
		opencode: "#076678",
		"effect-smol": "#79740e",
		"opencode-console": "#8f3f71",
		opencontrol: "#af3a03",
		default: "#427b58",
	},
	diff: {
		addedBg: "#e6f3d8",
		removedBg: "#f7e1d6",
		contextBg: "transparent",
		lineNumberBg: "#ebdbb2",
		addedLineNumberBg: "#dbebd1",
		removedLineNumberBg: "#f0ddd6",
	},
}

const nordColors: ColorPalette = {
	background: "#2e3440",
	modalBackground: "#3b4252",
	text: "#eceff4",
	muted: "#8892a7",
	separator: "#4c566a",
	accent: "#88c0d0",
	link: "#81a1c1",
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
	link: "#8be9fd",
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
	link: "#7fb4ca",
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
	link: "#56b6c2",
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

const oneLightColors: ColorPalette = {
	background: "#fafafa",
	modalBackground: "#f0f0f0",
	text: "#383a42",
	muted: "#a0a1a7",
	separator: "#d5d5d5",
	accent: "#4078f2",
	link: "#0184bc",
	inlineCode: "#a626a4",
	error: "#e45649",
	selectedBg: "#e5e5e6",
	selectedText: "#383a42",
	count: "#c18401",
	status: {
		draft: "#c18401",
		approved: "#50a14f",
		changes: "#e45649",
		review: "#4078f2",
		none: "#a0a1a7",
		passing: "#50a14f",
		pending: "#c18401",
		failing: "#e45649",
	},
	repos: {
		opencode: "#4078f2",
		"effect-smol": "#50a14f",
		"opencode-console": "#a626a4",
		opencontrol: "#c18401",
		default: "#0184bc",
	},
	diff: {
		addedBg: "#e1f0d8",
		removedBg: "#f5e1df",
		contextBg: "transparent",
		lineNumberBg: "#f0f0f0",
		addedLineNumberBg: "#d5ebd4",
		removedLineNumberBg: "#f0dedc",
	},
}

const monokaiColors: ColorPalette = {
	background: "#272822",
	modalBackground: "#383830",
	text: "#f8f8f2",
	muted: "#90908a",
	separator: "#5b5b50",
	accent: "#66d9ef",
	link: "#66d9ef",
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
	link: "#268bd2",
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

const solarizedLightColors: ColorPalette = {
	background: "#fdf6e3",
	modalBackground: "#eee8d5",
	text: "#657b83",
	muted: "#93a1a1",
	separator: "#d5cdb8",
	accent: "#268bd2",
	link: "#268bd2",
	inlineCode: "#2aa198",
	error: "#dc322f",
	selectedBg: "#e4ddc9",
	selectedText: "#073642",
	count: "#cb4b16",
	status: {
		draft: "#b58900",
		approved: "#859900",
		changes: "#dc322f",
		review: "#268bd2",
		none: "#93a1a1",
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
		addedBg: "#e7f2d5",
		removedBg: "#f5e1d7",
		contextBg: "transparent",
		lineNumberBg: "#f2e9d8",
		addedLineNumberBg: "#e3edd7",
		removedLineNumberBg: "#f0e0d8",
	},
}

const everforestColors: ColorPalette = {
	background: "#2d353b",
	modalBackground: "#343f44",
	text: "#d3c6aa",
	muted: "#859289",
	separator: "#56635f",
	accent: "#7fbbb3",
	link: "#7fbbb3",
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
	link: "#99FFE4",
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

const vagueColors: ColorPalette = {
	background: "#141415",
	modalBackground: "#1c1c24",
	text: "#cdcdcd",
	muted: "#606079",
	separator: "#252530",
	accent: "#6e94b2",
	link: "#6e94b2",
	inlineCode: "#e8b589",
	error: "#d8647e",
	selectedBg: "#333738",
	selectedText: "#cdcdcd",
	count: "#e0a363",
	status: {
		draft: "#f3be7c",
		approved: "#7fa563",
		changes: "#d8647e",
		review: "#7e98e8",
		none: "#606079",
		passing: "#7fa563",
		pending: "#f3be7c",
		failing: "#d8647e",
	},
	repos: {
		opencode: "#6e94b2",
		"effect-smol": "#7fa563",
		"opencode-console": "#bb9dbd",
		opencontrol: "#e0a363",
		default: "#b4d4cf",
	},
	diff: {
		addedBg: "#293125",
		removedBg: "#3b242a",
		contextBg: "transparent",
		lineNumberBg: "#1c1c24",
		addedLineNumberBg: "#253020",
		removedLineNumberBg: "#352126",
	},
}

// Ayu theme - Modern bright theme with dark, mirage, and light variants
const ayuColors: ColorPalette = {
	background: "#0f1419",
	modalBackground: "#131d27",
	text: "#bfbdb6",
	muted: "#565b66",
	separator: "#242936",
	accent: "#39bae6",
	link: "#73b8ff",
	inlineCode: "#73b8ff",
	error: "#f26d78",
	selectedBg: "#1c2c3b",
	selectedText: "#e6e1cf",
	count: "#f29718",
	status: {
		draft: "#ffb454",
		approved: "#7ee787",
		changes: "#f26d78",
		review: "#39bae6",
		none: "#565b66",
		passing: "#7ee787",
		pending: "#ffb454",
		failing: "#f26d78",
	},
	repos: {
		opencode: "#39bae6",
		"effect-smol": "#7ee787",
		"opencode-console": "#d2a6ff",
		opencontrol: "#f29718",
		default: "#73b8ff",
	},
	diff: {
		addedBg: "#1b322b",
		removedBg: "#3b2226",
		contextBg: "transparent",
		lineNumberBg: "#0b0f14",
		addedLineNumberBg: "#162b24",
		removedLineNumberBg: "#321e21",
	},
}

const ayuMirageColors: ColorPalette = {
	background: "#1f2430",
	modalBackground: "#242936",
	text: "#cccac2",
	muted: "#8a9199",
	separator: "#33415e",
	accent: "#73b8ff",
	link: "#73b8ff",
	inlineCode: "#d2a6ff",
	error: "#f07178",
	selectedBg: "#2a3546",
	selectedText: "#ffffff",
	count: "#ffcc66",
	status: {
		draft: "#ffcc66",
		approved: "#87d96c",
		changes: "#f07178",
		review: "#73b8ff",
		none: "#8a9199",
		passing: "#87d96c",
		pending: "#ffcc66",
		failing: "#f07178",
	},
	repos: {
		opencode: "#73b8ff",
		"effect-smol": "#87d96c",
		"opencode-console": "#d2a6ff",
		opencontrol: "#ffcc66",
		default: "#5ccfe6",
	},
	diff: {
		addedBg: "#243b30",
		removedBg: "#3f2c30",
		contextBg: "transparent",
		lineNumberBg: "#191e2a",
		addedLineNumberBg: "#1f342b",
		removedLineNumberBg: "#38282b",
	},
}

const ayuLightColors: ColorPalette = {
	background: "#fcfcfc",
	modalBackground: "#f3f4f5",
	text: "#5c6166",
	muted: "#8a9199",
	separator: "#d3d5d8",
	accent: "#0580f2",
	link: "#399ee6",
	inlineCode: "#a37acc",
	error: "#e65050",
	selectedBg: "#e7eaed",
	selectedText: "#24292f",
	count: "#f29718",
	status: {
		draft: "#f29718",
		approved: "#4cbf99",
		changes: "#e65050",
		review: "#0580f2",
		none: "#8a9199",
		passing: "#4cbf99",
		pending: "#f29718",
		failing: "#e65050",
	},
	repos: {
		opencode: "#0580f2",
		"effect-smol": "#4cbf99",
		"opencode-console": "#a37acc",
		opencontrol: "#f29718",
		default: "#33a3dc",
	},
	diff: {
		addedBg: "#e6f2dc",
		removedBg: "#f5e1df",
		contextBg: "transparent",
		lineNumberBg: "#f0f0f0",
		addedLineNumberBg: "#d9ebd2",
		removedLineNumberBg: "#f0dedc",
	},
}

// GitHub Dark Dimmed - Slightly muted variant of GitHub Dark Default
const githubDarkDimmedColors: ColorPalette = {
	background: "#22272e",
	modalBackground: "#2d333b",
	text: "#adbac7",
	muted: "#768390",
	separator: "#444c56",
	accent: "#539bf5",
	link: "#539bf5",
	inlineCode: "#f47067",
	error: "#e5534b",
	selectedBg: "#373e47",
	selectedText: "#cdd9e5",
	count: "#da3633",
	status: {
		draft: "#c69026",
		approved: "#57ab5a",
		changes: "#e5534b",
		review: "#539bf5",
		none: "#768390",
		passing: "#57ab5a",
		pending: "#c69026",
		failing: "#e5534b",
	},
	repos: {
		opencode: "#539bf5",
		"effect-smol": "#6bc46d",
		"opencode-console": "#b083f0",
		opencontrol: "#e0823d",
		default: "#6cb6ff",
	},
	diff: {
		addedBg: "#1b3a2a",
		removedBg: "#3b2626",
		contextBg: "transparent",
		lineNumberBg: "#1c2128",
		addedLineNumberBg: "#163225",
		removedLineNumberBg: "#332222",
	},
}

// Material Palenight - Purple-tinted material theme variant
const palenightColors: ColorPalette = {
	background: "#292d3e",
	modalBackground: "#313442",
	text: "#a6accd",
	muted: "#676e95",
	separator: "#3e4451",
	accent: "#82aaff",
	link: "#82aaff",
	inlineCode: "#c792ea",
	error: "#ff5370",
	selectedBg: "#3d445b",
	selectedText: "#ffffff",
	count: "#ffcb6b",
	status: {
		draft: "#ffcb6b",
		approved: "#c3e88d",
		changes: "#ff5370",
		review: "#82aaff",
		none: "#676e95",
		passing: "#c3e88d",
		pending: "#ffcb6b",
		failing: "#ff5370",
	},
	repos: {
		opencode: "#82aaff",
		"effect-smol": "#c3e88d",
		"opencode-console": "#c792ea",
		opencontrol: "#ffcb6b",
		default: "#89ddff",
	},
	diff: {
		addedBg: "#253328",
		removedBg: "#3b252d",
		contextBg: "transparent",
		lineNumberBg: "#232634",
		addedLineNumberBg: "#1f2d24",
		removedLineNumberBg: "#332329",
	},
}

// Cursor theme - Deep charcoal base with Anysphere's signature bright blue accents
const cursorColors: ColorPalette = {
	background: "#181818",
	modalBackground: "#232323",
	text: "#cccccc",
	muted: "#858585",
	separator: "#3c3c3c",
	accent: "#228df2",
	link: "#4fc1ff",
	inlineCode: "#4ec9b0",
	error: "#f14c4c",
	selectedBg: "#26354c",
	selectedText: "#e8e8e8",
	count: "#4fc1ff",
	status: {
		draft: "#cca700",
		approved: "#4ec9b0",
		changes: "#f14c4c",
		review: "#228df2",
		none: "#858585",
		passing: "#4ec9b0",
		pending: "#cca700",
		failing: "#f14c4c",
	},
	repos: {
		opencode: "#228df2",
		"effect-smol": "#4ec9b0",
		"opencode-console": "#c586c0",
		opencontrol: "#ce9178",
		default: "#4fc1ff",
	},
	diff: {
		addedBg: "#1b3a2b",
		removedBg: "#3a1e22",
		contextBg: "transparent",
		lineNumberBg: "#1a1a1a",
		addedLineNumberBg: "#193627",
		removedLineNumberBg: "#351c20",
	},
}

export const themeDefinitions: readonly ThemeDefinition[] = [
	{ id: "system", name: "System", description: "Use the terminal foreground, background, and ANSI palette", tone: "dark", colors: systemColors },
	{ id: "ghui", name: "GHUI", description: "Warm parchment accents on a deep slate background", tone: "dark", colors: ghuiColors },
	{ id: "tokyo-night", name: "Tokyo Night", description: "Cool indigo surfaces with neon editor accents", tone: "dark", colors: tokyoNightColors },
	{ id: "catppuccin", name: "Catppuccin", description: "Mocha lavender, peach, and soft pastel contrast", tone: "dark", colors: catppuccinColors },
	{ id: "catppuccin-latte", name: "Catppuccin Latte", description: "Light frothy cream with pastel lavender and peach", tone: "light", colors: catppuccinLatteColors },
	{ id: "rose-pine", name: "Rose Pine", description: "Muted rose, pine, and gold on dusky violet", tone: "dark", colors: rosePineColors },
	{ id: "rose-pine-dawn", name: "Rose Pine Dawn", description: "Soft morning light with rose and sage accents", tone: "light", colors: rosePineDawnColors },
	{ id: "gruvbox", name: "Gruvbox", description: "Retro warm earth tones with punchy semantic accents", tone: "dark", colors: gruvboxColors },
	{ id: "gruvbox-light", name: "Gruvbox Light", description: "Warm parchment background with earthy retro colors", tone: "light", colors: gruvboxLightColors },
	{ id: "nord", name: "Nord", description: "Arctic blue-gray surfaces with frosty accents", tone: "dark", colors: nordColors },
	{ id: "dracula", name: "Dracula", description: "High-contrast purple, pink, cyan, and green", tone: "dark", colors: draculaColors },
	{ id: "kanagawa", name: "Kanagawa", description: "Ink-wash indigo, wave blues, and autumn accents", tone: "dark", colors: kanagawaColors },
	{ id: "one-dark", name: "One Dark", description: "Atom-style charcoal with clean blue and green accents", tone: "dark", colors: oneDarkColors },
	{ id: "one-light", name: "One Light", description: "Clean light surfaces with balanced blue and green accents", tone: "light", colors: oneLightColors },
	{ id: "monokai", name: "Monokai", description: "Classic dark olive with electric syntax colors", tone: "dark", colors: monokaiColors },
	{ id: "solarized-dark", name: "Solarized Dark", description: "Low-contrast blue-green base with calibrated accents", tone: "dark", colors: solarizedDarkColors },
	{ id: "solarized-light", name: "Solarized Light", description: "Warm beige base with the same calibrated accent colors", tone: "light", colors: solarizedLightColors },
	{ id: "everforest", name: "Everforest", description: "Soft green-gray forest tones with warm highlights", tone: "dark", colors: everforestColors },
	{ id: "vesper", name: "Vesper", description: "Minimal black surfaces with peach and aqua accents", tone: "dark", colors: vesperColors },
	{ id: "vague", name: "Vague", description: "Muted low-contrast charcoal with soft editor accents", tone: "dark", colors: vagueColors },
	{ id: "ayu", name: "Ayu", description: "Modern bright dark theme with blue and orange accents", tone: "dark", colors: ayuColors },
	{ id: "ayu-mirage", name: "Ayu Mirage", description: "Medium-contrast blue-gray with vibrant syntax colors", tone: "dark", colors: ayuMirageColors },
	{ id: "ayu-light", name: "Ayu Light", description: "Clean light theme with crisp blue and orange accents", tone: "light", colors: ayuLightColors },
	{ id: "github-dark-dimmed", name: "GitHub Dark Dimmed", description: "GitHub-inspired muted dark blue-gray with soft accents", tone: "dark", colors: githubDarkDimmedColors },
	{ id: "palenight", name: "Palenight", description: "Material-inspired purple-blue with soft lavender tones", tone: "dark", colors: palenightColors },
	{ id: "opencode", name: "OpenCode", description: "Charcoal panels with peach, violet, and blue highlights", tone: "dark", colors: opencodeColors },
	{ id: "cursor", name: "Cursor", description: "Deep charcoal base with Anysphere's signature bright blue accents", tone: "dark", colors: cursorColors },
] as const

const pairedThemeIds: Partial<Record<ThemeId, ThemeId>> = {
	catppuccin: "catppuccin-latte",
	"catppuccin-latte": "catppuccin",
	"rose-pine": "rose-pine-dawn",
	"rose-pine-dawn": "rose-pine",
	gruvbox: "gruvbox-light",
	"gruvbox-light": "gruvbox",
	"one-dark": "one-light",
	"one-light": "one-dark",
	"solarized-dark": "solarized-light",
	"solarized-light": "solarized-dark",
	ayu: "ayu-light",
	"ayu-mirage": "ayu-light",
	"ayu-light": "ayu",
}

let activeTheme = themeDefinitions.find((theme) => theme.id === "ghui") ?? themeDefinitions[0]!

export const colors: ColorPalette = { ...ghuiColors }

export const getThemeDefinition = (id: ThemeId) => themeDefinitions.find((theme) => theme.id === id) ?? themeDefinitions[0]!

export const isThemeId = (value: unknown): value is ThemeId => typeof value === "string" && themeDefinitions.some((theme) => theme.id === value)

export const themeToneForThemeId = (id: ThemeId): ThemeTone => getThemeDefinition(id).tone

export const oppositeThemeTone = (tone: ThemeTone): ThemeTone => (tone === "dark" ? "light" : "dark")

export const pairedThemeId = (id: ThemeId, tone: ThemeTone): ThemeId | null => {
	const pairedId = pairedThemeIds[id]
	return pairedId && themeToneForThemeId(pairedId) === tone ? pairedId : null
}

export const filterThemeDefinitions = (query: string, tone: ThemeTone = "dark") => {
	const normalized = query.trim().toLowerCase()
	const matchingTone = themeDefinitions.filter((theme) => theme.tone === tone)
	if (normalized.length === 0) return matchingTone
	return matchingTone.filter((theme) => theme.id.includes(normalized) || theme.name.toLowerCase().includes(normalized) || theme.description.toLowerCase().includes(normalized))
}

export const setActiveTheme = (id: ThemeId) => {
	if (activeTheme.id === id) return
	activeTheme = getThemeDefinition(id)
	Object.assign(colors, activeTheme.colors)
}

export const setSystemThemeColors = (terminalColors: TerminalThemeColors) => {
	Object.assign(systemColors, makeSystemColors(terminalColors))
	if (activeTheme.id === "system") {
		Object.assign(colors, systemColors)
	}
}
