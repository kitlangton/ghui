#!/usr/bin/env bun

import { addDefaultParsers, createCliRenderer } from "@opentui/core"
import { createRoot, useRenderer, useTerminalDimensions } from "@opentui/react"
import { Effect } from "effect"
import { useEffect, useState } from "react"
import { loadStoredSystemThemeAutoReload } from "./themeStore.js"
import { colors, setSystemThemeColors } from "./ui/colors.js"
import { LoadingLogoPane } from "./ui/LoadingLogo.js"
import { SPINNER_INTERVAL_MS } from "./ui/spinner.js"

process.env.OTUI_USE_ALTERNATE_SCREEN = "true"

const addGhUiParsers = () =>
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

type AppBundle = {
	readonly RegistryProvider: (typeof import("@effect/atom-react"))["RegistryProvider"]
	readonly App: (typeof import("./App.js"))["App"]
}

let notifySystemThemeReload = () => {}

const StartupLogo = () => {
	const startupRenderer = useRenderer()
	const { width, height } = useTerminalDimensions()
	const [frame, setFrame] = useState(0)

	useEffect(() => {
		startupRenderer.setBackgroundColor(colors.background)
	}, [startupRenderer])

	useEffect(() => {
		const interval = globalThis.setInterval(() => setFrame((current) => current + 1), SPINNER_INTERVAL_MS)
		return () => globalThis.clearInterval(interval)
	}, [])

	return (
		<box width={width} height={height} flexDirection="column" backgroundColor={colors.background}>
			<LoadingLogoPane content={{ hint: "Fetching latest open PRs" }} width={width} height={height} frame={frame} />
		</box>
	)
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

const reloadSystemThemeColors = async () => {
	renderer.clearPaletteCache()
	const terminalColors = await renderer.getPalette({ timeout: 150, size: 16 })
	setSystemThemeColors(terminalColors)
	renderer.setBackgroundColor(colors.background)
	notifySystemThemeReload()
}

const reloadSystemThemeColorsFromSignal = async () => {
	const systemThemeAutoReload = await Effect.runPromise(loadStoredSystemThemeAutoReload)
	if (!systemThemeAutoReload) return
	await reloadSystemThemeColors()
}

process.on("SIGUSR2", () => {
	void reloadSystemThemeColorsFromSignal().catch(() => {})
})

const Bootstrap = () => {
	const [appBundle, setAppBundle] = useState<AppBundle | null>(null)
	const [systemThemeGeneration, setSystemThemeGeneration] = useState(0)

	useEffect(() => {
		let cancelled = false
		notifySystemThemeReload = () => setSystemThemeGeneration((current) => current + 1)
		const timer = globalThis.setTimeout(() => {
			addGhUiParsers()

			const appBundlePromise = Promise.all([import("@effect/atom-react"), import("./App.js")])
			const palettePromise = reloadSystemThemeColors().catch(() => {})

			void Promise.all([appBundlePromise, palettePromise]).then(([[{ RegistryProvider }, { App }]]) => {
				if (cancelled) return
				setAppBundle({ RegistryProvider, App })
			})
		}, 0)

		return () => {
			cancelled = true
			notifySystemThemeReload = () => {}
			globalThis.clearTimeout(timer)
		}
	}, [])

	if (appBundle) {
		const { RegistryProvider, App } = appBundle
		return (
			<RegistryProvider>
				<App systemThemeGeneration={systemThemeGeneration} />
			</RegistryProvider>
		)
	}

	return <StartupLogo />
}

process.stdout.write(FOCUS_REPORTING_ENABLE)

createRoot(renderer).render(<Bootstrap />)
