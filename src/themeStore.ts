import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { Effect, Schema } from "effect"
import { isThemeId, type ThemeId } from "./ui/colors.js"
import { DiffWhitespaceMode } from "./ui/diff.js"

interface StoredConfig {
	readonly theme?: unknown
	readonly diffWhitespaceMode?: unknown
	readonly systemThemeAutoReload?: unknown
}

const configDirectory = () => {
	if (process.env.GHUI_CONFIG_DIR) return process.env.GHUI_CONFIG_DIR
	if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, "ghui")
	if (process.platform === "win32" && process.env.APPDATA) return join(process.env.APPDATA, "ghui")
	return join(homedir(), ".config", "ghui")
}

export const configPath = () => join(configDirectory(), "config.json")

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

export const saveStoredThemeId = (theme: ThemeId): Effect.Effect<void> =>
	Effect.tryPromise(async () => {
		const config = await readStoredConfig()
		if (config.theme === theme) return

		await writeStoredConfig({ ...config, theme })
	})

export const saveStoredDiffWhitespaceMode = (diffWhitespaceMode: DiffWhitespaceMode): Effect.Effect<void> =>
	Effect.tryPromise(async () => {
		const config = await readStoredConfig()
		if (config.diffWhitespaceMode === diffWhitespaceMode) return

		await writeStoredConfig({ ...config, diffWhitespaceMode })
	})
