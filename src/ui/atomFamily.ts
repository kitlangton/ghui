export const atomFamily = <K, V>(createAtom: (key: K) => V): ((key: K) => V) => {
	const cache = new Map<K, V>()
	return (key: K): V => {
		const existing = cache.get(key)
		if (existing !== undefined) return existing
		const item = createAtom(key)
		cache.set(key, item)
		return item
	}
}
