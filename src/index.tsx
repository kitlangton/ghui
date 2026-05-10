#!/usr/bin/env bun

import { addDefaultParsers, createCliRenderer } from "@opentui/core"
import { createRoot, useRenderer, useTerminalDimensions } from "@opentui/react"
import { Effect } from "effect"
import { useEffect, useState } from "react"
import { loadStoredSystemThemeAutoReload } from "./themeStore.js"
import { colors, isHexColor, setSystemThemeColors } from "./ui/colors.js"
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
let signalTimer: ReturnType<typeof globalThis.setTimeout> | null = null
let reloadToken = 0

const SYSTEM_THEME_SIGNAL_DELAY_MS = 150
const SYSTEM_THEME_RETRY_DELAYS_MS = [150, 300] as const

const hasCompleteTerminalPalette = (terminalColors: {
	readonly palette: readonly (string | null)[]
	readonly defaultForeground: string | null
	readonly defaultBackground: string | null
}) =>
	isHexColor(terminalColors.defaultForeground) &&
	isHexColor(terminalColors.defaultBackground) &&
	terminalColors.palette.length >= 16 &&
	terminalColors.palette.slice(0, 16).every(isHexColor)

const sleep = (delayMs: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs))

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

const readSystemThemeColors = () => {
	renderer.clearPaletteCache()
	return renderer.getPalette({ timeout: 150, size: 16 })
}

const readThemeColorsAfterRetries = async () => {
	let palette: Awaited<ReturnType<typeof readSystemThemeColors>> | null = null

	const readNext = async () => {
		const terminalColors = await readSystemThemeColors()
		if (hasCompleteTerminalPalette(terminalColors)) palette = terminalColors
	}

	await readNext()
	for (const delayMs of SYSTEM_THEME_RETRY_DELAYS_MS) {
		await sleep(delayMs)
		await readNext()
	}

	return palette
}

const reloadSystemThemeColors = async () => {
	const terminalColors = await readSystemThemeColors()
	setSystemThemeColors(terminalColors)
	renderer.setBackgroundColor(colors.background)
	notifySystemThemeReload()
}

const reloadSystemThemeColorsFromSignal = async (token: number) => {
	const systemThemeAutoReload = await Effect.runPromise(loadStoredSystemThemeAutoReload)
	if (token !== reloadToken) return
	if (!systemThemeAutoReload) return
	const terminalColors = await readThemeColorsAfterRetries()
	if (token !== reloadToken) return
	if (terminalColors === null) return
	setSystemThemeColors(terminalColors)
	renderer.setBackgroundColor(colors.background)
	notifySystemThemeReload()
}

process.on("SIGUSR2", () => {
	reloadToken += 1
	const token = reloadToken
	if (signalTimer !== null) globalThis.clearTimeout(signalTimer)
	signalTimer = globalThis.setTimeout(() => {
		signalTimer = null
		void reloadSystemThemeColorsFromSignal(token).catch(() => {})
	}, SYSTEM_THEME_SIGNAL_DELAY_MS)
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
