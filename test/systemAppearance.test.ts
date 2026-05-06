import { describe, expect, test } from "bun:test"
import { appearanceFromLinuxSetting } from "../src/systemAppearance.js"

describe("appearanceFromLinuxSetting", () => {
	test("detects GNOME dark preference", () => {
		expect(appearanceFromLinuxSetting("'prefer-dark'")).toBe("dark")
	})

	test("detects GNOME light/default preference", () => {
		expect(appearanceFromLinuxSetting("'prefer-light'")).toBe("light")
		expect(appearanceFromLinuxSetting("'default'")).toBe("light")
	})

	test("detects dark GTK themes", () => {
		expect(appearanceFromLinuxSetting("'Adwaita-dark'")).toBe("dark")
	})

	test("ignores unknown settings", () => {
		expect(appearanceFromLinuxSetting("")).toBeNull()
		expect(appearanceFromLinuxSetting("'Adwaita'")).toBeNull()
	})
})
