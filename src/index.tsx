#!/usr/bin/env bun

import { addDefaultParsers, createCliRenderer, createTerminalPalette } from "@opentui/core"
import { RegistryProvider } from "@effect/atom-react"
import { createRoot } from "@opentui/react"
import { KeymapProvider } from "@opentui/keymap/react"
import { createKeymap } from "./keyboard/createKeymap.js"

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

const keymap = createKeymap(renderer)

createRoot(renderer).render(
	<RegistryProvider>
		<KeymapProvider keymap={keymap}>
			<App />
		</KeymapProvider>
	</RegistryProvider>,
)
