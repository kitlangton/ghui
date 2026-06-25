import { describe, expect, test } from "bun:test"
import { invokeHandoff, registerHandoff } from "../src/commands/handoffs.ts"
import { runIsolatedProbe } from "./isolatedProbe.ts"

describe("command runtime", () => {
	test("an actual workspace command resets cross-view state", async () => {
		const probe = `
			import { Effect } from "effect"
			import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
			import { dispatchCommand } from "./src/commands/dispatch.ts"
			import { commentsViewActiveAtom } from "./src/ui/comments/atoms.ts"
			import { detailFullViewAtom } from "./src/ui/detail/atoms.ts"
			import { diffCommentRangeStartIndexAtom, diffFullViewAtom } from "./src/ui/diff/atoms.ts"
			import { filterModeAtom } from "./src/ui/filter/atoms.ts"
			import { workspaceSurfaceAtom } from "./src/workspace/atoms.ts"
			const registry = AtomRegistry.make()
			registry.set(detailFullViewAtom, true)
			registry.set(diffFullViewAtom, true)
			registry.set(commentsViewActiveAtom, true)
			registry.set(diffCommentRangeStartIndexAtom, 4)
			registry.set(filterModeAtom, true)
			await Effect.runPromise(dispatchCommand("workspace.issues").pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry)))
			const first = { surface: registry.get(workspaceSurfaceAtom), detail: registry.get(detailFullViewAtom), diff: registry.get(diffFullViewAtom), comments: registry.get(commentsViewActiveAtom), range: registry.get(diffCommentRangeStartIndexAtom), filter: registry.get(filterModeAtom) }
			registry.set(detailFullViewAtom, true)
			await Effect.runPromise(dispatchCommand("workspace.issues").pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry)))
			console.log(JSON.stringify({ first, disabledDetail: registry.get(detailFullViewAtom) }))
		`
		const stdout = await runIsolatedProbe(probe)
		expect(JSON.parse(stdout)).toEqual({
			first: { surface: "issues", detail: false, diff: false, comments: false, range: null, filter: false },
			disabledDetail: true,
		})
	})

	test("handoff cleanup cannot remove a newer registration", () => {
		const calls: string[] = []
		const cleanFirst = registerHandoff("quit", () => calls.push("first"))
		const cleanSecond = registerHandoff("quit", () => calls.push("second"))

		cleanFirst()
		invokeHandoff("quit")
		cleanSecond()
		invokeHandoff("quit")

		expect(calls).toEqual(["second"])
	})
})
