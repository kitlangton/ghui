import { useEffect } from "react"
import { registerHandoff } from "../commands/handoffs.js"
import type { PullRequestItem } from "../domain.js"
import type { PullRequestView } from "../pullRequestViews.js"

export interface UseCommandHandoffsInput {
	readonly renderer: { destroy: () => void }
	readonly selectedPullRequest: PullRequestItem | null
	readonly selectedRepository: string | null
	readonly refreshPullRequests: (message?: string, options?: { readonly resetTransientState?: boolean }) => void
	readonly loadMorePullRequests: () => boolean | Promise<void> | void
	readonly loadPullRequestDiff: (pr: PullRequestItem, options?: { readonly force?: boolean; readonly includeComments?: boolean }) => void
	readonly flashNotice: (message: string) => void
	readonly switchViewTo: (view: PullRequestView) => void
	readonly openThemeModal: () => void
	readonly openMergeModal: () => void
	readonly openCommentsView: () => void
	readonly openDiffView: () => void
	readonly openChangedFilesModal: () => void
	readonly jumpDiffFile: (direction: 1 | -1) => void
	readonly moveDiffCommentThread: (direction: 1 | -1) => void
	readonly openSelectedDiffComment: () => void
	readonly toggleDiffCommentRange: () => void
	readonly openDiffCommentModal: () => void
	readonly openReplyToSelectedComment: () => void
	readonly openEditSelectedComment: () => void
	readonly openDeleteSelectedComment: () => void
}

/**
 * Connects hook-bound imperative actions to the new command registry.
 * Each registerHandoff installs a no-arg fn closing over current state;
 * command Effects invoke them via Effect.sync(() => invokeHandoff(key)).
 *
 * Centralizing this here keeps App.tsx free of ~25 useEffect lines and
 * makes the bridge between hooks and commands a single seam.
 */
export const useCommandHandoffs = ({
	renderer,
	selectedPullRequest,
	selectedRepository,
	refreshPullRequests,
	loadMorePullRequests,
	loadPullRequestDiff,
	flashNotice,
	switchViewTo,
	openThemeModal,
	openMergeModal,
	openCommentsView,
	openDiffView,
	openChangedFilesModal,
	jumpDiffFile,
	moveDiffCommentThread,
	openSelectedDiffComment,
	toggleDiffCommentRange,
	openDiffCommentModal,
	openReplyToSelectedComment,
	openEditSelectedComment,
	openDeleteSelectedComment,
}: UseCommandHandoffsInput): void => {
	useEffect(() => registerHandoff("quit", () => renderer.destroy()), [renderer])
	useEffect(() => registerHandoff("refreshPullRequests", () => refreshPullRequests("Refreshed", { resetTransientState: true })), [refreshPullRequests])
	useEffect(() => registerHandoff("loadMorePullRequests", () => void loadMorePullRequests()), [loadMorePullRequests])
	useEffect(() => registerHandoff("openThemeModal", openThemeModal), [openThemeModal])
	useEffect(() => registerHandoff("openMergeModal", openMergeModal), [openMergeModal])
	useEffect(() => registerHandoff("openCommentsView", openCommentsView), [openCommentsView])
	useEffect(() => registerHandoff("openDiffView", openDiffView), [openDiffView])
	useEffect(
		() =>
			registerHandoff("reloadDiff", () => {
				if (!selectedPullRequest) return
				loadPullRequestDiff(selectedPullRequest, { force: true, includeComments: true })
				flashNotice(`Refreshing diff for #${selectedPullRequest.number}`)
			}),
		[selectedPullRequest, loadPullRequestDiff, flashNotice],
	)
	useEffect(() => registerHandoff("openChangedFilesModal", openChangedFilesModal), [openChangedFilesModal])
	useEffect(() => registerHandoff("jumpDiffFileNext", () => jumpDiffFile(1)), [jumpDiffFile])
	useEffect(() => registerHandoff("jumpDiffFilePrevious", () => jumpDiffFile(-1)), [jumpDiffFile])
	useEffect(() => registerHandoff("moveDiffCommentThreadNext", () => moveDiffCommentThread(1)), [moveDiffCommentThread])
	useEffect(() => registerHandoff("moveDiffCommentThreadPrevious", () => moveDiffCommentThread(-1)), [moveDiffCommentThread])
	useEffect(() => registerHandoff("openSelectedDiffComment", openSelectedDiffComment), [openSelectedDiffComment])
	useEffect(() => registerHandoff("toggleDiffCommentRange", toggleDiffCommentRange), [toggleDiffCommentRange])
	useEffect(() => registerHandoff("openDiffCommentModal", openDiffCommentModal), [openDiffCommentModal])
	useEffect(() => registerHandoff("openReplyToSelectedComment", openReplyToSelectedComment), [openReplyToSelectedComment])
	useEffect(() => registerHandoff("openEditSelectedComment", openEditSelectedComment), [openEditSelectedComment])
	useEffect(() => registerHandoff("openDeleteSelectedComment", openDeleteSelectedComment), [openDeleteSelectedComment])
	useEffect(
		() =>
			registerHandoff("viewRepository", () => {
				if (selectedRepository !== null) switchViewTo({ _tag: "Repository", repository: selectedRepository })
			}),
		[selectedRepository, switchViewTo],
	)
	useEffect(() => registerHandoff("viewAuthored", () => switchViewTo({ _tag: "Queue", mode: "authored", repository: selectedRepository })), [selectedRepository, switchViewTo])
	useEffect(() => registerHandoff("viewReview", () => switchViewTo({ _tag: "Queue", mode: "review", repository: selectedRepository })), [selectedRepository, switchViewTo])
	useEffect(() => registerHandoff("viewAssigned", () => switchViewTo({ _tag: "Queue", mode: "assigned", repository: selectedRepository })), [selectedRepository, switchViewTo])
	useEffect(() => registerHandoff("viewMentioned", () => switchViewTo({ _tag: "Queue", mode: "mentioned", repository: selectedRepository })), [selectedRepository, switchViewTo])
}
