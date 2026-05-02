#!/usr/bin/env bun

import { addDefaultParsers, createCliRenderer, createTerminalPalette } from "@opentui/core"
import { RegistryProvider } from "@effect/atom-react"
import { createRoot } from "@opentui/react"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { KeymapProvider } from "@opentui/keymap/react"

process.env.OTUI_USE_ALTERNATE_SCREEN = "true"

addDefaultParsers([
	{
		filetype: "bash",
		aliases: ["sh", "shell", "zsh", "ksh"],
		wasm: "https://github.com/tree-sitter/tree-sitter-bash/releases/download/v0.25.1/tree-sitter-bash.wasm",
		queries: {
			highlights: ["https://raw.githubusercontent.com/tree-sitter/tree-sitter-bash/v0.25.1/queries/highlights.scm"],
		},
	},
])

const FOCUS_REPORTING_ENABLE = "\x1b[?1004h"
const FOCUS_REPORTING_DISABLE = "\x1b[?1004l"

const paletteDetector = createTerminalPalette(process.stdin, process.stdout)
const [terminalColors, { setSystemThemeColors }, { App }] = await Promise.all([
	paletteDetector.detect({ timeout: 150 }).catch(() => null).finally(() => paletteDetector.cleanup()),
	import("./ui/colors.js"),
	import("./App.js"),
])

if (terminalColors) {
	setSystemThemeColors(terminalColors)
}

const renderer = await createCliRenderer({
	exitOnCtrlC: false,
	screenMode: "alternate-screen",
	externalOutputMode: "passthrough",
	onDestroy: () => {
		process.stdout.write(FOCUS_REPORTING_DISABLE)
		process.exit(0)
	},
})

process.stdout.write(FOCUS_REPORTING_ENABLE)

const keymap = createDefaultOpenTuiKeymap(renderer)

// Allow plain whitespace-separated key sequences ("g g") without modifiers,
// filling the gap left by the default emacs-style parser which only treats
// space-separated input as a sequence when at least one stroke has a "+".
keymap.prependBindingParser(({ input, index, parseObjectKey }) => {
	if (index !== 0) return undefined
	const strokes = input.trim().split(/\s+/).filter(Boolean)
	if (strokes.length <= 1) return undefined
	if (strokes.some((stroke) => stroke.includes("+"))) return undefined
	return {
		parts: strokes.map((stroke) => parseObjectKey({ name: stroke.toLowerCase() })),
		nextIndex: input.length,
	}
})

createRoot(renderer).render(
	<RegistryProvider>
		<KeymapProvider keymap={keymap}>
			<App />
		</KeymapProvider>
	</RegistryProvider>,
)
