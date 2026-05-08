import { Context, Effect, Layer, Schema } from "effect"
import { CommandRunner } from "./CommandRunner.js"

export class ClipboardError extends Schema.TaggedErrorClass<ClipboardError>()("ClipboardError", {
	detail: Schema.String,
}) {}

const clipboardCommands: readonly (readonly [string, ...(readonly string[])])[] =
	process.platform === "darwin"
		? [["pbcopy"]]
		: process.platform === "linux"
			? [...(process.env.WAYLAND_DISPLAY ? [["wl-copy"] as const] : []), ["xclip", "-selection", "clipboard"] as const, ["xsel", "--clipboard", "--input"] as const]
			: []

export type ClipboardCopyResult = "copied" | "sent-osc52"

const unknownErrorMessage = (error: unknown) => {
	if (error instanceof Error && error.message.length > 0) return error.message
	return String(error)
}

const errorDetail = (error: unknown) => {
	if (typeof error === "object" && error !== null) {
		const detail = "detail" in error ? (error as { readonly detail?: unknown }).detail : undefined
		if (typeof detail === "string" && detail.length > 0) return detail
		const message = "message" in error ? (error as { readonly message?: unknown }).message : undefined
		if (typeof message === "string" && message.length > 0) return message
	}
	return unknownErrorMessage(error)
}

const commandLabel = (command: string, args: readonly string[]) => [command, ...args].join(" ")

const osc52FailureDetail = (cause: unknown, commandFailures: readonly string[]) => {
	const osc52Detail = `Failed to send OSC52 clipboard sequence: ${unknownErrorMessage(cause)}`
	if (commandFailures.length === 0) return osc52Detail
	return `Clipboard tools failed (${commandFailures.join("; ")}); ${osc52Detail}`
}

const copyWithOsc52 = (text: string, commandFailures: readonly string[]) =>
	Effect.try({
		try() {
			writeOsc52(text)
			return "sent-osc52" as const
		},
		catch: (cause) => new ClipboardError({ detail: osc52FailureDetail(cause, commandFailures) }),
	})

const writeOsc52 = (text: string) => {
	const sequence = `\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`
	if (process.env.TMUX) {
		process.stdout.write(`\x1bPtmux;${sequence.split("\x1b").join("\x1b\x1b")}\x1b\\`)
		return
	}
	process.stdout.write(sequence)
}

export class Clipboard extends Context.Service<
	Clipboard,
	{
		readonly copy: (text: string) => Effect.Effect<ClipboardCopyResult, ClipboardError>
	}
>()("ghui/Clipboard") {
	static readonly layerNoDeps = Layer.effect(
		Clipboard,
		Effect.gen(function* () {
			const command = yield* CommandRunner

			const copy = Effect.fn("Clipboard.copy")(function* (text: string) {
				if (clipboardCommands.length === 0) {
					return yield* copyWithOsc52(text, [])
				}
				const commandFailures: string[] = []
				for (const [cmd, ...args] of clipboardCommands) {
					const result = yield* command.run(cmd, args, { stdin: text }).pipe(Effect.result)
					if (result._tag === "Success") return "copied"
					const failure = errorDetail(result.failure)
					commandFailures.push(`${commandLabel(cmd, args)}: ${failure}`)
				}
				return yield* copyWithOsc52(text, commandFailures)
			})

			return Clipboard.of({ copy })
		}),
	)

	static readonly layer = Clipboard.layerNoDeps.pipe(Layer.provide(CommandRunner.layer))
}
