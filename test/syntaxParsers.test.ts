import { pathToFiletype } from "@opentui/core"
import { describe, expect, test } from "bun:test"
import { syntaxParsers } from "../src/ui/syntaxParsers.js"

const registered = (filetype: string | undefined) => syntaxParsers.find((parser) => parser.filetype === filetype)

describe("syntaxParsers", () => {
	test.each(["run.sh", "main.go", "app.py", "package.json", "ci.yml", "config.yaml", "pyproject.toml"])("%s resolves to a registered parser", (path) => {
		expect(registered(pathToFiletype(path))).toBeDefined()
	})

	test("points at pinned tree-sitter release assets", () => {
		expect(registered("bash")).toEqual({
			filetype: "bash",
			aliases: ["sh", "shell", "zsh", "ksh"],
			wasm: "https://github.com/tree-sitter/tree-sitter-bash/releases/download/v0.25.1/tree-sitter-bash.wasm",
			queries: {
				highlights: ["https://raw.githubusercontent.com/tree-sitter/tree-sitter-bash/v0.25.1/queries/highlights.scm"],
			},
		})
	})
})
