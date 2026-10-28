import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { loadStoredEditorConfig, loadStoredRunLogView, loadStoredShowScrollbars, loadStoredSystemThemeAutoReload } from "../src/themeStore.js"

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
const loadShowScrollbars = () => Effect.runPromise(loadStoredShowScrollbars)
const loadRunLogView = () => Effect.runPromise(loadStoredRunLogView)

describe("loadStoredRunLogView", () => {
	test("defaults to browser", async () => {
		await useTempConfig()

		expect(await loadRunLogView()).toBe("browser")
	})

	test("reads the inline setting", async () => {
		await useTempConfig('{"runLogView":"inline"}')

		expect(await loadRunLogView()).toBe("inline")
	})

	test("falls back to browser for unknown values", async () => {
		await useTempConfig('{"runLogView":"popup"}')

		expect(await loadRunLogView()).toBe("browser")
	})
})

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

describe("loadStoredShowScrollbars", () => {
	test("defaults to hidden", async () => {
		await useTempConfig()

		expect(await loadShowScrollbars()).toBe(false)
	})

	test("shows scrollbars only when explicitly enabled", async () => {
		await useTempConfig('{"showScrollbars":true}')

		expect(await loadShowScrollbars()).toBe(true)
	})

	test("ignores non-boolean values", async () => {
		await useTempConfig('{"showScrollbars":"true"}')

		expect(await loadShowScrollbars()).toBe(false)
	})
})

const loadEditorConfig = () => Effect.runPromise(loadStoredEditorConfig)

describe("loadStoredEditorConfig", () => {
	test("defaults to no command and empty repoPaths", async () => {
		await useTempConfig()

		expect(await loadEditorConfig()).toEqual({ editorCommand: null, repoPaths: {} })
	})

	test("reads editorCommand and repoPaths", async () => {
		await useTempConfig('{"editorCommand":"nvim {{repoPath}}","repoPaths":{"dlvhdr/gh-dash":"~/code/gh-dash"}}')

		expect(await loadEditorConfig()).toEqual({ editorCommand: "nvim {{repoPath}}", repoPaths: { "dlvhdr/gh-dash": "~/code/gh-dash" } })
	})

	test("treats blank editorCommand as unset", async () => {
		await useTempConfig('{"editorCommand":"   "}')

		expect((await loadEditorConfig()).editorCommand).toBeNull()
	})

	test("drops non-string repoPaths entries", async () => {
		await useTempConfig('{"repoPaths":{"a/b":"/ok","c/d":123,"e/f":""}}')

		expect((await loadEditorConfig()).repoPaths).toEqual({ "a/b": "/ok" })
	})

	test("ignores a non-object repoPaths value", async () => {
		await useTempConfig('{"repoPaths":"nope"}')

		expect((await loadEditorConfig()).repoPaths).toEqual({})
	})
})
