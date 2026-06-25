import { Effect } from "effect"
import * as Atom from "effect/unstable/reactivity/Atom"
import { githubRuntime } from "../services/runtime.js"
import { commandsById } from "./index.js"

// Dispatch a registered command by id. Lookup is O(1), gating is checked
// against `disabledReason` (a no-op if the command is currently disabled),
// then the command's `run` Effect is yielded inside the github runtime so it
// has access to GitHub/cache/observability services and the atom registry.
//
// Invoked from React via `useAtomSet(dispatchCommandAtom, { mode: "promise" })`.
// Unknown ids resolve quietly — the alternative is to make every keymap
// handler defensive about IDs that haven't been ported yet.

export const dispatchCommand = (id: string) =>
	Effect.gen(function* () {
		const command = commandsById.get(id)
		if (!command) return
		if (command.disabledReason) {
			const reason = yield* Atom.get(command.disabledReason)
			if (reason !== null) return
		}
		yield* command.run
	})

export const dispatchCommandAtom = githubRuntime.fn<string>()(dispatchCommand)
