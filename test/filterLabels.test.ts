import { describe, expect, test } from "bun:test"
import { filterChangedFiles, filterLabels } from "../src/ui/modals.js"

const labels = [
	{ name: "bug", color: "#ff0000" },
	{ name: "Enhancement", color: "#00ff00" },
	{ name: "good first issue", color: null },
	{ name: "chore", color: null },
]

describe("filterLabels", () => {
	test("empty query returns all labels unchanged", () => {
		expect(filterLabels(labels, "")).toBe(labels)
		expect(filterLabels(labels, "   ")).toBe(labels)
	})

	test("substring match is case-insensitive", () => {
		expect(filterLabels(labels, "ENH")).toEqual([{ name: "Enhancement", color: "#00ff00" }])
	})

	test("returns empty when nothing matches", () => {
		expect(filterLabels(labels, "xyz")).toEqual([])
	})

	test("trims whitespace from query", () => {
		expect(filterLabels(labels, "  bug  ")).toEqual([{ name: "bug", color: "#ff0000" }])
	})

	test("matches multi-word labels", () => {
		expect(filterLabels(labels, "first")).toEqual([{ name: "good first issue", color: null }])
	})
})

const files = [
	{ name: "src/App.tsx", filetype: "tsx", patch: "diff --git a/src/App.tsx b/src/App.tsx\n@@ -1,1 +1,1 @@\n-old\n+new" },
	{ name: "test/reviewUx.test.ts", filetype: "ts", patch: "diff --git a/test/reviewUx.test.ts b/test/reviewUx.test.ts" },
	{ name: "README.md", filetype: "markdown", patch: "diff --git a/README.md b/README.md" },
]

const packageFiles = [
	{
		name: "packages/effect-drizzle-sqlite/src/index.ts",
		filetype: "ts",
		patch: "diff --git a/packages/effect-drizzle-sqlite/src/index.ts b/packages/effect-drizzle-sqlite/src/index.ts",
	},
	{
		name: "packages/effect-drizzle-sqlite/package.json",
		filetype: "json",
		patch: "diff --git a/packages/effect-drizzle-sqlite/package.json b/packages/effect-drizzle-sqlite/package.json",
	},
	{
		name: "packages/opencode/src/project/instance.ts",
		filetype: "ts",
		patch: "diff --git a/packages/opencode/src/project/instance.ts b/packages/opencode/src/project/instance.ts",
	},
	{ name: "packages/opencode/package.json", filetype: "json", patch: "diff --git a/packages/opencode/package.json b/packages/opencode/package.json" },
	{
		name: "packages/opencode/src/server/routes/instance/httpapi/server.ts",
		filetype: "ts",
		patch: "diff --git a/packages/opencode/src/server/routes/instance/httpapi/server.ts b/packages/opencode/src/server/routes/instance/httpapi/server.ts",
	},
]

describe("filterChangedFiles", () => {
	test("empty query returns files with original indexes", () => {
		expect(filterChangedFiles(files, "").map((entry) => entry.index)).toEqual([0, 1, 2])
	})

	test("path match is case-insensitive and keeps source index", () => {
		expect(filterChangedFiles(files, "REVIEW").map((entry) => ({ file: entry.file, index: entry.index }))).toEqual([{ file: files[1]!, index: 1 }])
	})

	test("trims whitespace from query", () => {
		expect(filterChangedFiles(files, "  readme  ").map((entry) => ({ file: entry.file, index: entry.index }))).toEqual([{ file: files[2]!, index: 2 }])
	})

	test("matches all query tokens across path segments", () => {
		expect(filterChangedFiles(packageFiles, "project instance").map((entry) => entry.file.name)).toEqual(["packages/opencode/src/project/instance.ts"])
	})

	test("ranks basename matches over the common packages prefix", () => {
		expect(
			filterChangedFiles(packageFiles, "package")
				.map((entry) => entry.file.name)
				.slice(0, 2),
		).toEqual(["packages/effect-drizzle-sqlite/package.json", "packages/opencode/package.json"])
	})

	test("fuzzy matches abbreviated tokens inside path segments", () => {
		expect(filterChangedFiles(packageFiles, "drz pkg").map((entry) => entry.file.name)[0]).toBe("packages/effect-drizzle-sqlite/package.json")
	})
})
