import type { Binding, BindingMeta, Enabled } from "./binding.ts"
import { Keymap } from "./keymap.ts"
import { parseBinding } from "./keys.ts"

export interface CommandConfig<C> {
	readonly id?: string
	readonly title?: string
	readonly description?: string
	readonly group?: string
	readonly keys: readonly string[] | string
	readonly when?: (ctx: C) => boolean
	readonly enabled?: (ctx: C) => Enabled
	readonly run: (ctx: C) => void
}

const buildMeta = (config: CommandConfig<unknown>): BindingMeta | undefined => {
	const meta: BindingMeta = {
		...(config.id !== undefined && { id: config.id }),
		...(config.title !== undefined && { title: config.title }),
		...(config.description !== undefined && { description: config.description }),
		...(config.group !== undefined && { group: config.group }),
	}
	return Object.keys(meta).length > 0 ? meta : undefined
}

/**
 * Build a Keymap from one logical command. Multiple key alternatives produce
 * multiple bindings that share the same action and meta.
 */
export const command = <C>(config: CommandConfig<C>): Keymap<C> => {
	const keys = typeof config.keys === "string" ? [config.keys] : config.keys
	const meta = buildMeta(config as CommandConfig<unknown>)
	const bindings: Binding<C>[] = keys.map((key) => ({
		sequence: parseBinding(key),
		...(config.when ? { when: config.when } : {}),
		...(config.enabled ? { enabled: config.enabled } : {}),
		action: config.run,
		...(meta ? { meta } : {}),
	}))
	return new Keymap<C>(bindings)
}
