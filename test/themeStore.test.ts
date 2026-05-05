import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { loadStoredSystemThemeAutoReload } from "../src/themeStore.js"

const originalConfigDir = process.env.GHUI_CONFIG_DIR
const tempDirs: string[] = []

const restoreConfigDir = () => {
	if (originalConfigDir === undefined) {
		delete process.env.GHUI_CONFIG_DIR
	} else {
		process.env.GHUI_CONFIG_DIR = originalConfigDir
	}
}

afterEach(async () => {
	restoreConfigDir()
	await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
	tempDirs.length = 0
})

const useTempConfig = async (content?: string) => {
	const dir = await mkdtemp(join(tmpdir(), "ghui-theme-store-"))
	tempDirs.push(dir)
	process.env.GHUI_CONFIG_DIR = dir
	if (content !== undefined) await writeFile(join(dir, "config.json"), content)
}

const loadSystemThemeAutoReload = () => Effect.runPromise(loadStoredSystemThemeAutoReload)

describe("loadStoredSystemThemeAutoReload", () => {
	test("defaults to disabled", async () => {
		await useTempConfig()

		expect(await loadSystemThemeAutoReload()).toBe(false)
	})

	test("reads an enabled setting", async () => {
		await useTempConfig('{"systemThemeAutoReload":true}')

		expect(await loadSystemThemeAutoReload()).toBe(true)
	})

	test("reads a disabled setting", async () => {
		await useTempConfig('{"systemThemeAutoReload":false}')

		expect(await loadSystemThemeAutoReload()).toBe(false)
	})

	test("ignores non-boolean values", async () => {
		await useTempConfig('{"systemThemeAutoReload":"true"}')

		expect(await loadSystemThemeAutoReload()).toBe(false)
	})
})
