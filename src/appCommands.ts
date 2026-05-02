import type { AppCommand } from "./commands.js"
import { defineCommand } from "./commands.js"
import type { LoadStatus, PullRequestItem } from "./domain.js"
import type { DiffView, DiffWrapMode } from "./ui/diff.js"
import { type PullRequestView, viewEquals, viewLabel, viewMode } from "./pullRequestViews.js"

interface AppCommandActions {
	readonly openCommandPalette: () => void
	readonly refreshPullRequests: (message?: string) => void
	readonly openFilter: () => void
	readonly clearFilter: () => void
	readonly openThemeModal: () => void
	readonly openRepositoryPicker: () => void
	readonly loadMorePullRequests: () => void
	readonly switchViewTo: (view: PullRequestView) => void
	readonly openDetails: () => void
	readonly closeDetails: () => void
	readonly openDiffView: () => void
	readonly closeDiffView: () => void
	readonly reloadDiff: () => void
	readonly toggleDiffRenderView: () => void
	readonly toggleDiffWrapMode: () => void
	readonly jumpDiffFile: (delta: 1 | -1) => void
	readonly toggleDiffCommentMode: () => void
	readonly openDiffCommentModal: () => void
	readonly togglePullRequestDraftStatus: () => void
	readonly openLabelModal: () => void
	readonly openMergeModal: () => void
	readonly openCloseModal: () => void
	readonly openPullRequestInBrowser: () => void
	readonly copyPullRequestMetadata: () => void
	readonly quit: () => void
}

interface BuildAppCommandsInput {
	readonly pullRequestStatus: LoadStatus
	readonly filterQuery: string
	readonly filterMode: boolean
	readonly selectedRepository: string | null
	readonly activeViews: readonly PullRequestView[]
	readonly activeView: PullRequestView
	readonly loadedPullRequestCount: number
	readonly hasMorePullRequests: boolean
	readonly isLoadingMorePullRequests: boolean
	readonly selectedPullRequest: PullRequestItem | null
	readonly detailFullView: boolean
	readonly diffFullView: boolean
	readonly diffReady: boolean
	readonly effectiveDiffRenderView: DiffView
	readonly diffWrapMode: DiffWrapMode
	readonly readyDiffFileCount: number
	readonly diffFileIndex: number
	readonly diffCommentMode: boolean
	readonly selectedDiffCommentAnchorLabel: string | null
	readonly actions: AppCommandActions
}

