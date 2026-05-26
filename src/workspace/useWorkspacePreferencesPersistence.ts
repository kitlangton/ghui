import { Effect } from "effect"
import { useEffect, useState } from "react"
import { readWorkspacePreferencesFile, writeWorkspacePreferencesFile } from "../workspacePreferenceFile.js"
import { makeWorkspacePreferences, repositoryId, viewerId, type WorkspacePreferences } from "../workspacePreferences.js"

const MAX_RECENT_REPOSITORIES = 20

export interface UseWorkspacePreferencesPersistenceInput {
	readonly username: string | null
	readonly favoriteRepositories: Record<string, true>
	readonly recentRepositories: readonly string[]
	readonly mockPath: string | null
	readonly readPreferences: (viewer: ReturnType<typeof viewerId>) => Promise<WorkspacePreferences | null | undefined>
	readonly writePreferences: (preferences: WorkspacePreferences) => Promise<unknown>
	readonly setFavoriteRepositories: (next: Record<string, true>) => void
	readonly setRecentRepositories: (next: readonly string[]) => void
}

/**
 * On username change, loads stored workspace preferences (favorites + recent
 * repositories) and applies them. Once load completes, persists changes back
 * to storage whenever favorites or recents change. The mock path branch reads
 * and writes via a JSON file instead of the cache service.
 */
export const useWorkspacePreferencesPersistence = ({
	username,
	favoriteRepositories,
	recentRepositories,
	mockPath,
	readPreferences,
	writePreferences,
	setFavoriteRepositories,
	setRecentRepositories,
}: UseWorkspacePreferencesPersistenceInput): void => {
	const [loadedViewer, setLoadedViewer] = useState<string | null>(null)

	useEffect(() => {
		if (!username) return
		let cancelled = false
		const viewer = viewerId(username)
		setLoadedViewer(null)
		const loadPreferences = mockPath ? Effect.runPromise(readWorkspacePreferencesFile(mockPath, viewer)) : readPreferences(viewer)
		void loadPreferences
			.then((preferences) => {
				if (cancelled) return
				if (preferences) {
					setFavoriteRepositories(Object.fromEntries(preferences.favoriteRepositories.map((repository) => [repository, true])))
					setRecentRepositories(preferences.recentRepositories)
				}
				setLoadedViewer(username)
			})
			.catch(() => {
				// Do not enable writes after a failed read: writing the startup
				// defaults here would overwrite persisted favorites and recents.
			})
		return () => {
			cancelled = true
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [username, readPreferences])

	useEffect(() => {
		if (!username || loadedViewer !== username) return
		const preferences = makeWorkspacePreferences({
			viewer: viewerId(username),
			favoriteRepositories: Object.keys(favoriteRepositories).map(repositoryId),
			recentRepositories: recentRepositories.map(repositoryId).slice(0, MAX_RECENT_REPOSITORIES),
		})
		const savePreferences = mockPath ? Effect.runPromise(writeWorkspacePreferencesFile(mockPath, preferences)) : writePreferences(preferences)
		void savePreferences.catch(() => undefined)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [favoriteRepositories, recentRepositories, username, loadedViewer, writePreferences])
}
