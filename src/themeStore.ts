import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { Effect, Schema } from "effect"
import { isThemeId, type ThemeId } from "./ui/colors.js"
import { normalizeThemeConfig, type ThemeConfig } from "./themeConfig.js"
import { DiffWhitespaceMode } from "./ui/diff.js"

interface StoredConfig {
	readonly theme?: unknown
	readonly themeMode?: unknown
	readonly darkTheme?: unknown
	readonly lightTheme?: unknown
	readonly diffWhitespaceMode?: unknown
	readonly systemThemeAutoReload?: unknown
	readonly showScrollbars?: unknown
	readonly editorCommand?: unknown
	readonly repoPaths?: unknown
}

const configDirectory = () => {
	if (process.env.GHUI_CONFIG_DIR) return process.env.GHUI_CONFIG_DIR
	if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, "ghui")
	if (process.platform === "win32" && process.env.APPDATA) return join(process.env.APPDATA, "ghui")
	return join(homedir(), ".config", "ghui")
}

export const configPath = () => join(configDirectory(), "config.json")

const launchThemeOverride = (): ThemeId | null => {
	const theme = process.env.GHUI_THEME?.trim()
	return isThemeId(theme) ? theme : null
}

const parseConfig = (text: string): StoredConfig => {
	const value = JSON.parse(text) as unknown
	return value && typeof value === "object" ? value : {}
}

const readStoredConfig = async () => {
	const file = Bun.file(configPath())
	return (await file.exists()) ? parseConfig(await file.text()) : {}
}

const writeStoredConfig = async (config: StoredConfig) => {
	const path = configPath()
	await mkdir(dirname(path), { recursive: true })
	await Bun.write(path, `${JSON.stringify(config, null, "\t")}\n`)
}

export const loadStoredThemeId: Effect.Effect<ThemeId> = Effect.catchCause(
	Effect.tryPromise(async () => {
		const config = await readStoredConfig()
		return isThemeId(config.theme) ? config.theme : "ghui"
	}),
	() => Effect.succeed("ghui" satisfies ThemeId),
)

export const loadStoredThemeConfig: Effect.Effect<ThemeConfig> = Effect.catchCause(
	Effect.tryPromise(async () => {
		const override = launchThemeOverride()
		return override ? { mode: "fixed", theme: override } : normalizeThemeConfig(await readStoredConfig())
	}),
	() => Effect.succeed(normalizeThemeConfig({})),
)

export const loadStoredDiffWhitespaceMode: Effect.Effect<DiffWhitespaceMode> = Effect.catchCause(
	Effect.tryPromise(async () => {
		const config = await readStoredConfig()
		return Schema.is(DiffWhitespaceMode)(config.diffWhitespaceMode) ? config.diffWhitespaceMode : "ignore"
	}),
	() => Effect.succeed("ignore" satisfies DiffWhitespaceMode),
)

export const loadStoredSystemThemeAutoReload: Effect.Effect<boolean> = Effect.catchCause(
	Effect.tryPromise(async () => {
		const config = await readStoredConfig()
		return typeof config.systemThemeAutoReload === "boolean" ? config.systemThemeAutoReload : false
	}),
	() => Effect.succeed(false),
)

export const loadStoredShowScrollbars: Effect.Effect<boolean> = Effect.catchCause(
	Effect.tryPromise(async () => {
		const config = await readStoredConfig()
		return typeof config.showScrollbars === "boolean" ? config.showScrollbars : false
	}),
	() => Effect.succeed(false),
)

export interface StoredEditorConfig {
	readonly editorCommand: string | null
	readonly repoPaths: Readonly<Record<string, string>>
}

const parseRepoPaths = (value: unknown): Readonly<Record<string, string>> => {
	if (!value || typeof value !== "object") return {}
	const entries = Object.entries(value as Record<string, unknown>).filter(([, path]) => typeof path === "string" && path.length > 0) as [string, string][]
	return Object.fromEntries(entries)
}

export const loadStoredEditorConfig: Effect.Effect<StoredEditorConfig> = Effect.catchCause(
	Effect.tryPromise(async () => {
		const config = await readStoredConfig()
		const editorCommand = typeof config.editorCommand === "string" && config.editorCommand.trim().length > 0 ? config.editorCommand : null
		return { editorCommand, repoPaths: parseRepoPaths(config.repoPaths) }
	}),
	() => Effect.succeed({ editorCommand: null, repoPaths: {} } satisfies StoredEditorConfig),
)

export const saveStoredThemeId = (theme: ThemeId): Effect.Effect<void> =>
	Effect.tryPromise(async () => {
		const config = await readStoredConfig()
		if (config.themeMode !== "system" && config.theme === theme) return

		await writeStoredConfig({ ...config, themeMode: "fixed", theme })
	})

export const saveStoredThemeConfig = (themeConfig: ThemeConfig): Effect.Effect<void> =>
	Effect.tryPromise(async () => {
		const config = await readStoredConfig()
		const nextConfig =
			themeConfig.mode === "fixed"
				? { ...config, themeMode: "fixed", theme: themeConfig.theme }
				: {
						...config,
						themeMode: "system",
						darkTheme: themeConfig.darkTheme,
						lightTheme: themeConfig.lightTheme,
					}

		await writeStoredConfig(nextConfig)
	})

export const saveStoredDiffWhitespaceMode = (diffWhitespaceMode: DiffWhitespaceMode): Effect.Effect<void> =>
	Effect.tryPromise(async () => {
		const config = await readStoredConfig()
		if (config.diffWhitespaceMode === diffWhitespaceMode) return

		await writeStoredConfig({ ...config, diffWhitespaceMode })
	})
