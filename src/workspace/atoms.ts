import * as Atom from "effect/unstable/reactivity/Atom"
import { CacheService, type RepoRollupRow } from "../services/CacheService.js"
import { githubRuntime, initialRecentRepositories } from "../services/runtime.js"
import type { ViewerId, WorkspacePreferences } from "../workspacePreferences.js"
import { repositoryWorkspaceSurfaces, userWorkspaceSurfaces, type WorkspaceSurface } from "../workspaceSurfaces.js"
import { userWorkspaceScope, workspaceScopeRepository, type WorkspaceScope } from "../workspaceScope.js"

export const workspaceSurfaceAtom = Atom.make<WorkspaceSurface>("pullRequests")
export const workspaceScopeAtom = Atom.make<WorkspaceScope>(userWorkspaceScope).pipe(Atom.keepAlive)
export const selectedRepositoryAtom = Atom.make((get) => workspaceScopeRepository(get(workspaceScopeAtom)))
export const selectedRepositoryIndexAtom = Atom.make(0)
export const favoriteRepositoriesAtom = Atom.make<Record<string, true>>({}).pipe(Atom.keepAlive)
export const recentRepositoriesAtom = Atom.make<readonly string[]>(initialRecentRepositories).pipe(Atom.keepAlive)

// Which surface tabs are visible right now: the repo-scoped subset when a
// repository is selected, the full user-level set otherwise. Commands that
// gate on "is this surface even reachable from here?" read this.
export const workspaceTabSurfacesAtom = Atom.make((get): readonly WorkspaceSurface[] => (get(selectedRepositoryAtom) ? repositoryWorkspaceSurfaces : userWorkspaceSurfaces))

export const readWorkspacePreferencesAtom = githubRuntime.fn<ViewerId>()((viewer) => CacheService.use((cache) => cache.readWorkspacePreferences(viewer)))
export const writeWorkspacePreferencesAtom = githubRuntime.fn<WorkspacePreferences>()((preferences) => CacheService.use((cache) => cache.writeWorkspacePreferences(preferences)))

// Aggregates cached PRs and issues by repository for the given viewer. Lets
// the Repos tab render counts + last activity from cache before the live PR
// and issue queues resolve. Returns an empty list if the cache is disabled.
export const readRepoRollupAtom = githubRuntime.fn<string>()((viewer) => CacheService.use((cache) => cache.readRepoRollup(viewer)))

// Hydrated by `useRepoRollupHydration` once the viewer is known. Consumed by
// the repo list derivation in `App.tsx` to seed counts + last activity before
// the live PR/issue queries land.
export const repoRollupAtom = Atom.make<readonly RepoRollupRow[]>([]).pipe(Atom.keepAlive)
