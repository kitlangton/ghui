import { describe, expect, test } from "bun:test"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { itemQueryCacheKeyHasRepository } from "../src/item.ts"
import { appendItemPage, freshItemLoad, nextItemLoadAfterPage, resolveItemLoad, trimItemLoadCache, type ItemLoad } from "../src/item/load.ts"

interface Item {
	readonly id: string
	readonly detail: string
}

type View = "first" | "second"
type Load = ItemLoad<View, Item>

const item = (id: string, detail = "summary"): Item => ({ id, detail })
const mergeDetail = (incoming: readonly Item[], existing: readonly Item[]) => {
	const byId = new Map(existing.map((entry) => [entry.id, entry]))
	return incoming.map((entry) => byId.get(entry.id) ?? entry)
}
const load = (view: View, data: readonly Item[] = [], endCursor: string | null = null): Load => ({ view, data, fetchedAt: null, endCursor, hasNextPage: true })

describe("Item Load", () => {
	test("appends only new Items after applying kind-specific merge behavior", () => {
		const appended = appendItemPage([item("1", "hydrated")], [item("1"), item("2")], (entry) => entry.id, mergeDetail)

		expect(appended).toEqual([item("1", "hydrated"), item("2")])
	})

	test("deduplicates repeated Items within an incoming page", () => {
		const appended = appendItemPage([], [item("1"), item("1"), item("2")], (entry) => entry.id, mergeDetail)

		expect(appended).toEqual([item("1"), item("2")])
	})

	test("builds a fresh load and enforces the Item limit", () => {
		const fetchedAt = new Date("2026-06-04T12:00:00Z")
		const fresh = freshItemLoad("first", { items: [item("1"), item("2")], endCursor: "next", hasNextPage: true }, (items) => items, 2, fetchedAt)

		expect(fresh).toEqual({ view: "first", data: [item("1"), item("2")], fetchedAt, endCursor: "next", hasNextPage: false })
	})

	test("keeps duplicate-only pagination alive when the cursor advances", () => {
		const next = nextItemLoadAfterPage(load("first", [item("1")], "old"), { items: [item("1")], endCursor: "new", hasNextPage: true }, 10, (entry) => entry.id, mergeDetail)

		expect(next.data).toEqual([item("1")])
		expect(next.hasNextPage).toBe(true)
	})

	test("stops pagination when the cursor stalls", () => {
		const next = nextItemLoadAfterPage(load("first", [item("1")], "same"), { items: [item("2")], endCursor: "same", hasNextPage: true }, 10, (entry) => entry.id, mergeDetail)

		expect(next.hasNextPage).toBe(false)
	})

	test("prefers the keyed cache and rejects a resolved load for another View", () => {
		const cached = load("first", [item("cached")])
		const resolved = load("second", [item("resolved")])

		expect(resolveItemLoad("first", { first: cached }, AsyncResult.success(resolved), (view) => view)).toBe(cached)
		expect(resolveItemLoad("first", {}, AsyncResult.success(resolved), (view) => view)).toBeNull()
	})

	test("trims only the oldest repository entries", () => {
		const cache = { user: 0, "repo:first": 1, "repo:second": 2, "repo:third": 3 }

		expect(trimItemLoadCache(cache, (key) => key.startsWith("repo:"), 2)).toEqual({ user: 0, "repo:second": 2, "repo:third": 3 })
	})

	test("classifies repository-scoped cache keys in every queue mode", () => {
		expect(itemQueryCacheKeyHasRepository("pullRequest:all:owner/repo")).toBe(true)
		expect(itemQueryCacheKeyHasRepository("pullRequest:authored:owner/repo")).toBe(true)
		expect(itemQueryCacheKeyHasRepository("issue:assigned:owner/repo")).toBe(true)
		expect(itemQueryCacheKeyHasRepository("issue:authored:_")).toBe(false)
	})
})
