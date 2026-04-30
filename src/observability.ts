import { Config, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { OtlpLogger, OtlpSerialization, OtlpTracer } from "effect/unstable/observability"

const observabilityConfig = Config.all({
	endpoint: Config.string("GHUI_OTLP_ENDPOINT").pipe(
		Config.withDefault(""),
		Config.map((value) => value.trim()),
	),
	motelPort: Config.string("GHUI_MOTEL_PORT").pipe(
		Config.withDefault(""),
		Config.map((value) => value.trim()),
	),
})

const resource = {
	serviceName: "ghui",
	serviceVersion: "local",
}

export const Observability = {
	layer: Layer.unwrap(Effect.gen(function*() {
		const { endpoint, motelPort } = yield* observabilityConfig
		const baseUrl = endpoint || (motelPort ? `http://127.0.0.1:${motelPort}` : null)

		return baseUrl === null
			? Layer.empty
			: Layer.merge(
				OtlpTracer.layer({
					url: `${baseUrl}/v1/traces`,
					exportInterval: "500 millis",
					shutdownTimeout: "1 second",
					resource,
				}),
				OtlpLogger.layer({
					url: `${baseUrl}/v1/logs`,
					exportInterval: "500 millis",
					shutdownTimeout: "1 second",
					resource,
				}),
			).pipe(
				Layer.provide(OtlpSerialization.layerJson),
				Layer.provide(FetchHttpClient.layer),
			)
	})),
} as const
