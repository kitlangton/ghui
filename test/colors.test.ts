import { describe, expect, test } from "bun:test"
import { filterThemeDefinitions, pairedThemeId, themeToneForThemeId } from "../src/ui/colors.js"

describe("filterThemeDefinitions", () => {
	test("keeps dark and light themes in separate lists", () => {
		expect(filterThemeDefinitions("", "dark").map((theme) => theme.id)).toContain("ghui")
		expect(filterThemeDefinitions("", "dark").map((theme) => theme.id)).not.toContain("catppuccin-latte")
		expect(filterThemeDefinitions("", "light").map((theme) => theme.id)).toEqual([
			"catppuccin-latte",
			"rose-pine-dawn",
			"gruvbox-light",
			"one-light",
			"solarized-light",
			"ayu-light",
		])
	})

	test("filters only within the selected tone", () => {
		expect(filterThemeDefinitions("catppuccin", "dark").map((theme) => theme.id)).toEqual(["catppuccin", "catppuccin-frappe", "catppuccin-macchiato"])
		expect(filterThemeDefinitions("catppuccin", "light").map((theme) => theme.id)).toEqual(["catppuccin-latte"])
	})

	test("includes catppuccin frappe and macchiato in dark list", () => {
		expect(filterThemeDefinitions("frappe", "dark").map((theme) => theme.id)).toEqual(["catppuccin-frappe"])
		expect(filterThemeDefinitions("macchiato", "dark").map((theme) => theme.id)).toEqual(["catppuccin-macchiato"])
	})

	test("includes new ayu themes in correct tone lists", () => {
		expect(filterThemeDefinitions("", "dark").map((theme) => theme.id)).toContain("ayu")
		expect(filterThemeDefinitions("", "dark").map((theme) => theme.id)).toContain("ayu-mirage")
		expect(filterThemeDefinitions("", "light").map((theme) => theme.id)).toContain("ayu-light")
	})

	test("includes new themes in filtered results", () => {
		expect(filterThemeDefinitions("ayu", "dark").map((theme) => theme.id)).toEqual(["ayu", "ayu-mirage"])
		expect(filterThemeDefinitions("github", "dark").map((theme) => theme.id)).toContain("github-dark-dimmed")
		expect(filterThemeDefinitions("palenight", "dark").map((theme) => theme.id)).toEqual(["palenight"])
	})
})

describe("themeToneForThemeId", () => {
	test("identifies light theme variants", () => {
		expect(themeToneForThemeId("solarized-light")).toBe("light")
		expect(themeToneForThemeId("solarized-dark")).toBe("dark")
	})

	test("identifies new theme tones correctly", () => {
		expect(themeToneForThemeId("ayu")).toBe("dark")
		expect(themeToneForThemeId("ayu-mirage")).toBe("dark")
		expect(themeToneForThemeId("ayu-light")).toBe("light")
		expect(themeToneForThemeId("github-dark-dimmed")).toBe("dark")
		expect(themeToneForThemeId("palenight")).toBe("dark")
	})

	test("identifies catppuccin frappe and macchiato as dark tones", () => {
		expect(themeToneForThemeId("catppuccin-frappe")).toBe("dark")
		expect(themeToneForThemeId("catppuccin-macchiato")).toBe("dark")
	})
})

describe("pairedThemeId", () => {
	test("returns the matching light or dark variant when one exists", () => {
		expect(pairedThemeId("catppuccin", "light")).toBe("catppuccin-latte")
		expect(pairedThemeId("catppuccin-latte", "dark")).toBe("catppuccin")
		expect(pairedThemeId("ghui", "light")).toBeNull()
	})

	test("pairs ayu themes correctly", () => {
		expect(pairedThemeId("ayu", "light")).toBe("ayu-light")
		expect(pairedThemeId("ayu-mirage", "light")).toBe("ayu-light")
		expect(pairedThemeId("ayu-light", "dark")).toBe("ayu")
	})

	test("pairs catppuccin frappe and macchiato with latte", () => {
		expect(pairedThemeId("catppuccin-frappe", "light")).toBe("catppuccin-latte")
		expect(pairedThemeId("catppuccin-macchiato", "light")).toBe("catppuccin-latte")
	})

	test("returns null for unpaired dark themes", () => {
		expect(pairedThemeId("github-dark-dimmed", "light")).toBeNull()
		expect(pairedThemeId("palenight", "light")).toBeNull()
	})
})
