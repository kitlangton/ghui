import { describe, expect, test } from "bun:test"
import { workspaceScopeForRepository, workspaceScopeRepository } from "../src/workspaceScope.ts"
import { runIsolatedProbe } from "./isolatedProbe.ts"

describe("Workspace Scope", () => {
	test("represents User and Repository scope explicitly", () => {
		expect(workspaceScopeRepository(workspaceScopeForRepository(null))).toBeNull()
		expect(workspaceScopeRepository(workspaceScopeForRepository("kitlangton/ghui"))).toBe("kitlangton/ghui")
	})

	test("owns repository selection and reachable Surface tabs", async () => {
		// Application atoms bind their runtime at import time. Isolate this graph
		// so importing workspace atoms cannot select the live runtime before the
		// terminal-render suite installs its mock environment.
		const probe = `
			import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
			import { activeViewAtom } from "./src/ui/pullRequests/atoms.ts"
			import { selectedRepositoryAtom, workspaceScopeAtom, workspaceTabSurfacesAtom } from "./src/workspace/atoms.ts"
			import { workspaceScopeForRepository } from "./src/workspaceScope.ts"
			const registry = AtomRegistry.make()
			registry.set(activeViewAtom, { _tag: "Repository", repository: "ignored/pull-request-view" })
			const user = [registry.get(selectedRepositoryAtom), registry.get(workspaceTabSurfacesAtom)]
			registry.set(workspaceScopeAtom, workspaceScopeForRepository("kitlangton/ghui"))
			const repository = [registry.get(selectedRepositoryAtom), registry.get(workspaceTabSurfacesAtom)]
			console.log(JSON.stringify({ user, repository }))
		`
		const stdout = await runIsolatedProbe(probe)
		expect(JSON.parse(stdout)).toEqual({
			user: [null, ["repos", "pullRequests", "issues"]],
			repository: ["kitlangton/ghui", ["pullRequests", "issues"]],
		})
	})
})
