import { Context, Effect, Layer } from "effect"
import type { PullRequestItem } from "../domain.js"
import { CommandRunner, type CommandError } from "./CommandRunner.js"

export class BrowserOpener extends Context.Service<BrowserOpener, {
	readonly openPullRequest: (pullRequest: PullRequestItem) => Effect.Effect<void, CommandError>
	readonly openUrl: (url: string) => Effect.Effect<void, CommandError>
}>()("ghui/BrowserOpener") {
	static readonly layerNoDeps = Layer.effect(
		BrowserOpener,
		Effect.gen(function*() {
			const command = yield* CommandRunner
			const opener = process.platform === "darwin" ? "open" : "xdg-open"

			const openPullRequest = Effect.fn("BrowserOpener.openPullRequest")(function*(pullRequest: PullRequestItem) {
				yield* command.run("gh", ["pr", "view", String(pullRequest.number), "--repo", pullRequest.repository, "--web"])
			})

			const openUrl = Effect.fn("BrowserOpener.openUrl")(function*(url: string) {
				yield* command.run(opener, [url])
			})

			return BrowserOpener.of({ openPullRequest, openUrl })
		}),
	)

	static readonly layer = BrowserOpener.layerNoDeps.pipe(Layer.provide(CommandRunner.layer))
}
