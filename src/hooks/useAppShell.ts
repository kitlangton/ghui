import { RegistryContext, useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useRenderer, useTerminalDimensions } from "@opentui/react"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { useContext, useEffect, useRef, useState } from "react"
import type { AppCommand } from "../commands.js"
import { parseRepositoryInput } from "../pullRequestViews.js"

import { colors } from "../ui/colors.js"
import { workspaceSurfaceAtom } from "../workspace/atoms.js"
import { useRepoSurface } from "../surfaces/repo/useRepoSurface.js"
import { usePullRequestSurface } from "../surfaces/pullRequest/usePullRequestSurface.js"
import { computeLayout, diffFilePanelWidthFor } from "../workspace/layout.js"
import { getDetailPlaceholderContent, reviewStatusAfterSubmit } from "../workspace/placeholders.js"
import { computeModalLayouts } from "../workspace/modalLayouts.js"
import { computeWorkspaceDerivations } from "../workspace/derivations.js"
import { computeFooterProps } from "../workspace/footerProps.js"
import { computeHeaderDerivations, groupIndexAt } from "../workspace/headerDerivations.js"
import { useWorkspacePreferencesPersistence } from "../workspace/useWorkspacePreferencesPersistence.js"
import { commentsRowCountAtom, orderedCommentsAtom, pullRequestCommentsAtom, pullRequestCommentsLoadedAtom, selectedOrderedCommentAtom } from "../ui/comments/atoms.js"
import { useIssueSurface } from "../surfaces/issue/useIssueSurface.js"
import { filterDraftAtom, filterModeAtom, filterQueryAtom } from "../ui/filter/atoms.js"
import { selectedIndexAtom } from "../ui/listSelection/atoms.js"
import { noticeAtom } from "../ui/notice/atoms.js"
import { useFlashNotice } from "../ui/notice/useFlashNotice.js"
import { useCommentMutations } from "../ui/comments/useCommentMutations.js"
import { pullRequestDetailKey, queueSelectionAtom, usernameAtom } from "../ui/pullRequests/atoms.js"

import { useGitHubActions } from "./useGitHubActions.js"
import { useImperativeActions } from "./useImperativeActions.js"
import { useScrollRefs } from "./useScrollRefs.js"
import { useCommentsLoader } from "./useCommentsLoader.js"
import { useCommentsViewActions } from "./useCommentsViewActions.js"
import { useDiffLoader } from "./useDiffLoader.js"
import { useLinkNavigation } from "./useLinkNavigation.js"
import { useLoadingStatus } from "./useLoadingStatus.js"
import { useCommandRegistry } from "./useCommandRegistry.js"
import { useListSelectionStepping } from "./useListSelectionStepping.js"
import { useModalSelectionMovers } from "./useModalSelectionMovers.js"
import { useAppKeymap } from "./useAppKeymap.js"
import { useModalStack } from "./useModalStack.js"
import { useItemMutations } from "../item/useItemMutations.js"
import { useSelectionDerivations } from "./useSelectionDerivations.js"
import { useStartupTasks } from "./useStartupTasks.js"
import { usePasteRouter } from "./usePasteRouter.js"
import { useWorkspaceNavigation } from "./useWorkspaceNavigation.js"
import { useDiffSelectionSync } from "./useDiffSelectionSync.js"
import { useDiffViewState } from "./useDiffViewState.js"
import { useViewModeState } from "./useViewModeState.js"
import { useFilterModal } from "../ui/filter/useFilterModal.js"
import { DIFF_FILE_PANEL_AUTO_THRESHOLD, diffFilePanelOverrideAtom, selectedDiffKeyAtom, selectedDiffStateAtom } from "../ui/diff/atoms.js"
import { diffCommentThreadMapKey } from "../ui/diff/comments.js"
import { useDiffLineColors } from "../ui/diff/useDiffLineColors.js"
import { useDiffLocationPreservation } from "../ui/diff/useDiffLocationPreservation.js"
import { useDiffPrefetch } from "../ui/diff/useDiffPrefetch.js"
import { themeIdAtom } from "../ui/theme/atoms.js"
import { useThemeModal } from "../ui/theme/useThemeModal.js"
import { useMergeFlow } from "../ui/merge/useMergeFlow.js"
import { initialCommentModalState, submitReviewOptions } from "../ui/modals.js"
import { useClampedIndex } from "../ui/useClampedIndex.js"
import { useCommandHandoffs } from "./useCommandHandoffs.js"
import { useDiffCommentDerivations } from "./useDiffCommentDerivations.js"
import { useDiffCommentNavigator } from "./useDiffCommentNavigator.js"
import { useItemModalActions } from "../item/useItemModalActions.js"
import { repositoryWorkspaceSurfaces, userWorkspaceSurfaces, type WorkspaceSurface } from "../workspaceSurfaces.js"
import { detectedRepository, mockRepositoryCatalog, mockWorkspacePreferencesPath } from "../services/runtime.js"

export interface UseAppShellInput {
	readonly systemThemeGeneration: number
}

