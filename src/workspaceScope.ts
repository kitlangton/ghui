export type WorkspaceScope = { readonly _tag: "User" } | { readonly _tag: "Repository"; readonly repository: string }

export const userWorkspaceScope: WorkspaceScope = { _tag: "User" }

export const workspaceScopeForRepository = (repository: string | null): WorkspaceScope => (repository === null ? userWorkspaceScope : { _tag: "Repository", repository })

export const workspaceScopeRepository = (scope: WorkspaceScope): string | null => (scope._tag === "Repository" ? scope.repository : null)
