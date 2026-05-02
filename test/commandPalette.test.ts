import { describe, expect, test } from "bun:test"
import type { AppCommand, CommandScope } from "../src/commands.ts"
import { buildCommandPaletteRows, commandPaletteScrollTop, commandPaletteSelectedRowIndex } from "../src/ui/CommandPalette.tsx"

const command = (id: string, scope: CommandScope): AppCommand => ({
	id,
	scope,
	title: id,
	run: () => {},
})

const commandIds = (rows: ReturnType<typeof buildCommandPaletteRows>) =>
	rows.flatMap((row) => row._tag === "command" ? [row.command.id] : [])

describe("command palette rows", () => {
	test("preserve filtered command order instead of regrouping by scope", () => {
		const commands = [
			command("open-diff", "Diff"),
			command("open-repository", "View"),
			command("open-browser", "Pull request"),
			command("refresh", "Global"),
		]

		const rows = buildCommandPaletteRows(commands)

		expect(commandIds(rows)).toEqual(commands.map((item) => item.id))
		// Each scope change inserts a spacer + section before the command, except the first.
		// rows: [section, open-diff, spacer, section, open-repository, spacer, section, open-browser, spacer, section, refresh]
		// command positions: 1, 4, 7, 10
		expect(commands.map((_, index) => commandPaletteSelectedRowIndex(rows, index))).toEqual([1, 4, 7, 10])
	})

	test("only inserts a new section when the visible command scope changes", () => {
		const rows = buildCommandPaletteRows([
			command("refresh", "Global"),
			command("filter", "Global"),
			command("repository", "View"),
			command("authored", "View"),
		])

		const tag = (row: typeof rows[number]) => {
			if (row._tag === "section") return `section:${row.scope}`
			if (row._tag === "spacer") return "spacer"
			return row.command.id
		}
		expect(rows.map(tag)).toEqual([
			"section:Global",
			"refresh",
			"filter",
			"spacer",
			"section:View",
			"repository",
			"authored",
		])
	})
})

describe("command palette scroll", () => {
	test("scrolls just enough to keep the selected row visible", () => {
		expect(commandPaletteScrollTop({ current: 0, rowsLength: 20, listHeight: 5, selectedRowIndex: 0 })).toBe(0)
		expect(commandPaletteScrollTop({ current: 0, rowsLength: 20, listHeight: 5, selectedRowIndex: 4 })).toBe(0)
		expect(commandPaletteScrollTop({ current: 0, rowsLength: 20, listHeight: 5, selectedRowIndex: 5 })).toBe(1)
		expect(commandPaletteScrollTop({ current: 8, rowsLength: 20, listHeight: 5, selectedRowIndex: 7 })).toBe(7)
	})

	test("clamps stale scroll positions after filtering shrinks the list", () => {
		expect(commandPaletteScrollTop({ current: 40, rowsLength: 8, listHeight: 5, selectedRowIndex: 4 })).toBe(3)
		expect(commandPaletteScrollTop({ current: 40, rowsLength: 4, listHeight: 5, selectedRowIndex: 0 })).toBe(0)
	})
})
