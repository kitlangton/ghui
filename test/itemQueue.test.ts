import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import { freshItemLoad, trimItemLoadCache, type ItemLoad } from "../src/item/load.ts"
import { loadItemQueue, type ItemLoadCache, type ItemQueueAdapter } from "../src/item/queue.ts"

interface Item {
	readonly id: string
	readonly detail: string
}

interface View {
	readonly key: string
	readonly _tag: "Repository" | "Queue"
}

type Load = ItemLoad<View, Item>

const item = (id: string, detail = "summary"): Item => ({ id, detail })
const view = (key: string, repository = true): View => ({ key, _tag: repository ? "Repository" : "Queue" })
const load = (queueView: View, data: readonly Item[]): Load => ({ view: queueView, data, fetchedAt: null, endCursor: null, hasNextPage: false })
const trimCache = (cache: ItemLoadCache<View, Item>) => trimItemLoadCache(cache, (key) => key.startsWith("repo:"), 2)
const runQueue = <Requirements>(queueView: View, cacheAtom: Atom.Writable<ItemLoadCache<View, Item>>, adapter: ItemQueueAdapter<View, Item, Requirements>) => {
	const registry = AtomRegistry.make()
	return Effect.runPromise(loadItemQueue(queueView, cacheAtom, adapter).pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))).then((result) => ({ result, registry }))
}

