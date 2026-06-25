import type { ItemPage } from "../item.js"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"

export interface ItemLoad<View, Item> {
	readonly view: View
	readonly data: readonly Item[]
	readonly fetchedAt: Date | null
	readonly endCursor: string | null
	readonly hasNextPage: boolean
}

export type ItemKey<Item> = (item: Item) => string
export type MergeIncomingItems<Item> = (incoming: readonly Item[], existing: readonly Item[]) => readonly Item[]

export const trimItemLoadCache = <Load>(
	cache: Partial<Record<string, Load>>,
	isRepositoryKey: (key: string) => boolean,
	maxRepositoryEntries: number,
): Partial<Record<string, Load>> => {
	const repositoryKeys = Object.keys(cache).filter(isRepositoryKey)
	if (repositoryKeys.length <= maxRepositoryEntries) return cache
	const next = { ...cache }
	for (const key of repositoryKeys.slice(0, repositoryKeys.length - maxRepositoryEntries)) delete next[key]
	return next
}

export const resolveItemLoad = <View, Item>(
	view: View,
	cache: Partial<Record<string, ItemLoad<View, Item>>>,
	result: AsyncResult.AsyncResult<ItemLoad<View, Item>, unknown>,
	keyOfView: (view: View) => string,
): ItemLoad<View, Item> | null => {
	const cacheKey = keyOfView(view)
	const cached = cache[cacheKey] ?? null
	if (cached) return cached
	const resolved = AsyncResult.getOrElse(result, () => null)
	return resolved && keyOfView(resolved.view) === cacheKey ? resolved : null
}

export const appendItemPage = <Item>(existing: readonly Item[], incoming: readonly Item[], keyOf: ItemKey<Item>, mergeIncoming: MergeIncomingItems<Item>): readonly Item[] => {
	const seen = new Set(existing.map(keyOf))
	const appended = mergeIncoming(incoming, existing).filter((item) => {
		const key = keyOf(item)
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
	return [...existing, ...appended]
}

export const freshItemLoad = <View, Item>(
	view: View,
	page: ItemPage<Item>,
	mergeItems: (items: readonly Item[]) => readonly Item[],
	itemLimit: number,
	fetchedAt: Date = new Date(),
): ItemLoad<View, Item> => {
	const data = mergeItems(page.items)
	return {
		view,
		data,
		fetchedAt,
		endCursor: page.endCursor,
		hasNextPage: page.hasNextPage && data.length < itemLimit,
	}
}

// Keep pagination alive whenever the cursor advances, the server claims more
// pages exist, and the Item limit has not been reached. An earlier PR-only
// implementation also required the page to add an Item, which permanently
// killed pagination on duplicate-only windows even though the next cursor
// could contain fresh Items. Cursor movement is the progress invariant.
export const nextItemLoadAfterPage = <View, Item>(
	current: ItemLoad<View, Item>,
	page: ItemPage<Item>,
	itemLimit: number,
	keyOf: ItemKey<Item>,
	mergeIncoming: MergeIncomingItems<Item>,
	fetchedAt: Date = new Date(),
): ItemLoad<View, Item> => {
	const data = appendItemPage(current.data, page.items, keyOf, mergeIncoming)
	const cursorAdvanced = page.endCursor !== null && page.endCursor !== current.endCursor
	return {
		...current,
		data,
		fetchedAt,
		endCursor: page.endCursor,
		hasNextPage: page.hasNextPage && cursorAdvanced && data.length < itemLimit,
	}
}
