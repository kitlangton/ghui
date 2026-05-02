export interface ParsedStroke {
	readonly key: string
	readonly ctrl: boolean
	readonly shift: boolean
	readonly meta: boolean
}

const MODIFIERS = new Set(["ctrl", "shift", "meta"])

export const parseKey = (input: string): ParsedStroke => {
	const parts = input.split("+").map((part) => part.trim().toLowerCase()).filter(Boolean)
	if (parts.length === 0) throw new Error(`Empty key string: ${JSON.stringify(input)}`)

	const key = parts[parts.length - 1]!
	const mods = new Set(parts.slice(0, -1))
	for (const mod of mods) {
		if (!MODIFIERS.has(mod)) throw new Error(`Unknown modifier ${JSON.stringify(mod)} in ${JSON.stringify(input)}`)
	}
	return { key, ctrl: mods.has("ctrl"), shift: mods.has("shift"), meta: mods.has("meta") }
}

export const parseBinding = (input: string): readonly ParsedStroke[] =>
	input.trim().split(/\s+/).filter(Boolean).map(parseKey)

export const strokeMatches = (a: ParsedStroke, b: ParsedStroke): boolean =>
	a.key === b.key && a.ctrl === b.ctrl && a.shift === b.shift && a.meta === b.meta

export const sequenceMatches = (a: readonly ParsedStroke[], b: readonly ParsedStroke[]): boolean =>
	a.length === b.length && a.every((stroke, index) => strokeMatches(stroke, b[index]!))

export const sequenceStartsWith = (
	sequence: readonly ParsedStroke[],
	prefix: readonly ParsedStroke[],
): boolean =>
	prefix.length <= sequence.length && prefix.every((stroke, index) => strokeMatches(stroke, sequence[index]!))

export const formatStroke = (stroke: ParsedStroke): string => {
	const parts: string[] = []
	if (stroke.ctrl) parts.push("ctrl")
	if (stroke.shift) parts.push("shift")
	if (stroke.meta) parts.push("meta")
	parts.push(stroke.key)
	return parts.join("+")
}

export const formatSequence = (sequence: readonly ParsedStroke[]): string =>
	sequence.map(formatStroke).join(" ")
