# @ghui/keymap

A small, opinionated keymap library where **bindings are values you compose**,
not React side effects scattered across your tree.

```ts
import { command, createDispatcher, Keymap, parseKey } from "@ghui/keymap"

interface DiffState {
	scrollBy: (delta: number) => void
}

const diffKeymap: Keymap<DiffState> = Keymap.union(
	command({ id: "diff.up",   title: "Up",   keys: ["k", "up"],   run: (s) => s.scrollBy(-1) }),
	command({ id: "diff.down", title: "Down", keys: ["j", "down"], run: (s) => s.scrollBy(1) }),
	command({ id: "diff.top",  title: "Top",  keys: ["g g"],       run: (s) => s.scrollBy(-Infinity) }),
)

// Lift the diff keymap into your app's wider context:
interface AppCtx { view: "list" | "diff"; diff: DiffState }
const appKeymap: Keymap<AppCtx> = diffKeymap.contramapMaybe(
	(app) => app.view === "diff" ? app.diff : null
)
```

## Why this shape

The unit of authoring is `Keymap<C>`. It is:

- **A monoid under `union`.** Two keymaps over the same context combine. `Keymap.empty<C>()` is identity. Associative.
- **Contravariant in `C`.** Sub-keymaps over narrow contexts lift into wider ones via `contramap` and `contramapMaybe`. The diff keymap above doesn't know about `AppCtx`; the app composes it in via a projection.
- **Restrictable.** `restrict(predicate)` AND-merges into every binding's `when`. Compose narrow scopes from broader ones.
- **Prefixable.** `prefix("space")` prepends a stroke to every binding — leader keys for free.

Every combinator returns a `Keymap<C>`. The algebra is closed.

```ts
const km: Keymap<AppCtx> = sub
	.contramapMaybe(project)
	.restrict(isUnlocked)
	.prefix("space")

const palette = km.active(currentCtx)  // bindings runnable right now, with meta
```

## Compositionality, by example

A diff view's keybindings know only about a `DiffState`. A detail view's only
about a `DetailState`. The app glues them together; no sub-keymap leaks the
parent's shape.

```ts
const appKm = Keymap.union(
	diffKm.contramapMaybe<AppCtx>((a) => a.view === "diff"   ? a.diff   : null),
	detailKm.contramapMaybe<AppCtx>((a) => a.view === "detail" ? a.detail : null),
	globalKm,
)
```

When the user is in the diff view, the diff keymap's bindings are dispatchable
against `app.diff`. When they're in detail view, the detail bindings are.
Same key (`"k"`) in both — no collision because `when` predicates are exclusive.

## Type safety

`Keymap<C>` is parametric in C. `contramap<C2>(f: (c2: C2) => C): Keymap<C2>`
flips it: a sub-keymap and a projection function compose into a wider-context
keymap. Forget the projection or get the types wrong and the compiler tells
you.

`Binding<C>` carries an optional `meta: { id, title, description, group }` that
survives every combinator. Palettes and footer hints read it via
`keymap.active(ctx)`.

## API

| Operation | Signature | What it does |
|---|---|---|
| `Keymap.empty<C>()` | `() => Keymap<C>` | Monoid identity |
| `Keymap.union(...kms)` | `(...Keymap<C>[]) => Keymap<C>` | Concatenate bindings |
| `km.contramap(f)` | `(C2 → C) => Keymap<C2>` | Lift to wider context |
| `km.contramapMaybe(f)` | `(C2 → C \| null) => Keymap<C2>` | Lift, deactivate when null |
| `km.restrict(p)` | `(C → boolean) => Keymap<C>` | AND-merge into all `when` |
| `km.prefix(stroke)` | `(string \| Stroke) => Keymap<C>` | Prepend to all sequences |
| `km.filter(p)` | `(Binding<C> → boolean) => Keymap<C>` | Drop bindings |
| `km.active(ctx)` | `(C) => readonly Binding<C>[]` | Currently-runnable bindings |
| `command(config)` | `(CommandConfig<C>) => Keymap<C>` | Build from one logical command |
| `createDispatcher(km, getCtx)` | | Pure dispatcher; pass to a host adapter |
| `useKeymap(km, ctx, subscribe)` | React hook | Mounts and dispatches |

## Sequences and disambiguation

Bindings are space-separated strokes: `"r"`, `"g g"`, `"ctrl+x ctrl+c"`. When
both `g` and `g g` are bound and active, pressing `g` enters a pending state.
A second `g` runs the sequence; an unrelated key clears pending and re-dispatches
fresh; a 500ms timeout commits to the single-stroke binding (configurable).

The dispatcher accepts an injectable `Clock` for deterministic tests.

## Non-goals

- Pluggable parsers, transformers, fields, attrs, or layer priorities. `when`
  predicates and contramap are how you scope.
- Async run handlers as a first-class feature. `run` may return anything; the
  dispatcher does not await.
- Type-level key-string validation. Keystrokes are parsed at command-definition
  time and a typo becomes a runtime no-op. (Tests catch this in practice.)

## Laws

The combinators obey:

- **Monoid (`union`)**: identity (`empty`), associativity.
- **Contravariant functor (`contramap`)**: identity (`contramap(id) ≡ km`),
  composition (`contramap(g).contramap(f) ≡ contramap(c => g(f(c)))`).
- **`restrict` is idempotent for the same predicate.**
- **`prefix` composes**: `prefix(b).prefix(a) ≡ prefix("a b")`.
- **Meta survives every combinator.**

All asserted by the test suite.