describe("Item Queue", () => {
	test("publishes cached data before fetching, preserves it during merge, and persists the fresh load", async () => {
		const active = view("repo:active")
		const cached = load(active, [item("1", "hydrated")])
		const oldest = load(view("repo:oldest"), [item("oldest")])
		const middle = load(view("repo:middle"), [item("middle")])
		const cacheAtom = Atom.make<ItemLoadCache<View, Item>>({ "repo:oldest": oldest, "repo:middle": middle })
		const calls: string[] = []
		const viewers: string[] = []
		let cacheSeenByFetch: ItemLoadCache<View, Item> = {}
		let persisted: Load | null = null

		const { result, registry } = await runQueue(active, cacheAtom, {
			keyOfView: (queueView) => queueView.key,
			getAuthenticatedUser: Effect.die("repository views must not authenticate"),
			readCached: (viewer) => Effect.sync(() => (viewers.push(viewer), calls.push("read"), cached)),
			writeCached: (viewer, fresh) => Effect.sync(() => void (viewers.push(viewer), calls.push("write"), (persisted = fresh))),
			fetchFirstPage: () =>
				Effect.gen(function* () {
					calls.push("fetch")
					cacheSeenByFetch = yield* Atom.get(cacheAtom)
					return { items: [item("1")], endCursor: null, hasNextPage: false }
				}),
			freshLoad: (queueView, page, existing) =>
				freshItemLoad(queueView, page, (items) => items.map((entry) => existing?.data.find((cachedItem) => cachedItem.id === entry.id) ?? entry), 10),
			trimCache,
		})

		expect(calls).toEqual(["read", "fetch", "write"])
		expect(viewers).toEqual(["anonymous", "anonymous"])
		expect(cacheSeenByFetch[active.key]).toBe(cached)
		expect(result.data).toEqual([item("1", "hydrated")])
		expect(persisted).toBe(result)
		expect(Object.keys(registry.get(cacheAtom))).toEqual(["repo:middle", "repo:active"])
	})

	test("ignores authentication and cache-read failures without blocking a fresh fetch", async () => {
		const active = view("user:authored", false)
		const cacheAtom = Atom.make<ItemLoadCache<View, Item>>({})
		let writes = 0
		const viewers: string[] = []

		const { result } = await runQueue(active, cacheAtom, {
			keyOfView: (queueView) => queueView.key,
			getAuthenticatedUser: Effect.succeed("alice"),
			readCached: (viewer) => Effect.sync(() => void viewers.push(viewer)).pipe(Effect.andThen(Effect.fail("unavailable"))),
			writeCached: (viewer) => Effect.sync(() => void (viewers.push(viewer), (writes += 1))),
			fetchFirstPage: () => Effect.succeed({ items: [item("fresh")], endCursor: null, hasNextPage: false }),
			freshLoad: (queueView, page) => freshItemLoad(queueView, page, (items) => items, 10),
			trimCache,
		})

		expect(result.data).toEqual([item("fresh")])
		expect(writes).toBe(1)
		expect(viewers).toEqual(["alice", "alice"])

		const unauthenticated = await runQueue(active, Atom.make<ItemLoadCache<View, Item>>({}), {
			keyOfView: (queueView) => queueView.key,
			getAuthenticatedUser: Effect.fail("not logged in"),
			readCached: () => Effect.die("no viewer means no cache read"),
			writeCached: () => Effect.die("no viewer means no cache write"),
			fetchFirstPage: () => Effect.succeed({ items: [item("fresh")], endCursor: null, hasNextPage: false }),
			freshLoad: (queueView, page) => freshItemLoad(queueView, page, (items) => items, 10),
			trimCache,
		})
		expect(unauthenticated.result.data).toEqual([item("fresh")])
	})

	test("merges against cache changes that land while the fresh page is fetching", async () => {
		const active = view("repo:active")
		const summary = load(active, [item("1")])
		const hydrated = load(active, [item("1", "hydrated during fetch")])
		const cacheAtom = Atom.make<ItemLoadCache<View, Item>>({ [active.key]: summary })

		const { result } = await runQueue(active, cacheAtom, {
			keyOfView: (queueView) => queueView.key,
			getAuthenticatedUser: Effect.die("repository views must not authenticate"),
			readCached: () => Effect.succeed(null),
			writeCached: () => Effect.void,
			fetchFirstPage: () => Atom.set(cacheAtom, { [active.key]: hydrated }).pipe(Effect.as({ items: [item("1")], endCursor: null, hasNextPage: false })),
			freshLoad: (queueView, page, existing) =>
				freshItemLoad(queueView, page, (items) => items.map((entry) => existing?.data.find((cachedItem) => cachedItem.id === entry.id) ?? entry), 10),
			trimCache,
		})

		expect(result.data).toEqual([item("1", "hydrated during fetch")])
	})

	test("does not replace an existing in-memory load with an older persisted load", async () => {
		const active = view("repo:active")
		const memory = load(active, [item("memory", "newer")])
		const persisted = load(active, [item("persisted", "older")])
		const cacheAtom = Atom.make<ItemLoadCache<View, Item>>({ [active.key]: memory })
		let seenDuringFetch: Load | undefined

		await runQueue(active, cacheAtom, {
			keyOfView: (queueView) => queueView.key,
			getAuthenticatedUser: Effect.die("repository views must not authenticate"),
			readCached: () => Effect.succeed(persisted),
			writeCached: () => Effect.void,
			fetchFirstPage: () =>
				Effect.gen(function* () {
					seenDuringFetch = (yield* Atom.get(cacheAtom))[active.key]
					return { items: [], endCursor: null, hasNextPage: false }
				}),
			freshLoad: (queueView, page) => freshItemLoad(queueView, page, (items) => items, 10),
			trimCache,
		})

		expect(seenDuringFetch).toBe(memory)
	})

	test("replaces and persists cached rows after an authoritative empty refresh", async () => {
		const active = view("repo:active")
		const cacheAtom = Atom.make<ItemLoadCache<View, Item>>({ [active.key]: load(active, [item("cached")]) })
		let persisted: Load | null = null

		const { result, registry } = await runQueue(active, cacheAtom, {
			keyOfView: (queueView) => queueView.key,
			getAuthenticatedUser: Effect.die("repository views must not authenticate"),
			readCached: () => Effect.succeed(null),
			writeCached: (_viewer, fresh) => Effect.sync(() => void (persisted = fresh)),
			fetchFirstPage: () => Effect.succeed({ items: [], endCursor: null, hasNextPage: false }),
			freshLoad: (queueView, page) => freshItemLoad(queueView, page, (items) => items, 10),
			trimCache,
		})

		expect(result.data).toEqual([])
		expect(registry.get(cacheAtom)[active.key]?.data).toEqual([])
		expect(persisted).toBe(result)
	})

	test("touches an existing refreshed repository load before trimming", async () => {
		const oldest = view("repo:oldest")
		const middle = view("repo:middle")
		const newest = view("repo:newest")
		const cacheAtom = Atom.make<ItemLoadCache<View, Item>>({
			[oldest.key]: load(oldest, [item("oldest")]),
			[middle.key]: load(middle, [item("middle")]),
			[newest.key]: load(newest, [item("newest")]),
		})

		const { registry } = await runQueue(oldest, cacheAtom, {
			keyOfView: (queueView) => queueView.key,
			getAuthenticatedUser: Effect.die("repository views must not authenticate"),
			readCached: () => Effect.succeed(null),
			writeCached: () => Effect.void,
			fetchFirstPage: () => Effect.succeed({ items: [item("refreshed")], endCursor: null, hasNextPage: false }),
			freshLoad: (queueView, page) => freshItemLoad(queueView, page, (items) => items, 10),
			trimCache,
		})

		expect(Object.keys(registry.get(cacheAtom))).toEqual(["repo:newest", "repo:oldest"])
	})

	test("keeps the published cached load available when the fresh fetch fails", async () => {
		const active = view("repo:active")
		const cached = load(active, [item("cached")])
		const cacheAtom = Atom.make<ItemLoadCache<View, Item>>({})
		const registry = AtomRegistry.make()
		const effect = loadItemQueue(active, cacheAtom, {
			keyOfView: (queueView) => queueView.key,
			getAuthenticatedUser: Effect.die("repository views must not authenticate"),
			readCached: () => Effect.succeed(cached),
			writeCached: () => Effect.die("failed fetches must not persist"),
			fetchFirstPage: () => Effect.fail("offline"),
			freshLoad: (queueView, page) => freshItemLoad(queueView, page, (items) => items, 10),
			trimCache,
		}).pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))

		await expect(Effect.runPromise(effect)).rejects.toThrow("offline")
		expect(registry.get(cacheAtom)[active.key]).toBe(cached)
	})
})
