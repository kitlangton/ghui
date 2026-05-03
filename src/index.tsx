#!/usr/bin/env bun

import { addDefaultParsers, createCliRenderer } from "@opentui/core"
import { RegistryProvider } from "@effect/atom-react"
import { createRoot } from "@opentui/react"

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

const renderer = await createCliRenderer({
	exitOnCtrlC: false,
	screenMode: "alternate-screen",
	externalOutputMode: "passthrough",
	onDestroy: () => {
		process.stdout.write(FOCUS_REPORTING_DISABLE)
		process.exit(0)
	},
})

const [terminalColors, { setSystemThemeColors }, { App }] = await Promise.all([
	renderer.getPalette({ timeout: 150, size: 16 }).catch(() => null),
	import("./ui/colors.js"),
	import("./App.js"),
])

if (terminalColors) {
	setSystemThemeColors(terminalColors)
}

process.stdout.write(FOCUS_REPORTING_ENABLE)

createRoot(renderer).render(
	<RegistryProvider>
		<App />
	</RegistryProvider>,
)
