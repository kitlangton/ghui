import { describe, expect, test } from "bun:test"
import { normalizeThemeConfig, resolveThemeId, systemThemeConfigForTheme, themeConfigWithSelection } from "../src/themeConfig.js"

describe("normalizeThemeConfig", () => {
	test("keeps existing fixed theme config as the default", () => {
		expect(normalizeThemeConfig({ theme: "catppuccin" })).toEqual({ mode: "fixed", theme: "catppuccin" })
	})

	test("builds follow-system config with dark and light themes", () => {
		expect(normalizeThemeConfig({ themeMode: "system", darkTheme: "catppuccin", lightTheme: "catppuccin-latte" })).toEqual({
			mode: "system",
			darkTheme: "catppuccin",
			lightTheme: "catppuccin-latte",
		})
	})

	test("falls back to paired themes for invalid system entries", () => {
		expect(normalizeThemeConfig({ themeMode: "system", theme: "solarized-dark", darkTheme: "solarized-light", lightTheme: "missing" })).toEqual({
			mode: "system",
			darkTheme: "solarized-dark",
			lightTheme: "solarized-light",
		})
	})
})

describe("resolveThemeId", () => {
	test("resolves fixed theme irrespective of appearance", () => {
		const config = { mode: "fixed", theme: "rose-pine" } as const
		expect(resolveThemeId(config, "dark")).toBe("rose-pine")
		expect(resolveThemeId(config, "light")).toBe("rose-pine")
	})

	test("resolves system theme by appearance", () => {
		const config = { mode: "system", darkTheme: "rose-pine", lightTheme: "rose-pine-dawn" } as const
		expect(resolveThemeId(config, "dark")).toBe("rose-pine")
		expect(resolveThemeId(config, "light")).toBe("rose-pine-dawn")
	})
})

describe("themeConfigWithSelection", () => {
	test("updates the selected system tone only", () => {
		expect(themeConfigWithSelection({ mode: "system", darkTheme: "ghui", lightTheme: "catppuccin-latte" }, "rose-pine-dawn", "light")).toEqual({
			mode: "system",
			darkTheme: "ghui",
			lightTheme: "rose-pine-dawn",
		})
	})

	test("creates a paired system config from one fixed theme", () => {
		expect(systemThemeConfigForTheme("gruvbox")).toEqual({ mode: "system", darkTheme: "gruvbox", lightTheme: "gruvbox-light" })
	})
})
