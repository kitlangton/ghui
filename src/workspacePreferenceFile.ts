import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { Effect, Schema } from "effect"
import { WorkspacePreferences, type ViewerId, type WorkspacePreferencesInput } from "./workspacePreferences.js"

export const readWorkspacePreferencesFile = (path: string, viewer: ViewerId): Effect.Effect<WorkspacePreferences | null> =>
	Effect.tryPromise(async () => {
		try {
			const text = await readFile(path, "utf8")
			const preferences = Schema.decodeUnknownSync(WorkspacePreferences)(JSON.parse(text))
			return preferences.viewer === viewer ? preferences : null
		} catch {
			return null
		}
	}).pipe(Effect.catchCause(() => Effect.succeed(null)))

export const writeWorkspacePreferencesFile = (path: string, input: WorkspacePreferencesInput | WorkspacePreferences): Effect.Effect<void> =>
	Effect.tryPromise(async () => {
		const preferences = input instanceof WorkspacePreferences ? input : new WorkspacePreferences(input)
		await mkdir(dirname(path), { recursive: true })
		await writeFile(path, `${JSON.stringify(preferences, null, "\t")}\n`, "utf8")
	}).pipe(Effect.catchCause(() => Effect.void))
