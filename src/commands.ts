export type CommandScope = "Global" | "View" | "Pull request" | "Diff" | "Navigation" | "System"

const SCOPE_ORDER: readonly CommandScope[] = ["Global", "View", "Pull request", "Diff", "Navigation", "System"]

export const sortCommandsByScope = (commands: readonly AppCommand[]) =>
	[...commands].sort((left, right) => SCOPE_ORDER.indexOf(left.scope) - SCOPE_ORDER.indexOf(right.scope))

export interface AppCommand {
	readonly id: string
	readonly title: string
	readonly scope: CommandScope
	readonly run: () => void
	readonly subtitle?: string
	readonly shortcut?: string
	readonly keywords?: readonly string[]
	readonly disabledReason?: string | null
}

export const defineCommand = (command: AppCommand): AppCommand => command

export const commandEnabled = (command: AppCommand) => !command.disabledReason

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim()

const acronym = (text: string) => normalize(text).split(" ").filter(Boolean).map((word) => word[0]).join("")

const fuzzyIncludes = (text: string, query: string) => {
	let index = 0
	for (const char of text) {
		if (char === query[index]) index++
		if (index >= query.length) return true
	}
	return query.length === 0
}

const commandSearchText = (command: AppCommand) => normalize([
	command.title,
	command.subtitle,
	command.scope,
	command.shortcut,
	...(command.keywords ?? []),
].filter(Boolean).join(" "))

const commandScore = (command: AppCommand, query: string) => {
	const normalizedQuery = normalize(query)
	if (normalizedQuery.length === 0) return 0

	const title = normalize(command.title)
	const searchText = commandSearchText(command)
	const titleAcronym = acronym(command.title)
	if (title.startsWith(normalizedQuery)) return 0
	if (searchText.startsWith(normalizedQuery)) return 1
	if (title.includes(normalizedQuery)) return 2
	if (searchText.includes(normalizedQuery)) return 3
	if (titleAcronym.startsWith(normalizedQuery)) return 4
	if (fuzzyIncludes(searchText, normalizedQuery.replaceAll(" ", ""))) return 5
	return null
}

export const filterCommands = (commands: readonly AppCommand[], query: string) => {
	return commands.flatMap((command, index) => {
		const score = commandScore(command, query)
		return score === null ? [] : [{ command, index, score }]
	}).sort((left, right) => {
		const enabled = Number(commandEnabled(right.command)) - Number(commandEnabled(left.command))
		return enabled || left.score - right.score || left.index - right.index
	}).map(({ command }) => command)
}

export const clampCommandIndex = (index: number, commands: readonly AppCommand[]) => {
	if (commands.length === 0) return 0
	return Math.max(0, Math.min(commands.length - 1, index))
}