export const useAppShell = ({ systemThemeGeneration }: UseAppShellInput) => {
	const renderer = useRenderer()
	const { width, height } = useTerminalDimensions()
	const registry = useContext(RegistryContext)

	const setQueueSelection = useAtomSet(queueSelectionAtom)
	const [selectedIndex, setSelectedIndex] = useAtom(selectedIndexAtom)
	const [notice, setNotice] = useAtom(noticeAtom)
	const [filterQuery, setFilterQuery] = useAtom(filterQueryAtom)
	const [filterDraft, setFilterDraft] = useAtom(filterDraftAtom)
	const [filterMode, setFilterMode] = useAtom(filterModeAtom)
	const {
		detailFullView,
		setDetailFullView,
		setDetailScrollOffset,
		diffFullView,
		setDiffFullView,
		commentsViewActive,
		setCommentsViewActive,
		commentsViewSelection,
		setCommentsViewSelection,
	} = useViewModeState()
	const {
		diffFileIndex,
		setDiffFileIndex,
		diffScrollTop,
		setDiffScrollTop,
		diffRenderView,
		setDiffRenderView,
		diffWrapMode,
		diffWhitespaceMode,
		diffCommentAnchorIndex,
		setDiffCommentAnchorIndex,
		diffPreferredSide,
		setDiffPreferredSide,
		diffCommentRangeStartIndex,
		setDiffCommentRangeStartIndex,
		diffCommentThreads,
		setDiffCommentThreads,
		setDiffCommentsLoaded,
		setPullRequestDiffCache,
	} = useDiffViewState()
	const setPullRequestComments = useAtomSet(pullRequestCommentsAtom)
	const setPullRequestCommentsLoaded = useAtomSet(pullRequestCommentsLoadedAtom)
	const themeId = useAtomValue(themeIdAtom)
	const {
		activeModal,
		closeActiveModal,
		labelModalActive,
		closeModalActive,
		pullRequestStateModalActive,
		mergeModalActive,
		commentModalActive,
		deleteCommentModalActive,
		commentThreadModalActive,
		changedFilesModalActive,
		filterModalActive,
		submitReviewModalActive,
		themeModalActive,
		commandPaletteActive,
		openRepositoryModalActive,
		labelModal,
		closeModal,
		pullRequestStateModal,
		mergeModal,
		commentModal,
		deleteCommentModal,
		changedFilesModal,
		filterModal,
		submitReviewModal,
		themeModal,
		commandPalette,
		openRepositoryModal,
		setLabelModal,
		setPullRequestStateModal,
		setMergeModal,
		setCommentModal,
		setDeleteCommentModal,
		setCommentThreadModal,
		setChangedFilesModal,
		setFilterModal,
		setSubmitReviewModal,
		setThemeModal,
		setCommandPalette,
		setOpenRepositoryModal,
	} = useModalStack()
	const [startupLoadComplete, setStartupLoadComplete] = useState(false)
	const [homeCrumbHovered, setHomeCrumbHovered] = useState(false)
	const usernameResult = useAtomValue(usernameAtom)
	const {
		addPullRequestLabel,
		removePullRequestLabel,
		addIssueLabel,
		removeIssueLabel,
		toggleDraftStatus,
		listPullRequestReviewComments,
		listPullRequestComments,
		listIssueComments,
		readWorkspacePreferences,
		writeWorkspacePreferences,
		pruneCache,
		prewarmRepositoryDetails,
		closePullRequest,
		closeIssue,
		refreshIssuesForView,
		submitPullRequestReview,
		openUrl,
		readRepoRollup,
	} = useGitHubActions()
	const terminalWidth = width ?? 100
	const terminalHeight = height ?? 24
	const showWorkspaceTabs = !detailFullView && !diffFullView && !commentsViewActive
	const diffFilePanelOverride = useAtomValue(diffFilePanelOverrideAtom)
	const setDiffFilePanelOverride = useAtomSet(diffFilePanelOverrideAtom)
	// Effective panel visibility: the override (true/false) wins if set, else
	// auto-show whenever the terminal has room. Either way it only matters in
	// diffFullView — the panel doesn't exist outside of the diff surface.
	const diffFilePanelAutoVisible = terminalWidth >= DIFF_FILE_PANEL_AUTO_THRESHOLD
	const diffFilePanelVisible = diffFullView && (diffFilePanelOverride ?? diffFilePanelAutoVisible)
	const layout = computeLayout({
		terminalWidth,
		terminalHeight,
		showWorkspaceTabs,
		showDiffFilePanel: diffFilePanelVisible,
		diffFilePanelWidth: diffFilePanelWidthFor(terminalWidth),
	})
	const {
		contentWidth,
		isWideLayout,
		leftPaneWidth,
		rightPaneWidth,
		rightContentWidth,
		dividerJunctionAt,
		wideBodyHeight,
		headerFooterWidth,
		fullscreenContentWidth,
		diffFilePanelEffectiveWidth,
		diffPaneWidth,
	} = layout
	const refreshGenerationRef = useRef(0)
	const {
		detailScrollRef,
		detailPreviewScrollRef,
		diffScrollRef,
		prListScrollRef,
		issueListScrollRef,
		prListScrollPersistedRef,
		issueListScrollPersistedRef,
		suppressNextDiffCommentScrollRef,
	} = useScrollRefs()

	const flashNotice = useFlashNotice()

	useEffect(() => {
		renderer.setBackgroundColor(colors.background)
	}, [renderer, themeId, systemThemeGeneration])

	const themeModalActions = useThemeModal({ themeModal, setThemeModal, closeActiveModal, flashNotice })

	useEffect(
		() => () => {
			refreshGenerationRef.current += 1
		},
		[],
	)

	const [activeWorkspaceSurface, setActiveWorkspaceSurface] = useAtom(workspaceSurfaceAtom)
	const visibleFilterText = filterMode ? filterDraft : filterQuery
	const username = AsyncResult.isSuccess(usernameResult) ? usernameResult.value : null

	const prSurface = usePullRequestSurface({
		renderer,
		refreshGenerationRef,
		username,
		selectedIndex,
		setSelectedIndex,
		setQueueSelection,
		filterMode,
		filterQuery,
		visibleFilterText,
		activeWorkspaceSurface,
		detailFullView,
		diffFullView,
		commentsViewActive,
		flashNotice,
		prListScrollRef,
		prListScrollPersistedRef,
	})
	const {
		pullRequestResult,
		pullRequestStatus,
		pullRequestError,
		activeView,
		setActiveView,
		activeViews,
		currentQueueCacheKey,
		pullRequestLoad,
		hasMorePullRequests,
		loadedPullRequestCount,
		loadMoreRowSelected,
		visibleHasMorePullRequests,
		loadMoreSlotAvailable,
		pullRequests,
		visiblePullRequests,
		visibleGroups,
		groupStarts,
		selectedPullRequest,
		selectedRepository,
		pullRequestActiveFilterLabel,
		pullRequestListRows,
		setPullRequestOverrides,
		setRecentlyCompletedPullRequests,
		retryProgress,
		loadMorePullRequests,
		isLoadingMorePullRequests,
		resetLoadingMore,
		cancelRefreshToast,
		refreshPullRequests,
		detailHydrationState,
		resetHydration,
		selectPullRequestByUrl,
	} = prSurface
	const isInitialLoading = !startupLoadComplete && pullRequestStatus === "loading" && pullRequests.length === 0

	const issueSurface = useIssueSurface({
		selectedRepository,
		username,
		visibleFilterText,
		activeWorkspaceSurface,
		detailFullView,
		diffFullView,
		commentsViewActive,
		refreshGenerationRef,
		flashNotice,
		issueListScrollRef,
		issueListScrollPersistedRef,
	})
	const {
		issues,
		allIssues,
		issueLoad,
		issuesStatus,
		issuesError,
		selectedIssue,
		selectedIssueIndex,
		setSelectedIssueIndex,
		activeIssueView,
		setActiveIssueView,
		hasMoreIssues,
		loadedIssueCount,
		loadMoreIssueRowSelected,
		issueLoadMoreSlotAvailable,
		issueActiveFilterLabel,
		setIssueOverrides,
		showIssueRepositoryGroups,
		loadMoreIssues,
		isLoadingMoreIssues,
		resetLoadingMoreIssues,
	} = issueSurface

	const workspaceTabSurfaces: readonly WorkspaceSurface[] = selectedRepository ? repositoryWorkspaceSurfaces : userWorkspaceSurfaces
	const repo = useRepoSurface({
		pullRequests,
		allIssues,
		visibleFilterText,
		activeWorkspaceSurface,
		detectedRepository,
		mockRepositoryCatalog,
		flashNotice,
	})
	const {
		repositoryItems,
		selectedRepositoryItem,
		selectedRepositoryDetails,
		selectedRepositoryIndex,
		setSelectedRepositoryIndex,
		favoriteRepositories,
		setFavoriteRepositories,
		recentRepositories,
		setRecentRepositories,
		setRepoRollup,
	} = repo
	const { toggleFavoriteRepository, removeSelectedRepository } = repo.actions
	const pullRequestComments = useAtomValue(pullRequestCommentsAtom)
	const selectedDiffKey = useAtomValue(selectedDiffKeyAtom)
	const selectedDiffState = useAtomValue(selectedDiffStateAtom)
	const {
		selectedCommentSubject,
		selectedCommentKey,
		selectedItemLabels,
		selectedComments,
		selectedCommentsStatus,
		selectedCommentCount,
		effectiveDiffRenderView,
		readyDiffFiles,
		changedFileResults,
	} = useSelectionDerivations({
		diffRenderView,
		contentWidth,
		changedFilesModalActive,
		changedFilesQuery: changedFilesModal.query,
		pullRequestListRows,
		loadMoreRowSelected,
	})
	const {
		displayedDiffState,
		stackedDiffFiles,
		diffCommentAnchors,
		selectedDiffCommentAnchorIndex,
		selectedDiffCommentAnchor,
		diffCommentRangeStartAnchor,
		selectedDiffCommentRange,
		selectedDiffCommentRangeAnchors,
		diffCommentRangeActive,
		selectedDiffCommentLabel,
		selectedDiffCommentThread,
		diffLineColorContextKey,
		diffCommentThreadAnchors,
	} = useDiffCommentDerivations({
		selectedDiffState,
		readyDiffFiles,
		effectiveDiffRenderView,
		diffWrapMode,
		diffWhitespaceMode,
		// When the docked file panel takes a slice, the diff renders at
		// `diffPaneWidth` — pass that so the split-view's OLD/NEW columns are
		// halved on the actual diff width, not the full terminal width.
		diffPaneWidth: diffFilePanelVisible ? diffPaneWidth : contentWidth,
		diffFullView,
		diffCommentAnchorIndex,
		diffCommentRangeStartIndex,
		selectedDiffKey,
		diffCommentThreads,
	})
	const getCurrentGroupIndex = (current: number) => groupIndexAt(groupStarts, current)
	const { headerRight, headerLeftWidth, footerNotice, homeCrumb, breadcrumbSeparatorText, headerRepoWidth } = computeHeaderDerivations({
		username,
		notice,
		headerFooterWidth,
		selectedRepository,
	})
	const { updatePullRequest, updateIssue, markPullRequestCompleted, restoreOptimisticPullRequest } = useItemMutations({
		pullRequests,
		issues,
		setPullRequestOverrides,
		setIssueOverrides,
		setRecentlyCompletedPullRequests,
	})

	const { switchViewTo, switchQueueMode, switchWorkspaceSurface, cycleWorkspaceSurface, goUpWorkspaceScope } = useWorkspaceNavigation({
		registry,
		activeView,
		activeViews,
		currentQueueCacheKey,
		selectedIndex,
		setSelectedIndex,
		setSelectedIssueIndex,
		setQueueSelection,
		setActiveView,
		setActiveIssueView,
		setDetailFullView,
		setDiffFullView,
		setCommentsViewActive,
		setDiffCommentRangeStartIndex,
		setFilterDraft,
		setFilterMode,
		setNotice,
		cancelRefreshToast,
		filterQuery,
		setRecentlyCompletedPullRequests,
		setActiveWorkspaceSurface,
		activeWorkspaceSurface,
		workspaceTabSurfaces,
		selectedRepository,
		refreshGenerationRef,
		resetHydration,
		resetLoadingMore,
	})
	const openSelectedRepository = () => {
		if (!selectedRepositoryItem) return
		switchViewTo({ _tag: "Repository", repository: selectedRepositoryItem.repository })
	}
	const { openFilterModal, moveFilterSelection, applySelectedFilter } = useFilterModal({
		activeWorkspaceSurface,
		activeView,
		activeIssueView,
		selectedRepository,
		filterModal,
		setFilterModal,
		switchViewTo,
		setActiveIssueView,
		closeActiveModal,
		setSelectedIssueIndex,
		resetLoadingMoreIssues,
		bumpRefreshGeneration: () => {
			refreshGenerationRef.current += 1
		},
	})
	const { loadPullRequestComments, loadIssueComments } = useCommentsLoader({
		refreshGenerationRef,
		readCommentsLoadState: () => registry.get(pullRequestCommentsLoadedAtom),
		setPullRequestComments,
		setPullRequestCommentsLoaded,
		listPullRequestComments,
		listIssueComments,
		flashNotice,
	})
	// View-change refetch is now driven by `pullRequestsAtom`'s reactive
	// dependency on `activeViewAtom`. `pullRequestLoadAtom` reads the in-memory
	// cache first, so the user sees the previous list instantly while the new
	// view's fetch lands.

	useClampedIndex(visiblePullRequests.length + (loadMoreSlotAvailable ? 1 : 0), setSelectedIndex)

	useWorkspacePreferencesPersistence({
		username,
		favoriteRepositories,
		recentRepositories,
		mockPath: mockWorkspacePreferencesPath,
		readPreferences: readWorkspacePreferences,
		writePreferences: writeWorkspacePreferences,
		setFavoriteRepositories,
		setRecentRepositories,
	})

	useStartupTasks({
		username,
		recentRepositories,
		favoriteRepositories,
		detectedRepository,
		pullRequestLoad,
		issueLoad,
		currentQueueCacheKey,
		selectedIndex,
		readRepoRollup,
		setRepoRollup,
		prewarmRepositoryDetails,
		pruneCache,
		setQueueSelection,
		issues,
		pullRequests,
	})

	// Keep list scroll position when toggling between surfaces. Each list's
	// scrollbox remounts on surface switch; without persistence it starts at
	// scrollTop=0 and useScrollFollowSelected snaps it back to the selected
	// row — reads as a jump.

	useDiffSelectionSync({
		selectedIndex,
		selectedIssueIndex,
		selectedRepositoryIndex,
		readyDiffFiles,
		diffCommentAnchors,
		diffFullView,
		selectedDiffCommentAnchor,
		detailPreviewScrollRef,
		setDiffFileIndex,
		setDiffScrollTop,
		setDiffCommentAnchorIndex,
		setDiffPreferredSide,
		setDiffCommentRangeStartIndex,
	})

	useDiffLocationPreservation({
		diffFullView,
		selectedDiffCommentAnchor,
		diffCommentAnchors,
		diffWhitespaceMode,
		diffScrollRef,
		wideBodyHeight,
		suppressNextDiffCommentScrollRef,
		setDiffCommentAnchorIndex,
		setDiffFileIndex,
		syncDiffScrollState: () => syncDiffScrollState(),
	})

	const { setDiffRenderableRef, resetDiffLineColors } = useDiffLineColors({
		diffLineColorContextKey,
		effectiveDiffRenderView,
		selectedDiffCommentAnchor,
		selectedDiffCommentRangeAnchors,
		diffCommentThreadAnchors,
		suppressNextDiffCommentScrollRef,
		ensureDiffLineVisible: (line) => ensureDiffLineVisible(line),
	})

	// Scroll the selected line into view when the diff view is opened. Previously
	// opentui's `focused` scrollbox did this auto-scroll on mount; with the keymap
	// migration the scrollbox is `focusable={false}` so we have to scroll explicitly.
	useEffect(() => {
		if (!diffFullView) return
		if (!selectedDiffCommentAnchor) return
		ensureDiffLineVisible(selectedDiffCommentAnchor.renderLine)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [diffFullView])
	const selectedPullRequestDetailKey = selectedPullRequest ? pullRequestDetailKey(selectedPullRequest) : null
	const { selectedPullRequestDetailError, isActiveSurfaceLoading, loadingFrame, loadingIndicator } = useLoadingStatus({
		selectedPullRequestDetailKey,
		detailHydrationState,
		pullRequestResult,
		pullRequestLoad,
		pullRequestStatus,
		issuesStatus,
		isLoadingMorePullRequests,
		activeWorkspaceSurface,
		selectedCommentsStatus,
		selectedDiffState,
		labelModal,
		closeModal,
		pullRequestStateModal,
		mergeModal,
		submitReviewModal,
		isInitialLoading,
		startupLoadComplete,
		setStartupLoadComplete,
		selectedPullRequest,
		loadPullRequestComments,
	})

	const detailPlaceholderContent = getDetailPlaceholderContent({
		status: pullRequestStatus,
		retryProgress,
		loadingIndicator,
		visibleCount: visiblePullRequests.length,
		filterText: visibleFilterText,
	})
	const isSelectedPullRequestDetailLoading = selectedPullRequest !== null && !selectedPullRequest.detailLoaded && selectedPullRequestDetailError === null
	const isSelectedPullRequestDetailError = selectedPullRequest !== null && !selectedPullRequest.detailLoaded && selectedPullRequestDetailError !== null
	const halfPage = Math.max(1, Math.floor(wideBodyHeight / 2))

	const { loadPullRequestDiff } = useDiffLoader({
		registry,
		setPullRequestDiffCache,
		setDiffCommentsLoaded,
		setDiffCommentThreads,
		listPullRequestReviewComments,
		flashNotice,
	})

	useDiffPrefetch({
		pullRequest: selectedPullRequest,
		skip: diffFullView,
		onPrefetch: (pr) => loadPullRequestDiff(pr),
	})

	// j/k navigates the *visual* (threaded) order, not the raw load order — so
	// the comment under the cursor is the one immediately below the previously
	// highlighted row, regardless of where it lives in the flat array. Derived
	// in `ui/comments/atoms.ts` and read here as plain atom values.
	const orderedComments = useAtomValue(orderedCommentsAtom)
	const selectedOrderedComment = useAtomValue(selectedOrderedCommentAtom)
	const commentsRowCount = useAtomValue(commentsRowCountAtom)
	const { scrollDetailPreviewBy, scrollDetailPreviewTo, scrollDetailFullViewBy, scrollDetailFullViewTo, setCommentEditorValue, editSubmitReview, openDiffView } =
		useImperativeActions({
			contentWidth,
			detailScrollRef,
			detailPreviewScrollRef,
			diffScrollRef,
			setDetailScrollOffset,
			setCommentModal,
			setSubmitReviewModal,
			setDiffFullView,
			setDetailFullView,
			setCommentsViewActive,
			setDiffFileIndex,
			setDiffScrollTop,
			setDiffCommentAnchorIndex,
			setDiffPreferredSide,
			setDiffCommentRangeStartIndex,
			setDiffRenderView,
			selectedPullRequest,
			resetDiffLineColors,
			loadPullRequestDiff,
		})

	const diffNav = useDiffCommentNavigator({
		diffFullView,
		diffFileIndex,
		setDiffFileIndex,
		setDiffScrollTop,
		diffCommentAnchorIndex,
		setDiffCommentAnchorIndex,
		diffPreferredSide,
		setDiffPreferredSide,
		diffCommentRangeStartAnchor,
		setDiffCommentRangeStartIndex,
		diffCommentAnchors,
		diffCommentThreadAnchors,
		selectedDiffCommentAnchor,
		selectedDiffCommentAnchorIndex,
		selectedDiffCommentThread,
		diffCommentRangeActive,
		stackedDiffFiles,
		readyDiffFiles,
		wideBodyHeight,
		diffScrollRef,
		suppressNextDiffCommentScrollRef,
		selectedPullRequest,
		changedFilesModal,
		changedFileResults,
		closeActiveModal,
		setChangedFilesModal,
		setCommentModal,
		setCommentThreadModal,
		initialCommentModalState,
		flashNotice,
	})
	const {
		syncDiffScrollState,
		ensureDiffLineVisible,
		jumpDiffFile,
		selectDiffFile,
		openChangedFilesModal,
		selectChangedFile,
		moveDiffCommentAnchor,
		moveDiffCommentToBoundary,
		alignSelectedDiffCommentAnchor,
		selectDiffCommentSide,
		selectDiffCommentLine,
		openDiffCommentModal,
		openSelectedDiffComment,
		toggleDiffCommentRange,
		moveDiffCommentThread,
	} = diffNav

	const { submitCommentModal, openNewIssueCommentModal, openReplyToSelectedComment, openEditSelectedComment, openDeleteSelectedComment, confirmDeleteComment } =
		useCommentMutations({
			selectedPullRequest,
			selectedCommentSubject,
			selectedCommentKey,
			selectedDiffCommentAnchor,
			selectedDiffCommentRange,
			selectedDiffKey,
			selectedOrderedComment,
			selectedComments,
			username,
			activeWorkspaceSurface,
			selectedIssue,
			pullRequestComments,
			diffCommentThreads,
			commentModal,
			deleteCommentModal,
			setCommentModal,
			setDeleteCommentModal,
			setPullRequestComments,
			setDiffCommentThreads,
			setDiffCommentRangeStartIndex,
			closeActiveModal,
			flashNotice,
			updateIssue,
			diffCommentThreadMapKey,
		})

	const { openCommentsView, closeCommentsView, moveCommentsSelection, setCommentsSelection, confirmCommentSelection, openSelectedCommentInBrowser, refreshSelectedComments } =
		useCommentsViewActions({
			activeWorkspaceSurface,
			selectedIssue,
			selectedPullRequest,
			selectedComments,
			orderedComments,
			commentsViewSelection,
			commentsRowCount,
			selectedOrderedComment,
			setCommentsViewActive,
			setDetailFullView,
			setDiffFullView,
			setCommentsViewSelection,
			loadPullRequestComments,
			loadIssueComments,
			openNewIssueCommentModal,
			openReplyToSelectedComment,
			openUrl,
			flashNotice,
		})

	const { movePullRequestStateSelection, confirmPullRequestStateChange, confirmCloseModal, toggleLabelAtIndex, confirmSubmitReview } = useItemModalActions({
		pullRequestStateModal,
		setPullRequestStateModal,
		closeModal,
		labelModal,
		submitReviewModal,
		setSubmitReviewModal,
		submitReviewOptions,
		reviewStatusAfterSubmit,
		selectedItemLabels,
		selectedCommentSubject,
		selectedIssue,
		selectedPullRequest,
		activeWorkspaceSurface,
		pullRequests,
		allIssues,
		closeActiveModal,
		flashNotice,
		updatePullRequest,
		updateIssue,
		setIssueOverrides,
		markPullRequestCompleted,
		restoreOptimisticPullRequest,
		refreshPullRequests,
		refreshIssues: () => refreshIssuesForView(activeIssueView),
		toggleDraftStatus,
		closePullRequest,
		closeIssue,
		submitPullRequestReview,
		addPullRequestLabel,
		removePullRequestLabel,
		addIssueLabel,
		removeIssueLabel,
	})

	const { openInlineLink } = useLinkNavigation({
		issues,
		allIssues,
		pullRequests,
		selectedRepository,
		setActiveWorkspaceSurface,
		setSelectedIssueIndex,
		setDetailFullView,
		setFilterQuery,
		setFilterDraft,
		setFilterMode,
		selectPullRequestByUrl,
		switchViewTo,
		openUrl,
		flashNotice,
	})

	const { openThemeModal, closeThemeModal, moveThemeSelection, updateThemeQuery, toggleThemeTone, toggleThemeMode, editThemeQuery } = themeModalActions

	const { openMergeModal, cancelOrCloseMergeModal, confirmMergeAction, cycleMergeMethod, moveMergeSelection } = useMergeFlow({
		mergeModal,
		setMergeModal,
		selectedPullRequest,
		pullRequests,
		closeActiveModal,
		flashNotice,
		updatePullRequest,
		markPullRequestCompleted,
		restoreOptimisticPullRequest,
		refreshPullRequests,
	})

	const openRepositoryPicker = () => {
		setOpenRepositoryModal({ query: selectedRepository ?? "", error: null })
	}
	const openRepositoryFromInput = () => {
		const repository = parseRepositoryInput(openRepositoryModal.query)
		if (!repository) {
			setOpenRepositoryModal((current) => ({ ...current, error: "Enter a repository as owner/name or a GitHub URL." }))
			return
		}
		closeActiveModal()
		switchViewTo({ _tag: "Repository", repository })
		flashNotice(`Opened ${repository}`)
	}
	usePasteRouter({
		renderer,
		commandPaletteActive,
		openRepositoryModalActive,
		themeModalActive,
		themeModal,
		commentModalActive,
		submitReviewModalActive,
		labelModalActive,
		changedFilesModalActive,
		filterMode,
		setCommandPalette,
		setOpenRepositoryModal,
		editThemeQuery,
		setSubmitReviewModal,
		setLabelModal,
		setChangedFilesModal,
		setFilterDraft,
	})

	const { commandPaletteCommands, selectedCommandIndex, selectedCommand, runCommand, runCommandById } = useCommandRegistry({
		commandPaletteActive,
		commandPalette,
		selectedRepository,
		switchViewTo,
		commentsViewActive,
		diffFullView,
		detailFullView,
		runtimeSnapshot: {
			readyDiffFileCount: readyDiffFiles.length,
			diffFileIndex,
			selectedDiffCommentAnchorLabel: selectedDiffCommentLabel,
			selectedDiffCommentThreadCount: selectedDiffCommentThread.length,
			hasDiffCommentThreads: diffCommentThreadAnchors.length > 0,
			diffRangeActive: diffCommentRangeActive,
			selectedCommentsStatus,
			selectedOrderedComment,
			username,
		},
		closeActiveModal,
		flashNotice,
	})

	useCommandHandoffs({
		renderer,
		selectedPullRequest,
		selectedRepository,
		refreshPullRequests,
		refreshIssues: () => refreshIssuesForView(activeIssueView),
		loadMorePullRequests,
		loadPullRequestDiff,
		flashNotice,
		switchViewTo,
		openThemeModal,
		openMergeModal,
		openCommentsView,
		openDiffView,
		openChangedFilesModal,
		toggleDiffFilePanel: () => {
			// Flip whatever the user currently sees: if it's auto-on, set
			// explicit-off (and vice versa). Sticky from there.
			const currentlyVisible = diffFilePanelOverride ?? diffFilePanelAutoVisible
			setDiffFilePanelOverride(!currentlyVisible)
		},
		jumpDiffFile,
		moveDiffCommentThread,
		openSelectedDiffComment,
		toggleDiffCommentRange,
		openDiffCommentModal,
		openReplyToSelectedComment,
		openEditSelectedComment,
		openDeleteSelectedComment,
	})

	// === Helpers used by the keymap layers ===
	const { scrollCommentThread, moveLabelSelection, moveChangedFileSelection, moveSubmitReviewActionSelection, moveCommandPaletteSelection, selectCommandPaletteIndex } =
		useModalSelectionMovers({
			labelModal,
			commandPaletteCommands,
			changedFileResultsLength: changedFileResults.length,
			submitReviewOptionsLength: submitReviewOptions.length,
			setCommentThreadModal,
			setLabelModal,
			setChangedFilesModal,
			setSubmitReviewModal,
			setCommandPalette,
		})
	const runCommandPaletteCommand = (command: AppCommand) => {
		runCommand(command, { notifyDisabled: true, closePalette: true })
	}
	const { stepSelected, stepSelectedDown, stepSelectedUp, stepSelectedDownWithLoadMore, stepSelectedUpWrap, moveSelectedToPreviousGroup, moveSelectedToNextGroup } =
		useListSelectionStepping({
			activeWorkspaceSurface,
			visiblePullRequests,
			issues,
			repositoryItems,
			selectedIndex,
			visibleHasMorePullRequests,
			loadMoreSlotAvailable,
			issueLoadMoreSlotAvailable,
			groupStarts,
			getCurrentGroupIndex,
			setSelectedIndex,
			setSelectedIssueIndex,
			setSelectedRepositoryIndex,
		})
	const handleQuitOrClose = () => {
		if (themeModalActive) {
			closeThemeModal(false)
			return
		}
		if (activeModal._tag !== "None") {
			closeActiveModal()
			return
		}
		runCommandById("app.quit")
	}

	useAppKeymap({
		closeModalActive,
		pullRequestStateModalActive,
		mergeModalActive,
		commentThreadModalActive,
		changedFilesModalActive,
		filterModalActive,
		submitReviewModalActive,
		labelModalActive,
		themeModalActive,
		openRepositoryModalActive,
		commentModalActive,
		deleteCommentModalActive,
		commandPaletteActive,
		filterMode,
		diffFullView,
		detailFullView,
		commentsViewActive,
		themeModal,
		submitReviewModal,
		mergeModal,
		commandPaletteSelectedCommand: selectedCommand,
		activeWorkspaceSurface,
		workspaceTabSurfaces,
		closeActiveModal,
		confirmCloseModal,
		confirmPullRequestStateChange,
		movePullRequestStateSelection,
		cancelOrCloseMergeModal,
		confirmMergeAction,
		cycleMergeMethod,
		moveMergeSelection,
		openDiffCommentModal,
		scrollCommentThread,
		changedFileResultsLength: changedFileResults.length,
		selectChangedFile,
		moveChangedFileSelection,
		applySelectedFilter,
		moveFilterSelection,
		setSubmitReviewModal,
		confirmSubmitReview,
		editSubmitReview,
		moveSubmitReviewActionSelection,
		toggleLabelAtIndex,
		moveLabelSelection,
		closeThemeModal,
		updateThemeQuery,
		toggleThemeMode,
		toggleThemeTone,
		moveThemeSelection,
		openRepositoryFromInput,
		confirmDeleteComment,
		runCommandPaletteCommand,
		moveCommandPaletteSelection,
		setFilterDraft,
		setFilterMode,
		setFilterQuery,
		filterQuery,
		filterDraft,
		halfPage,
		diffCommentRangeActive,
		setDiffCommentRangeStartIndex,
		runCommandById,
		openSelectedDiffComment,
		moveDiffCommentAnchor,
		moveDiffCommentToBoundary,
		alignSelectedDiffCommentAnchor,
		selectDiffCommentSide,
		scrollDetailFullViewBy,
		scrollDetailFullViewTo,
		commentsRowCount,
		selectedOrderedComment,
		username,
		moveCommentsSelection,
		setCommentsSelection,
		closeCommentsView,
		openSelectedCommentInBrowser,
		refreshSelectedComments,
		confirmCommentSelection,
		visiblePullRequestsLength: visiblePullRequests.length,
		issuesLength: issues.length,
		repositoryItemsLength: repositoryItems.length,
		selectedRepository,
		selectedPullRequest,
		selectedIssue,
		selectedRepositoryItem,
		isWideLayout,
		loadMoreRowSelected,
		loadMoreIssueRowSelected,
		loadMorePullRequests,
		loadMoreIssues,
		openSelectedRepository,
		openRepositoryPicker,
		toggleFavoriteRepository,
		removeSelectedRepository,
		openFilterModal,
		goUpWorkspaceScope,
		switchQueueMode,
		switchWorkspaceSurface,
		cycleWorkspaceSurface,
		scrollDetailPreviewBy,
		scrollDetailPreviewTo,
		stepSelected,
		stepSelectedUp,
		stepSelectedDown,
		stepSelectedUpWrap,
		stepSelectedDownWithLoadMore,
		moveSelectedToPreviousGroup,
		moveSelectedToNextGroup,
		setSelectedIndex,
		setSelectedIssueIndex,
		setSelectedRepositoryIndex,
		handleQuitOrClose,
		setCommandPalette,
		setOpenRepositoryModal,
		setChangedFilesModal,
		setLabelModal,
		editThemeQuery,
	})

	if (isInitialLoading) {
		return { isInitialLoading: true as const, terminalWidth, terminalHeight, contentWidth, detailPlaceholderContent, loadingFrame }
	}

	const derivations = computeWorkspaceDerivations({
		contentWidth,
		isWideLayout,
		leftPaneWidth,
		rightPaneWidth,
		rightContentWidth,
		fullscreenContentWidth,
		wideBodyHeight,
		dividerJunctionAt,
		showWorkspaceTabs,
		detailFullView,
		diffFullView,
		commentsViewActive,
		activeWorkspaceSurface,
		workspaceTabSurfaces,
		selectedPullRequest,
		selectedIssue,
		selectedRepository,
		selectedComments,
		selectedCommentsStatus,
		isSelectedPullRequestDetailLoading,
		pullRequestStatus,
		pullRequestError,
		pullRequestActiveFilterLabel,
		issueActiveFilterLabel,
		pullRequestListRows,
		visibleGroups,
		visiblePullRequests,
		issues,
		showIssueRepositoryGroups,
		issuesStatus,
		issuesError,
		repositoryItems,
		selectedIssueIndex,
		selectedRepositoryIndex,
		hasMorePullRequests,
		isLoadingMorePullRequests,
		loadedPullRequestCount,
		loadingIndicator,
		filterMode,
		visibleFilterText,
		selectPullRequestByUrl,
		setSelectedIssueIndex,
		setSelectedRepositoryIndex,
		loadMoreSelected: loadMoreRowSelected,
		onSelectLoadMore: () => {
			setSelectedIndex(visiblePullRequests.length)
			loadMorePullRequests()
		},
		hasMoreIssues,
		isLoadingMoreIssues,
		loadedIssueCount,
		loadMoreIssueRowSelected,
		onSelectLoadMoreIssues: () => {
			setSelectedIssueIndex(issues.length)
			loadMoreIssues()
		},
		diffFilePanelDividerColumn: diffFilePanelVisible ? diffFilePanelEffectiveWidth : null,
	})
	const { showPaneSplit, workspaceTabCounts, filterPlaceholder, workspaceTopDividerJunctions, workspaceBottomDividerJunctions, preFooterDividerJunctions } = derivations

	const modalLayouts = computeModalLayouts({
		contentWidth,
		terminalHeight,
		longestLabelName: labelModal.availableLabels.reduce((max, label) => Math.max(max, label.name.length), 0),
		longestDiffFileName: changedFilesModalActive ? readyDiffFiles.reduce((max, file) => Math.max(max, file.name.length), 0) : 0,
		changedFilesModalActive,
	})
	const commentAnchorLabel = ((): string => {
		if (commentModalActive) {
			if (commentModal.target.kind === "issue") return selectedCommentSubject ? `New comment on #${selectedCommentSubject.number}` : "New comment"
			if (commentModal.target.kind === "reply") return `Reply on ${commentModal.target.anchorLabel}`
			if (commentModal.target.kind === "edit") return commentModal.target.anchorLabel
		}
		return selectedDiffCommentAnchor && selectedDiffCommentLabel ? `${selectedDiffCommentAnchor.path} ${selectedDiffCommentLabel}` : "No diff line selected"
	})()
	const footerProps = computeFooterProps({
		footerNotice,
		filterMode,
		visibleFilterText,
		filterPlaceholder,
		filterQuery,
		detailFullView,
		diffFullView,
		diffCommentRangeActive,
		commentsViewActive,
		selectedCommentsStatus,
		selectedOrderedComment,
		username,
		selectedCommentsLength: selectedComments.length,
		selectedCommentCount,
		selectedCommentSubject,
		activeWorkspaceSurface,
		selectedRepositoryItem,
		selectedRepository,
		selectedPullRequest,
		pullRequestStatus,
		isActiveSurfaceLoading,
		closeModal,
		pullRequestStateModal,
		mergeModal,
		submitReviewModal,
		loadingIndicator,
		retryProgress,
	})
	return {
		isInitialLoading: false as const,
		terminalWidth,
		terminalHeight,
		contentWidth,
		headerFooterWidth,
		headerRight,
		showWorkspaceTabs,
		workspaceTabSurfaces,
		workspaceTabCounts,
		activeWorkspaceSurface,
		switchWorkspaceSurface,
		workspaceTopDividerJunctions,
		workspaceBottomDividerJunctions,
		preFooterDividerJunctions,
		showPaneSplit,
		dividerJunctionAt,
		layout,
		derivations,
		headerProps: { selectedRepository, homeCrumb, breadcrumbSeparatorText, headerLeftWidth, headerRepoWidth, homeCrumbHovered, setHomeCrumbHovered, goUpWorkspaceScope },
		contentProps: {
			activeWorkspaceSurface,
			commentsViewActive,
			diffFullView,
			detailFullView,
			layout,
			derivations,
			issueActiveFilterLabel,
			pullRequestActiveFilterLabel,
			selectedRepositoryItem,
			selectedRepositoryDetails,
			selectedIssue,
			selectedPullRequest,
			selectedComments,
			selectedCommentsStatus,
			detailPlaceholderContent,
			isSelectedPullRequestDetailLoading,
			isSelectedPullRequestDetailError,
			selectedPullRequestDetailError,
			commentsViewSelection,
			orderedComments,
			selectedCommentSubject,
			displayedDiffState,
			stackedDiffFiles,
			diffScrollTop,
			effectiveDiffRenderView,
			diffWhitespaceMode,
			diffWrapMode,
			selectedDiffCommentAnchor,
			selectedDiffCommentLabel,
			selectedDiffCommentThread,
			selectDiffCommentLine,
			setDiffRenderableRef,
			loadingIndicator,
			themeId,
			systemThemeGeneration,
			scrollRefs: { prListScrollRef, detailScrollRef, detailPreviewScrollRef, diffScrollRef, issueListScrollRef },
			openInlineLink,
			diffFilePanel: {
				visible: diffFilePanelVisible,
				width: diffFilePanelEffectiveWidth,
				diffPaneWidth,
				files: readyDiffFiles,
				currentFileIndex: diffFileIndex,
				pickerActive: changedFilesModalActive,
				pickerQuery: changedFilesModal.query,
				pickerSelectedIndex: changedFilesModal.selectedIndex,
				pickerResults: changedFileResults,
				onSelectFile: selectDiffFile,
			},
		},
		footerProps,
		modalsProps: {
			activeModal,
			loadingIndicator,
			selectedItemLabels,
			commentAnchorLabel,
			selectedDiffCommentThread,
			changedFileResults,
			readyDiffFileCount: readyDiffFiles.length,
			commandPaletteCommands,
			selectedCommandIndex,
			onSelectCommandIndex: selectCommandPaletteIndex,
			onRunCommand: runCommandPaletteCommand,
			onCommentChange: setCommentEditorValue,
			onCommentSubmit: submitCommentModal,
			layouts: modalLayouts,
			// Picker takes over the docked panel when visible; suppressing the
			// modal here keeps both presentations from rendering at once.
			suppressChangedFilesModal: diffFilePanelVisible,
		},
	}
}
