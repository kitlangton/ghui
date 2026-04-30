import { Config, Effect } from "effect"

const positiveIntOr = (fallback: number) => (value: number) => Number.isFinite(value) && value > 0 ? value : fallback

const appConfig = Config.all({
	author: Config.string("GHUI_AUTHOR").pipe(
		Config.withDefault("@me"),
		Config.map((value) => value.trim() || "@me"),
	),
	prFetchLimit: Config.int("GHUI_PR_FETCH_LIMIT").pipe(
		Config.withDefault(200),
		Config.map(positiveIntOr(200)),
	),
})

export const config = Effect.runSync(Effect.gen(function*() {
	return yield* appConfig
}))