export const buildAppCommands = ({
	pullRequestStatus,
	filterQuery,
	filterMode,
	selectedRepository,
	activeViews,
	activeView,
	loadedPullRequestCount,
	hasMorePullRequests,
	isLoadingMorePullRequests,
	selectedPullRequest,
	detailFullView,
	diffFullView,
	diffReady,
	effectiveDiffRenderView,
	diffWrapMode,
	readyDiffFileCount,
	diffFileIndex,
	diffCommentMode,
	selectedDiffCommentAnchorLabel,
	actions,
}: BuildAppCommandsInput): readonly AppCommand[] => {
	const selectedPullRequestLabel = selectedPullRequest ? `#${selectedPullRequest.number} ${selectedPullRequest.repository}` : "No pull request selected"
	const noPullRequestReason = selectedPullRequest ? null : "Select a pull request first."
	const noOpenPullRequestReason = selectedPullRequest?.state === "open" ? null : selectedPullRequest ? "Pull request is not open." : noPullRequestReason
	const diffReadyReason = selectedPullRequest
		? diffReady ? null : "Load the diff before running this command."
		: noPullRequestReason
	const diffOpenReadyReason = diffFullView ? diffReadyReason : "Open a diff first."
	const loadMoreDisabledReason = isLoadingMorePullRequests
		? "Already loading more pull requests."
		: hasMorePullRequests ? null : "No more pull requests loaded by this view."

	const forSelected = (
		command: Omit<AppCommand, "subtitle" | "disabledReason"> & { readonly requireOpen?: boolean },
	): AppCommand => {
		const { requireOpen, ...rest } = command
		return defineCommand({
			...rest,
			subtitle: selectedPullRequestLabel,
			disabledReason: requireOpen ? noOpenPullRequestReason : noPullRequestReason,
		})
	}

	return [
		defineCommand({
			id: "command.open",
			title: "Open command palette",
			scope: "Global",
			subtitle: "Search every available route through ghui",
			shortcut: "ctrl-p/cmd-k",
			keywords: ["palette", "commands", "deck"],
			run: actions.openCommandPalette,
		}),
		defineCommand({
			id: "pull.refresh",
			title: pullRequestStatus === "error" ? "Retry loading pull requests" : "Refresh pull requests",
			scope: "Global",
			subtitle: "Fetch the latest queue from GitHub",
			shortcut: "r",
			keywords: ["reload", "sync"],
			run: () => actions.refreshPullRequests("Refreshed"),
		}),
		defineCommand({
			id: "filter.open",
			title: "Filter pull requests",
			scope: "Global",
			subtitle: "Search the visible queue",
			shortcut: "/",
			keywords: ["search"],
			run: actions.openFilter,
		}),
		defineCommand({
			id: "filter.clear",
			title: "Clear pull request filter",
			scope: "Global",
			subtitle: "Show every pull request in the current queue",
			shortcut: "esc",
			disabledReason: filterQuery.length > 0 || filterMode ? null : "No filter is active.",
			run: actions.clearFilter,
		}),
		defineCommand({
			id: "theme.open",
			title: "Choose theme",
			scope: "Global",
			subtitle: "Preview and persist a terminal color theme",
			shortcut: "t",
			keywords: ["colors", "appearance"],
			run: actions.openThemeModal,
		}),
		defineCommand({
			id: "repository.open",
			title: "Open repository...",
			scope: "View",
			subtitle: selectedRepository ? `Current repository: ${selectedRepository}` : "Enter owner/name or a GitHub URL",
			keywords: ["repo", "repository", "owner", "github"],
			run: actions.openRepositoryPicker,
		}),
		...activeViews.map((view) => defineCommand({
			id: view._tag === "Repository" ? "view.repository" : `view.${view.mode}`,
			title: `Show ${viewLabel(view)} view`,
			scope: "View" as const,
			subtitle: viewEquals(view, activeView) ? "Already showing this view" : "Switch pull request view",
			keywords: [viewMode(view), viewLabel(view), "queue", "view"],
			disabledReason: viewEquals(view, activeView) ? "Already showing this view." : null,
			run: () => actions.switchViewTo(view),
		})),
		defineCommand({
			id: "pull.load-more",
			title: "Load more pull requests",
			scope: "Navigation",
			subtitle: `${loadedPullRequestCount} loaded`,
			disabledReason: loadMoreDisabledReason,
			keywords: ["next page", "pagination", "more"],
			run: actions.loadMorePullRequests,
		}),
		forSelected({
			id: "detail.open",
			title: "Open pull request details",
			scope: "Pull request",
			shortcut: "enter",
			run: actions.openDetails,
		}),
		defineCommand({
			id: "detail.close",
			title: "Close details view",
			scope: "Pull request",
			subtitle: "Return to the queue",
			shortcut: "esc",
			disabledReason: detailFullView ? null : "Details view is not open.",
			run: actions.closeDetails,
		}),
		forSelected({
			id: "diff.open",
			title: "Open stacked diff",
			scope: "Diff",
			shortcut: "d",
			keywords: ["files", "patch"],
			run: actions.openDiffView,
		}),
		defineCommand({
			id: "diff.close",
			title: "Close diff view",
			scope: "Diff",
			subtitle: "Return to the queue or detail view",
			shortcut: "esc",
			disabledReason: diffFullView ? null : "Diff view is not open.",
			run: actions.closeDiffView,
		}),
		defineCommand({
			id: "diff.reload",
			title: "Reload diff",
			scope: "Diff",
			subtitle: selectedPullRequestLabel,
			shortcut: "r",
			disabledReason: diffFullView && selectedPullRequest ? null : "Open a pull request diff first.",
			keywords: ["refresh", "comments"],
			run: actions.reloadDiff,
		}),
		defineCommand({
			id: "diff.toggle-view",
			title: "Toggle diff split/unified view",
			scope: "Diff",
			subtitle: effectiveDiffRenderView === "split" ? "Switch to unified view" : "Switch to split view",
			shortcut: "v",
			disabledReason: diffFullView ? null : "Open a diff first.",
			run: actions.toggleDiffRenderView,
		}),
		defineCommand({
			id: "diff.toggle-wrap",
			title: "Toggle diff word wrap",
			scope: "Diff",
			subtitle: diffWrapMode === "none" ? "Wrap long diff lines" : "Keep diff lines unwrapped",
			shortcut: "w",
			disabledReason: diffFullView ? null : "Open a diff first.",
			run: actions.toggleDiffWrapMode,
		}),
		defineCommand({
			id: "diff.next-file",
			title: "Next diff file",
			scope: "Diff",
			subtitle: readyDiffFileCount > 0 ? `${diffFileIndex + 1}/${readyDiffFileCount}` : "No diff files loaded",
			shortcut: "]",
			disabledReason: diffFullView && readyDiffFileCount > 0 ? null : diffOpenReadyReason,
			run: () => actions.jumpDiffFile(1),
		}),
		defineCommand({
			id: "diff.previous-file",
			title: "Previous diff file",
			scope: "Diff",
			subtitle: readyDiffFileCount > 0 ? `${diffFileIndex + 1}/${readyDiffFileCount}` : "No diff files loaded",
			shortcut: "[",
			disabledReason: diffFullView && readyDiffFileCount > 0 ? null : diffOpenReadyReason,
			run: () => actions.jumpDiffFile(-1),
		}),
		defineCommand({
			id: "diff.comment-mode",
			title: diffCommentMode ? "Exit diff comment mode" : "Enter diff comment mode",
			scope: "Diff",
			subtitle: diffCommentMode ? "Return to diff scrolling" : "Choose a line to comment on",
			shortcut: "c",
			disabledReason: diffFullView && diffReady ? null : diffOpenReadyReason,
			keywords: ["review", "comment", "line"],
			run: actions.toggleDiffCommentMode,
		}),
		defineCommand({
			id: "diff.add-comment",
			title: "Add comment on selected diff line",
			scope: "Diff",
			subtitle: selectedDiffCommentAnchorLabel ?? "No diff line selected",
			shortcut: "a",
			disabledReason: diffCommentMode && selectedDiffCommentAnchorLabel ? null : "Enter diff comment mode and select a line first.",
			keywords: ["review", "reply"],
			run: actions.openDiffCommentModal,
		}),
		forSelected({
			id: "pull.toggle-draft",
			title: selectedPullRequest?.reviewStatus === "draft" ? "Mark ready for review" : "Mark as draft",
			scope: "Pull request",
			shortcut: "s",
			keywords: ["state", "ready"],
			run: actions.togglePullRequestDraftStatus,
		}),
		forSelected({
			id: "pull.labels",
			title: "Manage labels",
			scope: "Pull request",
			shortcut: "l",
			run: actions.openLabelModal,
		}),
		forSelected({
			id: "pull.merge",
			title: "Merge pull request",
			scope: "Pull request",
			shortcut: "m",
			keywords: ["auto merge", "squash"],
			run: actions.openMergeModal,
		}),
		forSelected({
			id: "pull.close",
			title: "Close pull request",
			scope: "Pull request",
			shortcut: "x",
			requireOpen: true,
			run: actions.openCloseModal,
		}),
		forSelected({
			id: "pull.open-browser",
			title: "Open pull request in browser",
			scope: "Pull request",
			shortcut: "o",
			keywords: ["github", "web"],
			run: actions.openPullRequestInBrowser,
		}),
		forSelected({
			id: "pull.copy-metadata",
			title: "Copy pull request metadata",
			scope: "Pull request",
			shortcut: "y",
			keywords: ["clipboard", "url", "title"],
			run: actions.copyPullRequestMetadata,
		}),
		defineCommand({
			id: "app.quit",
			title: "Quit ghui",
			scope: "System",
			subtitle: "Leave the terminal UI",
			shortcut: "q",
			keywords: ["exit"],
			run: actions.quit,
		}),
	]
}
