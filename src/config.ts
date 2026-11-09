import { homedir } from "node:os"
import { join } from "node:path"
import { Config, Effect } from "effect"

const resolveHomeDir = () => {
	try {
		return homedir()
	} catch {
		return process.env.HOME ?? "/tmp"
	}
}

const positiveIntOr = (fallback: number) => (value: number) => (Number.isFinite(value) && value > 0 ? value : fallback)

const pageSizeOr = (fallback: number) => (value: number) => Math.min(100, positiveIntOr(fallback)(value))

const defaultCachePath = () => join(process.env.XDG_CACHE_HOME ?? join(resolveHomeDir(), ".cache"), "ghui", "cache.sqlite")

const resolveCachePath = () => {
	const value = process.env.GHUI_CACHE_PATH?.trim()
	if (value === "off" || value === "0" || value === "false") return null
	return value && value.length > 0 ? value : defaultCachePath()
}

const appConfig = Config.all({
	prFetchLimit: Config.int("GHUI_PR_FETCH_LIMIT").pipe(Config.withDefault(500), Config.map(positiveIntOr(500))),
	prPageSize: Config.int("GHUI_PR_PAGE_SIZE").pipe(Config.withDefault(50), Config.map(pageSizeOr(50))),
	commandTimeoutMs: Config.int("GHUI_COMMAND_TIMEOUT_MS").pipe(Config.withDefault(15_000), Config.map(positiveIntOr(15_000))),
	runFetchLimit: Config.int("GHUI_RUN_FETCH_LIMIT").pipe(Config.withDefault(20), Config.map(positiveIntOr(20))),
	cachePath: Config.succeed(resolveCachePath()),
})

export const config = Effect.runSync(
	Effect.gen(function* () {
		return yield* appConfig
	}),
)
