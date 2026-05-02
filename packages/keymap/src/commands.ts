/** Result of `enabled(state)`: true (runnable), false (silently disabled), or a reason string (notify-on-attempt). */
export type EnabledResult = true | false | string

export interface Command<S = unknown> {
	readonly id: string
	readonly title: string
	readonly description?: string
	readonly group?: string
	readonly keys?: readonly string[]
	readonly display?: string
	readonly when?: (state: S) => boolean
	readonly enabled?: (state: S) => EnabledResult
	readonly run: (state: S) => unknown
}

export const defineCommand = <S>(command: Command<S>): Command<S> => command

/** Returns `true` if runnable, otherwise a reason string. */
export const isCommandActive = <S>(command: Command<S>, state: S): true | string => {
	if (command.when && !command.when(state)) return "out of scope"
	const enabled = command.enabled?.(state) ?? true
	if (enabled === true) return true
	if (enabled === false) return "disabled"
	return enabled
}

export const scope = <S>(
	when: (state: S) => boolean,
	commands: readonly Command<S>[],
): readonly Command<S>[] =>
	commands.map((command) => ({
		...command,
		when: command.when ? (state) => when(state) && command.when!(state) : when,
	}))

export const getActiveCommands = <S>(
	commands: readonly Command<S>[],
	state: S,
): readonly Command<S>[] =>
	commands.filter((command) => isCommandActive(command, state) === true)
