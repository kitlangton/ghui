import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Clipboard, type ClipboardCopyResult } from "../src/services/Clipboard.ts"
import { CommandError, CommandRunner, type CommandResult, type RunOptions } from "../src/services/CommandRunner.ts"

interface RecordedCall {
	readonly command: string
	readonly args: readonly string[]
	readonly stdin: string | undefined
}

type CommandOutcome = "success" | "failure"

const expectedClipboardCommands: readonly (readonly [string, ...(readonly string[])])[] =
	process.platform === "darwin"
		? [["pbcopy"]]
		: process.platform === "linux"
			? [...(process.env.WAYLAND_DISPLAY ? [["wl-copy"] as const] : []), ["xclip", "-selection", "clipboard"] as const, ["xsel", "--clipboard", "--input"] as const]
			: []

const fakeCommandRunner = (outcomes: readonly CommandOutcome[], recorder: RecordedCall[]) =>
	Layer.succeed(
		CommandRunner,
		CommandRunner.of({
			run: (command: string, args: readonly string[], options?: RunOptions) => {
				recorder.push({ command, args: [...args], stdin: options?.stdin })
				const outcome = outcomes[recorder.length - 1] ?? "failure"
				if (outcome === "success") {
					const result: CommandResult = { stdout: "", stderr: "", exitCode: 0 }
					return Effect.succeed(result)
				}
				return Effect.fail(new CommandError({ command, args: [...args], detail: `${command} failed`, cause: `${command} failed` }))
			},
			runSchema: <S extends Schema.Top>() => Effect.die("unused test command runner") as Effect.Effect<S["Type"], CommandError, S["DecodingServices"]>,
		}),
	)

const runClipboard = <E>(effect: Effect.Effect<ClipboardCopyResult, E, Clipboard>, layer: Layer.Layer<Clipboard>) =>
	Effect.runPromise(effect.pipe(Effect.provide(layer)) as Effect.Effect<ClipboardCopyResult>)

const withCapturedStdout = async <A>(run: (writes: string[]) => Promise<A>) => {
	const originalWrite = process.stdout.write
	const writes: string[] = []
	process.stdout.write = ((chunk: string | Uint8Array) => {
		writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"))
		return true
	}) as typeof process.stdout.write
	try {
		return await run(writes)
	} finally {
		process.stdout.write = originalWrite
	}
}

const withTmux = async <A>(value: string | undefined, run: () => Promise<A>) => {
	const originalTmux = process.env.TMUX
	if (value === undefined) {
		delete process.env.TMUX
	} else {
		process.env.TMUX = value
	}
	try {
		return await run()
	} finally {
		if (originalTmux === undefined) {
			delete process.env.TMUX
		} else {
			process.env.TMUX = originalTmux
		}
	}
}

describe("Clipboard", () => {
	test("reports copied when a clipboard command succeeds", async () => {
		if (expectedClipboardCommands.length === 0) return
		const recorder: RecordedCall[] = []
		const layer = Clipboard.layerNoDeps.pipe(Layer.provide(fakeCommandRunner(["success"], recorder)))

		const result = await runClipboard(
			Clipboard.use((clipboard) => clipboard.copy("https://github.com/owner/repo/pull/42")),
			layer,
		)

		expect(result).toBe("copied")
		expect(recorder).toEqual([
			{
				command: expectedClipboardCommands[0]![0],
				args: expectedClipboardCommands[0]!.slice(1),
				stdin: "https://github.com/owner/repo/pull/42",
			},
		])
	})

	test("falls back to a raw OSC52 sequence when clipboard commands fail", async () => {
		const recorder: RecordedCall[] = []
		const layer = Clipboard.layerNoDeps.pipe(Layer.provide(fakeCommandRunner([], recorder)))

		await withTmux(undefined, () =>
			withCapturedStdout(async (writes) => {
				const result = await runClipboard(
					Clipboard.use((clipboard) => clipboard.copy("copy me")),
					layer,
				)

				expect(result).toBe("sent-osc52")
				expect(recorder).toHaveLength(expectedClipboardCommands.length)
				expect(writes).toEqual([`\x1b]52;c;${Buffer.from("copy me", "utf8").toString("base64")}\x07`])
			}),
		)
	})

	test("wraps OSC52 sequences for tmux passthrough", async () => {
		const recorder: RecordedCall[] = []
		const layer = Clipboard.layerNoDeps.pipe(Layer.provide(fakeCommandRunner([], recorder)))
		const sequence = `\x1b]52;c;${Buffer.from("tmux copy", "utf8").toString("base64")}\x07`

		await withTmux("/tmp/tmux-1000/default,1,0", () =>
			withCapturedStdout(async (writes) => {
				const result = await runClipboard(
					Clipboard.use((clipboard) => clipboard.copy("tmux copy")),
					layer,
				)

				expect(result).toBe("sent-osc52")
				expect(writes).toEqual([`\x1bPtmux;${sequence.split("\x1b").join("\x1b\x1b")}\x1b\\`])
			}),
		)
	})
})
