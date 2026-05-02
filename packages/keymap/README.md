# @ghui/keymap

A small, opinionated keymap library. **Bindings are data**; **state is input**;
**dispatch is pure**.

```ts
import { defineCommand, scope, createDispatcher, parseKey } from "@ghui/keymap"

interface AppState {
	closeModalActive: boolean
	closeModal: () => void
	confirmClose: () => void
}

const closeModalCommands = scope<AppState>(
	(s) => s.closeModalActive,
	[
		defineCommand({
			id: "close-modal.cancel",
			title: "Cancel",
			keys: ["escape"],
			run: (s) => s.closeModal(),
		}),
		defineCommand({
			id: "close-modal.confirm",
			title: "Close pull request",
			keys: ["return"],
			run: (s) => s.confirmClose(),
		}),
	],
)

const dispatcher = createDispatcher(closeModalCommands, () => currentState)
dispatcher.dispatch(parseKey("escape"))  // → { kind: "ran", command: ... }
```

## Design

### Commands are values, not React side effects

```ts
const refresh = defineCommand({
	id: "pull.refresh",
	title: "Refresh pull requests",
	group: "Pull request",
	keys: ["r"],
	run: (state) => state.refresh(),
})
```

A `Command` is a plain object. Import it, log it, test it, render it in a
palette. No hook required to define one. The full set of bindings in your app
is just `Command[]` — statically introspectable.

### State is the activation predicate

Commands gate themselves with `when` and `enabled`, both pure functions of
state:

```ts
defineCommand({
	id: "pull.merge",
	keys: ["m"],
	enabled: (s) => s.selectedPullRequest ? true : "Select a pull request first.",
	run: (s) => s.merge(),
})
```

No subscriptions, no refs. State is read on demand at dispatch time.

### Sequences are first-class

Strokes are space-separated in a binding string:

```ts
keys: ["g g", "shift+g"]  // gg or G
```

Multi-stroke disambiguation is built in with vim-style timeout (default 500ms).
If `g` and `g g` are both bound and active, pressing `g` waits; a second `g`
runs the sequence; a non-matching key or timeout commits to `g`.

### One React hook

```tsx
const dispatcher = useKeymap(commands, state, subscribeToHostKeys)
const pending = usePendingSequence(dispatcher)
```

Pass commands, pass state, pass an input source. The hook reads fresh state on
every dispatch via a ref kept up to date for you. There is no "ref dance" the
caller has to remember.

## Non-goals

- Pluggable parsers, transformers, fields, or attrs — keep the surface small.
- Layered priorities. `when` predicates are how you scope. If two active
  commands collide on the same binding, the first registered wins.
- Async run handlers as a first-class feature. `run` may return a Promise; the
  dispatcher does not await it.
