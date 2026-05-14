import { useAtomSet } from "@effect/atom-react"
import type * as Atom from "effect/unstable/reactivity/Atom"
import type { PullRequestItem, PullRequestReviewComment } from "../domain.js"
import { errorMessage } from "../errors.js"
import { diffCommentsLoadedAtom, pullRequestDiffAtom, pullRequestDiffCacheAtom } from "../ui/diff/atoms.js"
import { PullRequestDiffState, pullRequestDiffKey, splitPatchFiles, type PullRequestDiffState as PullRequestDiffStateType } from "../ui/diff.js"
import { groupDiffCommentThreads, isLocalDiffComment } from "../ui/diff/comments.js"

type LoadStatus = "loading" | "ready"

interface AtomRegistryShape {
	get<T>(atom: Atom.Atom<T>): T
	refresh(atom: unknown): void
}

export interface UseDiffLoaderInput {
	readonly registry: AtomRegistryShape
	readonly setPullRequestDiffCache: (next: (prev: Record<string, PullRequestDiffStateType>) => Record<string, PullRequestDiffStateType>) => void
	readonly setDiffCommentsLoaded: (next: (prev: Record<string, LoadStatus>) => Record<string, LoadStatus>) => void
	readonly setDiffCommentThreads: (next: (prev: Record<string, readonly PullRequestReviewComment[]>) => Record<string, readonly PullRequestReviewComment[]>) => void
	readonly listPullRequestReviewComments: (input: { repository: string; number: number }) => Promise<readonly PullRequestReviewComment[]>
	readonly flashNotice: (msg: string) => void
}

export interface DiffLoader {
	readonly loadPullRequestReviewComments: (pullRequest: PullRequestItem, force?: boolean) => void
	readonly loadPullRequestDiff: (pullRequest: PullRequestItem, options?: { readonly force?: boolean; readonly includeComments?: boolean }) => void
}

/**
 * Loads the patch text for a PR (via `pullRequestDiffAtom`, a
 * `runtime.fn`) and its review-comment threads. Threads are merged so
 * optimistic local comments survive a server refresh; the local-comment
 * heuristic is `isLocalDiffComment(comment)`. Both loaders dedupe via
 * the cache state — cached Loading/Ready is reused unless `force` is
 * set.
 */
export const useDiffLoader = ({
	registry,
	setPullRequestDiffCache,
	setDiffCommentsLoaded,
	setDiffCommentThreads,
	listPullRequestReviewComments,
	flashNotice,
}: UseDiffLoaderInput): DiffLoader => {
	const fetchDiff = useAtomSet(pullRequestDiffAtom, { mode: "promise" })
	const loadPullRequestReviewComments = (pullRequest: PullRequestItem, force = false) => {
		const key = pullRequestDiffKey(pullRequest)
		const previousLoadState = registry.get(diffCommentsLoadedAtom)[key]
		if (!force && previousLoadState) return
		setDiffCommentsLoaded((current) => ({ ...current, [key]: "loading" }))
		void listPullRequestReviewComments({ repository: pullRequest.repository, number: pullRequest.number })
			.then((comments) => {
				setDiffCommentsLoaded((current) => ({ ...current, [key]: "ready" }))
				setDiffCommentThreads((current) => {
					const prefix = `${key}:`
					const threads = groupDiffCommentThreads(pullRequest, comments)
					const next: Record<string, readonly PullRequestReviewComment[]> = Object.fromEntries(Object.entries(current).filter(([threadKey]) => !threadKey.startsWith(prefix)))
					for (const [threadKey, threadComments] of Object.entries(current)) {
						if (!threadKey.startsWith(prefix)) continue
						const localComments = threadComments.filter(isLocalDiffComment)
						if (localComments.length > 0) {
							next[threadKey] = [...(threads[threadKey] ?? []), ...localComments]
						}
					}
					for (const [threadKey, threadComments] of Object.entries(threads)) {
						if (!next[threadKey]) next[threadKey] = threadComments
					}
					return next
				})
			})
			.catch((error) => {
				setDiffCommentsLoaded((current) => {
					if (previousLoadState === "ready") return { ...current, [key]: previousLoadState }
					const next = { ...current }
					delete next[key]
					return next
				})
				flashNotice(errorMessage(error))
			})
	}

	const loadPullRequestDiff = (pullRequest: PullRequestItem, options: { readonly force?: boolean; readonly includeComments?: boolean } = {}) => {
		const force = options.force ?? false
		const includeComments = options.includeComments ?? false
		const key = pullRequestDiffKey(pullRequest)
		const existing = registry.get(pullRequestDiffCacheAtom)[key]
		if (includeComments) loadPullRequestReviewComments(pullRequest, force)
		if (!force && existing && (existing._tag === "Ready" || existing._tag === "Loading")) return

		setPullRequestDiffCache((current) => ({ ...current, [key]: PullRequestDiffState.Loading() }))
		void fetchDiff({ repository: pullRequest.repository, number: pullRequest.number })
			.then((patch) => {
				setPullRequestDiffCache((current) => ({
					...current,
					[key]: PullRequestDiffState.Ready({ patch, files: splitPatchFiles(patch) }),
				}))
			})
			.catch((error) => {
				setPullRequestDiffCache((current) => ({
					...current,
					[key]: PullRequestDiffState.Error({ error: errorMessage(error) }),
				}))
				flashNotice(errorMessage(error))
			})
	}

	return { loadPullRequestReviewComments, loadPullRequestDiff }
}
