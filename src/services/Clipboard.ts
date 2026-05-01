import { Context, Effect, Layer, Schema } from "effect"
import { CommandRunner } from "./CommandRunner.js"

export class ClipboardError extends Schema.TaggedErrorClass<ClipboardError>()("ClipboardError", {
	detail: Schema.String,
}) {}

const clipboardCommands = (): readonly (readonly [string, ...readonly string[]])[] => {
	if (process.platform === "darwin") return [["pbcopy"]]
	if (process.platform === "linux") {
		return [
			...(process.env.WAYLAND_DISPLAY ? [["wl-copy"] as const] : []),
			["xclip", "-selection", "clipboard"],
			["xsel", "--clipboard", "--input"],
		]
	}
	return []
}

const installHint = process.platform === "linux" ? " Install wl-clipboard, xclip, or xsel." : ""

export class Clipboard extends Context.Service<Clipboard, {
	readonly copy: (text: string) => Effect.Effect<void, ClipboardError>
}>()("ghui/Clipboard") {
	static readonly layerNoDeps = Layer.effect(
		Clipboard,
		Effect.gen(function*() {
			const command = yield* CommandRunner

			const copy = Effect.fn("Clipboard.copy")(function*(text: string) {
				const commands = clipboardCommands()
				if (commands.length === 0) {
					return yield* new ClipboardError({ detail: `Clipboard is not available.${installHint}` })
				}

				let lastDetail = ""
				for (const [cmd, ...args] of commands) {
					const result = yield* command.run(cmd, args, { stdin: text }).pipe(Effect.result)
					if (result._tag === "Success") return
					lastDetail = result.failure.detail
				}
				return yield* new ClipboardError({ detail: lastDetail || `Clipboard is not available.${installHint}` })
			})

			return Clipboard.of({ copy })
		}),
	)

	static readonly layer = Clipboard.layerNoDeps.pipe(Layer.provide(CommandRunner.layer))
}
