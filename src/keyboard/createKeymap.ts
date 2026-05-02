import type { CliRenderer } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"

/**
 * Creates the OpenTUI keymap with ghui's customizations.
 *
 * The default emacs-style parser only treats whitespace-separated input as a
 * sequence when at least one stroke has a "+" modifier. Prepend a parser that
 * handles plain plain-key sequences ("g g") so vim-style multi-stroke bindings
 * can be authored directly.
 */
export const createKeymap = (renderer: CliRenderer) => {
	const keymap = createDefaultOpenTuiKeymap(renderer)
	keymap.prependBindingParser(({ input, index, parseObjectKey }) => {
		if (index !== 0) return undefined
		const strokes = input.trim().split(/\s+/).filter(Boolean)
		if (strokes.length <= 1) return undefined
		if (strokes.some((stroke) => stroke.includes("+"))) return undefined
		return {
			parts: strokes.map((stroke) => parseObjectKey({ name: stroke.toLowerCase() })),
			nextIndex: input.length,
		}
	})
	return keymap
}
