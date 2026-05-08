import { describe, expect, test } from "bun:test"
import { formatSequence } from "@ghui/keymap"
import { buildAppCommands } from "../src/appCommands.js"
import type { PullRequestItem } from "../src/domain.js"
import { detailViewKeymap } from "../src/keymap/detailView.js"
import { listNavKeymap } from "../src/keymap/listNav.js"

const activeView = { _tag: "Queue", mode: "review", repository: null } as const
const selectedPullRequest: PullRequestItem = {
	repository: "owner/repo",
	author: "kit",
	headRefOid: "abc123",
	headRefName: "feat/clipboard-copy",
	number: 42,
	title: "Review UX",
	body: "",
	labels: [],
	additions: 1,
	deletions: 1,
	changedFiles: 2,
	state: "open",
	reviewStatus: "review",
	checkStatus: "passing",
	checkSummary: "1/1",
	checks: [],
	autoMergeEnabled: false,
	detailLoaded: true,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	closedAt: null,
	url: "https://github.com/owner/repo/pull/42",
}

const noop = () => {}

const buildCommands = () =>
	buildAppCommands({
		pullRequestStatus: "ready",
		filterQuery: "",
		filterMode: false,
		selectedRepository: null,
		activeViews: [activeView],
		activeView,
		loadedPullRequestCount: 1,
		hasMorePullRequests: false,
		isLoadingMorePullRequests: false,
		selectedPullRequest,
		detailFullView: false,
		diffFullView: false,
		commentsViewActive: false,
		hasSelectedComment: false,
		canEditSelectedComment: false,
		diffReady: false,
		effectiveDiffRenderView: "split",
		diffWrapMode: "none",
		diffWhitespaceMode: "ignore",
		readyDiffFileCount: 0,
		diffFileIndex: 0,
		diffRangeActive: false,
		selectedDiffCommentAnchorLabel: null,
		selectedDiffCommentThreadCount: 0,
		hasDiffCommentThreads: false,
		actions: {
			openCommandPalette: noop,
			refreshPullRequests: noop,
			openFilter: noop,
			clearFilter: noop,
			openThemeModal: noop,
			openRepositoryPicker: noop,
			loadMorePullRequests: noop,
			switchViewTo: noop,
			openDetails: noop,
			closeDetails: noop,
			openDiffView: noop,
			closeDiffView: noop,
			openCommentsView: noop,
			closeCommentsView: noop,
			openNewIssueCommentModal: noop,
			openReplyToSelectedComment: noop,
			openEditSelectedComment: noop,
			openDeleteSelectedComment: noop,
			reloadDiff: noop,
			toggleDiffRenderView: noop,
			toggleDiffWrapMode: noop,
			toggleDiffWhitespaceMode: noop,
			openChangedFilesModal: noop,
			jumpDiffFile: noop,
			openSelectedDiffComment: noop,
			toggleDiffCommentRange: noop,
			moveDiffCommentThread: noop,
			openDiffCommentModal: noop,
			openSubmitReviewModal: noop,
			openPullRequestStateModal: noop,
			openLabelModal: noop,
			openMergeModal: noop,
			openCloseModal: noop,
			openPullRequestInBrowser: noop,
			copyPullRequestMetadata: noop,
			copyPullRequestUrl: noop,
			quit: noop,
		},
	})

describe("copy commands", () => {
	test("remain available in the command palette with copy shortcut labels", () => {
		const commands = buildCommands()
		const metadata = commands.find((command) => command.id === "pull.copy-metadata")
		const url = commands.find((command) => command.id === "pull.copy-url")

		expect(metadata?.shortcut).toBe("y")
		expect(metadata?.disabledReason).toBeFalsy()
		expect(url?.shortcut).toBe("shift-y")
		expect(url?.disabledReason).toBeFalsy()
	})

	test("stay bound to y/Y in list and detail views", () => {
		const listBindings = [...listNavKeymap].map((binding) => formatSequence(binding.sequence))
		const detailBindings = [...detailViewKeymap].map((binding) => formatSequence(binding.sequence))

		expect(listBindings).toContain("y")
		expect(listBindings).toContain("shift+y")
		expect(detailBindings).toContain("y")
		expect(detailBindings).toContain("shift+y")
	})
})
