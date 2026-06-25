import { Effect } from "effect"
import * as Atom from "effect/unstable/reactivity/Atom"
import type { ItemPage } from "../item.js"
import type { ItemLoad } from "./load.js"

export type ItemLoadCache<View, Item> = Partial<Record<string, ItemLoad<View, Item>>>

export interface ItemQueueView {
	readonly _tag: string
}

export interface ItemQueueAdapter<View extends ItemQueueView, Item, Requirements> {
	readonly keyOfView: (view: View) => string
	readonly getAuthenticatedUser: Effect.Effect<string, unknown, Requirements>
	readonly readCached: (viewer: string, view: View) => Effect.Effect<ItemLoad<View, Item> | null, unknown, Requirements>
	readonly writeCached: (viewer: string, load: ItemLoad<View, Item>) => Effect.Effect<void, never, Requirements>
	readonly fetchFirstPage: (view: View) => Effect.Effect<ItemPage<Item>, unknown, Requirements>
	readonly freshLoad: (view: View, page: ItemPage<Item>, existing: ItemLoad<View, Item> | undefined) => ItemLoad<View, Item>
	readonly trimCache: (cache: ItemLoadCache<View, Item>) => ItemLoadCache<View, Item>
}

export const itemQueueCacheViewer = (view: ItemQueueView, username: string | null): string | null => (view._tag === "Repository" ? "anonymous" : username)

const touchCacheEntry = <View, Item>(cache: ItemLoadCache<View, Item>, key: string, load: ItemLoad<View, Item>): ItemLoadCache<View, Item> => {
	const next = { ...cache }
	delete next[key]
	next[key] = load
	return next
}

/**
 * Runs the cache-first first-page protocol shared by Item queues. Kind-specific
 * adapters retain query construction, fresh-load merging, and persistence.
 */
export const loadItemQueue = <View extends ItemQueueView, Item, Requirements>(
	view: View,
	cacheAtom: Atom.Writable<ItemLoadCache<View, Item>>,
	adapter: ItemQueueAdapter<View, Item, Requirements>,
) =>
	Effect.gen(function* () {
		const cacheKey = adapter.keyOfView(view)
		const anonymousViewer = itemQueueCacheViewer(view, null)
		const viewer = anonymousViewer ?? itemQueueCacheViewer(view, yield* adapter.getAuthenticatedUser.pipe(Effect.catch(() => Effect.succeed(null))))

		if (viewer) {
			const cached = yield* adapter.readCached(viewer, view).pipe(Effect.catch(() => Effect.succeed(null)))
			if (cached) {
				yield* Atom.update(cacheAtom, (cache) => (cache[cacheKey] ? cache : adapter.trimCache(touchCacheEntry(cache, cacheKey, cached))))
			}
		}

		const page = yield* adapter.fetchFirstPage(view)
		const load = yield* Atom.modify(cacheAtom, (cache) => {
			const next = adapter.freshLoad(view, page, cache[cacheKey])
			return [next, adapter.trimCache(touchCacheEntry(cache, cacheKey, next))]
		})
		if (viewer) yield* adapter.writeCached(viewer, load)
		return load
	})
