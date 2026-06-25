import { Context, Effect, Layer, Schema } from "effect"
import { config } from "../config.js"
import { errorMessage } from "../errors.js"
import { classifyGitHubRateLimit } from "./githubRateLimit.js"

export interface CommandResult {
	readonly stdout: string
	readonly stderr: string
	readonly exitCode: number
}

export interface RunOptions {
	readonly stdin?: string
}

export class CommandError extends Schema.TaggedErrorClass<CommandError>()("CommandError", {
	command: Schema.String,
	args: Schema.Array(Schema.String),
	detail: Schema.String,
	cause: Schema.Defect(),
}) {}

export class JsonParseError extends Schema.TaggedErrorClass<JsonParseError>()("JsonParseError", {
	command: Schema.String,
	args: Schema.Array(Schema.String),
	stdout: Schema.String,
	cause: Schema.Defect(),
}) {}

export const isCommandTimeoutError = (error: unknown): boolean => {
	return errorMessage(error).startsWith("Timed out after ")
}

const readStream = async (stream: ReadableStream | null | undefined) => {
	if (!stream) return ""
	return Bun.readableStreamToText(stream)
}

const valueAfter = (args: readonly string[], flag: string, prefix: string) => {
	for (let index = 0; index < args.length - 1; index++) {
		if (args[index] === flag && args[index + 1]?.startsWith(prefix)) return args[index + 1]!.slice(prefix.length)
	}
	return null
}

const firstRestApiPath = (args: readonly string[]) => args.find((arg) => /^[a-z0-9_.-]+\//i.test(arg) || arg.startsWith("user")) ?? null

export const commandTelemetryAttributes = (command: string, args: readonly string[]) => {
	const githubKind = command !== "gh" ? "none" : args[0] === "api" && args[1] === "graphql" ? "graphql" : args[0] === "api" ? "rest" : (args[0] ?? "unknown")
	const first = valueAfter(args, "-F", "first=")
	const limit = valueAfter(args, "--limit", "")
	return {
		"process.command": command,
		"process.argv.count": args.length,
		"github.command.kind": githubKind,
		"github.graphql.has_cursor": args.some((arg) => arg.startsWith("after=")),
		...(first ? { "github.page_size": Number.parseInt(first, 10) } : {}),
		...(limit ? { "github.limit": Number.parseInt(limit, 10) } : {}),
		...(githubKind === "rest" ? { "github.rest.path": firstRestApiPath(args) ?? "unknown" } : {}),
	}
}

export class CommandRunner extends Context.Service<
	CommandRunner,
	{
		readonly run: (command: string, args: readonly string[], options?: RunOptions) => Effect.Effect<CommandResult, CommandError>
		readonly runSchema: <S extends Schema.Top>(
			schema: S,
			command: string,
			args: readonly string[],
		) => Effect.Effect<S["Type"], CommandError | JsonParseError | Schema.SchemaError, S["DecodingServices"]>
	}
>()("ghui/CommandRunner") {
	static readonly layer = Layer.effect(
		CommandRunner,
		Effect.gen(function* () {
			const commandTimeoutError = (command: string, args: readonly string[]) =>
				new CommandError({
					command,
					args: [...args],
					detail: `Timed out after ${config.commandTimeoutMs}ms`,
					cause: { timeoutMs: config.commandTimeoutMs },
				})

			const runProcessRaw = Effect.fn("CommandRunner.runProcessRaw")((command: string, args: readonly string[], stdin: string | undefined) =>
				Effect.tryPromise({
					async try(signal) {
						const proc = Bun.spawn({
							cmd: [command, ...args],
							stdin: stdin === undefined ? "ignore" : "pipe",
							stdout: "pipe",
							stderr: "pipe",
						})
						const kill = () => proc.kill("SIGKILL")
						signal.addEventListener("abort", kill, { once: true })

						try {
							if (stdin !== undefined && proc.stdin) {
								proc.stdin.write(stdin)
								proc.stdin.end()
							}
							const [exitCode, stdout, stderr] = await Promise.all([proc.exited, readStream(proc.stdout), readStream(proc.stderr)])
							return { stdout, stderr, exitCode }
						} catch (cause) {
							proc.kill("SIGKILL")
							throw cause
						} finally {
							signal.removeEventListener("abort", kill)
						}
					},
					catch: (cause) =>
						new CommandError({
							command,
							args: [...args],
							detail: errorMessage(cause) || `Failed to run ${command}`,
							cause,
						}),
				}),
			)
			const runProcess = Effect.fn("CommandRunner.runProcess")((command: string, args: readonly string[], stdin: string | undefined) =>
				runProcessRaw(command, args, stdin).pipe(
					Effect.timeoutOrElse({
						duration: `${config.commandTimeoutMs} millis`,
						orElse: () => Effect.fail(commandTimeoutError(command, args)),
					}),
				),
			)

			const run = Effect.fn("CommandRunner.run")(function* (command: string, args: readonly string[], options?: RunOptions) {
				const startedAt = Date.now()
				const attributes = commandTelemetryAttributes(command, args)
				const result = yield* runProcess(command, args, options?.stdin).pipe(
					Effect.tap((result) =>
						Effect.annotateCurrentSpan({
							...attributes,
							"process.duration_ms": Date.now() - startedAt,
							"process.exit_code": result.exitCode,
							...(result.exitCode === 0 ? {} : { "github.rate_limit.kind": classifyGitHubRateLimit(result.stderr || result.stdout) ?? "none" }),
						}),
					),
					Effect.withSpan("ghui.command.runProcess", {
						attributes,
					}),
				)
				if (result.exitCode !== 0) {
					const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`
					return yield* new CommandError({ command, args: [...args], detail, cause: detail })
				}
				return result
			})

			const runJson = Effect.fn("CommandRunner.runJson")(function* <A>(command: string, args: readonly string[]) {
				const result = yield* run(command, args)
				return yield* Effect.try({
					try: () => JSON.parse(result.stdout) as A,
					catch: (cause) => new JsonParseError({ command, args: [...args], stdout: result.stdout, cause }),
				})
			})

			const runSchema = Effect.fn("CommandRunner.runSchema")(function* <S extends Schema.Top>(schema: S, command: string, args: readonly string[]) {
				const value = yield* runJson<unknown>(command, args)
				return yield* Schema.decodeUnknownEffect(schema)(value)
			})

			return CommandRunner.of({ run, runSchema })
		}),
	)
}
