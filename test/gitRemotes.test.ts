import { describe, expect, test } from "bun:test"
import { detectGitHubRemotes, parseGitRemoteUrl } from "../src/gitRemotes.js"

describe("parseGitRemoteUrl", () => {
	test("parses https github url", () => {
		expect(parseGitRemoteUrl("https://github.com/kitlangton/ghui.git")).toBe("kitlangton/ghui")
	})

	test("parses https github url without .git", () => {
		expect(parseGitRemoteUrl("https://github.com/kitlangton/ghui")).toBe("kitlangton/ghui")
	})

	test("parses ssh github url", () => {
		expect(parseGitRemoteUrl("git@github.com:kitlangton/ghui.git")).toBe("kitlangton/ghui")
	})

	test("parses ssh github url without .git", () => {
		expect(parseGitRemoteUrl("git@github.com:kitlangton/ghui")).toBe("kitlangton/ghui")
	})

	test("returns null for non-github url", () => {
		expect(parseGitRemoteUrl("https://gitlab.com/kitlangton/ghui.git")).toBeNull()
	})

	test("returns null for ssh non-github url", () => {
		expect(parseGitRemoteUrl("git@gitlab.com:kitlangton/ghui.git")).toBeNull()
	})
})

describe("detectGitHubRemotes", () => {
	test("returns empty array when not in a git repo", async () => {
		const originalCwd = process.cwd()
		process.chdir("/tmp")
		try {
			const remotes = await detectGitHubRemotes()
			expect(remotes).toEqual([])
		} finally {
			process.chdir(originalCwd)
		}
	})

	test("returns remotes from current repo", async () => {
		const remotes = await detectGitHubRemotes()
		// This test runs inside the ghui repo which is on GitHub
		expect(remotes.length).toBeGreaterThan(0)
		expect(remotes[0]).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
	})
})
