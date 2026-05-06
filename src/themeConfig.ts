import { filterThemeDefinitions, isThemeId, pairedThemeId, themeToneForThemeId, type ThemeId, type ThemeTone } from "./ui/colors.js"

export type ThemeMode = "fixed" | "system"

export type ThemeConfig = { readonly mode: "fixed"; readonly theme: ThemeId } | { readonly mode: "system"; readonly darkTheme: ThemeId; readonly lightTheme: ThemeId }

export interface StoredThemeConfigInput {
	readonly theme?: unknown
	readonly themeMode?: unknown
	readonly darkTheme?: unknown
	readonly lightTheme?: unknown
}

const defaultDarkThemeId = "ghui" satisfies ThemeId
const defaultLightThemeId = "catppuccin-latte" satisfies ThemeId

export const defaultThemeConfig: ThemeConfig = { mode: "fixed", theme: defaultDarkThemeId }

const firstThemeForTone = (tone: ThemeTone) => filterThemeDefinitions("", tone)[0]?.id

export const fallbackThemeForTone = (sourceTheme: ThemeId, tone: ThemeTone): ThemeId => {
	if (themeToneForThemeId(sourceTheme) === tone) return sourceTheme
	return pairedThemeId(sourceTheme, tone) ?? firstThemeForTone(tone) ?? (tone === "dark" ? defaultDarkThemeId : defaultLightThemeId)
}

const storedThemeId = (value: unknown, fallback: ThemeId) => (isThemeId(value) ? value : fallback)

const storedThemeIdForTone = (value: unknown, tone: ThemeTone, fallback: ThemeId) => {
	const id = storedThemeId(value, fallback)
	return themeToneForThemeId(id) === tone ? id : fallback
}

export const normalizeThemeConfig = (config: StoredThemeConfigInput): ThemeConfig => {
	const fixedTheme = storedThemeId(config.theme, defaultDarkThemeId)
	if (config.themeMode !== "system") return { mode: "fixed", theme: fixedTheme }

	const darkFallback = fallbackThemeForTone(fixedTheme, "dark")
	const lightFallback = fallbackThemeForTone(fixedTheme, "light")
	return {
		mode: "system",
		darkTheme: storedThemeIdForTone(config.darkTheme, "dark", darkFallback),
		lightTheme: storedThemeIdForTone(config.lightTheme, "light", lightFallback),
	}
}

export const resolveThemeId = (config: ThemeConfig, appearance: ThemeTone): ThemeId =>
	config.mode === "fixed" ? config.theme : appearance === "dark" ? config.darkTheme : config.lightTheme

export const themeConfigWithSelection = (config: ThemeConfig, theme: ThemeId, tone: ThemeTone): ThemeConfig => {
	if (config.mode === "fixed") return { mode: "fixed", theme }
	return tone === "dark" ? { ...config, darkTheme: theme } : { ...config, lightTheme: theme }
}

export const fixedThemeConfig = (theme: ThemeId): ThemeConfig => ({ mode: "fixed", theme })

export const systemThemeConfig = (darkTheme: ThemeId, lightTheme: ThemeId): ThemeConfig => ({ mode: "system", darkTheme, lightTheme })

export const systemThemeConfigForTheme = (theme: ThemeId): Extract<ThemeConfig, { readonly mode: "system" }> => ({
	mode: "system",
	darkTheme: fallbackThemeForTone(theme, "dark"),
	lightTheme: fallbackThemeForTone(theme, "light"),
})
