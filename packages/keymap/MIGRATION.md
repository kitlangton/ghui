# Migration sketch — ghui using @ghui/keymap

A concrete before/after for ghui's modal + global layers. Demonstrates that the
library's primary value is _organizational_: bindings move out of the component
into typed, importable values; state is a single shape passed in once.

## Before — what ghui ships today

`src/App.tsx` gathers state + actions inside the component, then issues 9
`useScopedBindings` calls peppered through the body. Each layer's bindings are
inline closures over component-local state. To answer "what does `r` do" the
reader greps; to answer "list every binding" they can't.

```tsx
const App = () => {
  // ... 80 lines of useState, useAtom, derived selectors ...

  useScopedBindings({
    when: closeModalActive,
    bindings: {
      escape: closeActiveModal,
      return: confirmClosePullRequest,
    },
  })

  useScopedBindings({
    when: globalLayerActive,
    bindings: {
      "/": "filter.open",
      r: "pull.refresh",
      // ... 30 more entries ...
    },
  })

  // ... 7 more useScopedBindings calls ...

  // ... 200 lines of JSX ...
}
```

This works (it's what we just shipped) but the bindings live inside the
component's render function. They can't be tested without React, can't be
imported by a palette, and their gating conditions are scattered.

## After — using @ghui/keymap

Bindings become an importable value. State becomes a single shape passed once.
The component is JSX + state + one `useKeymap` call.

```ts
// src/keymap/state.ts — the shape, declared once
export interface AppState {
  closeModalActive: boolean
  diffFullView: boolean
  diffCommentMode: boolean
  selectedPullRequest: PullRequest | null
  closeActiveModal: () => void
  confirmClosePullRequest: () => void
  refresh: () => void
  scrollDiffBy: (delta: number) => void
  // ... etc
}
```

```ts
// src/keymap/closeModal.ts
import { defineCommand, scope } from "@ghui/keymap"
import type { AppState } from "./state.ts"

export const closeModalCommands = scope<AppState>(
  (s) => s.closeModalActive,
  [
    defineCommand({
      id: "close-modal.cancel",
      title: "Cancel",
      keys: ["escape"],
      run: (s) => s.closeActiveModal(),
    }),
    defineCommand({
      id: "close-modal.confirm",
      title: "Close pull request",
      keys: ["return"],
      run: (s) => s.confirmClosePullRequest(),
    }),
  ],
)
```

```ts
// src/keymap/diffView.ts
import { defineCommand, scope } from "@ghui/keymap"

const scrollBindings = (axis: "diff" | "detail"): readonly Command<AppState>[] => [
  defineCommand({ id: `${axis}.up`, title: "Scroll up", keys: ["k", "up"], run: (s) => s.scrollDiffBy(-1) }),
  defineCommand({ id: `${axis}.down`, title: "Scroll down", keys: ["j", "down"], run: (s) => s.scrollDiffBy(1) }),
  defineCommand({ id: `${axis}.top`, title: "Top", keys: ["g g"], run: (s) => s.scrollDiffTo(0) }),
  defineCommand({ id: `${axis}.bottom`, title: "Bottom", keys: ["shift+g"], run: (s) => s.scrollDiffTo(Number.MAX_SAFE_INTEGER) }),
  // ...
]

export const diffViewCommands = scope<AppState>(
  (s) => s.diffFullView && !s.diffCommentMode,
  [
    ...scrollBindings("diff"),
    defineCommand({ id: "diff.close", title: "Close diff", keys: ["escape", "return"], run: (s) => s.closeDiff() }),
    // ...
  ],
)
```

```ts
// src/keymap/all.ts
import { closeModalCommands } from "./closeModal.ts"
import { diffViewCommands } from "./diffView.ts"
// ... others ...

export const allCommands = [
  ...closeModalCommands,
  ...diffViewCommands,
  // ...
]
```

```tsx
// src/App.tsx
import { useKeymap } from "@ghui/keymap/react"
import { allCommands } from "./keymap/all.ts"

const App = () => {
  // ... existing useState / useAtom ...

  const state: AppState = {
    closeModalActive,
    diffFullView,
    diffCommentMode,
    selectedPullRequest,
    closeActiveModal,
    confirmClosePullRequest,
    refresh,
    scrollDiffBy,
    // ... etc
  }

  useKeymap(allCommands, state, subscribeToOpenTuiKeys)

  // ... JSX ...
}
```

## What this buys

- **One source of truth.** `allCommands` is the entire keyboard surface of the
  app. Import it anywhere. Render a "what's bound right now" view in two lines:
  `getActiveCommands(allCommands, state).map(c => <li>{c.title}</li>)`.
- **Tests without React.** The dispatcher tests (`createDispatcher` + state)
  exercise binding behavior without mounting any UI.
- **Typed command IDs.** `Command<AppState>['id']` is `string`, but each
  command is a typed value — referencing `closeModalCommands[0]!.id` typechecks
  and renames cleanly.
- **No ref dance, no `useRef`/`useEffect` in user code.** State is an argument.
  Closures inside `run` are always fresh because state is read at dispatch time.
- **Sequence semantics, no parser surprise.** `keys: ["g g"]` is multi-stroke;
  vim-style timeout disambiguation is built in.

## What this trades

- **One big state shape.** Action callbacks that previously closed over
  component-local state now have to be put into the `state` object. If your app
  uses Zustand / Redux / Atom, this falls out naturally; if everything's
  `useState`, it's busywork.
- **Less power per layer.** No priority numbers, no fields, no transformers. If
  you need those, this isn't the library.
- **No focus-scoped bindings yet.** Every command sees every key. You'd add a
  `focusTarget` or similar if you wanted DOM/Renderable-level scoping.
