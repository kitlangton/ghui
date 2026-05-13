import { type ScrollBoxRenderable } from "@opentui/core"
import { RegistryContext, useAtom, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useKeymap } from "@ghui/keymap/react"
import { appKeymap, type AppCtx } from "./keymap/all.js"
import { buildAppCtx } from "./keymap/contexts/appCtx.js"
import { useOpenTuiSubscribe } from "./keyboard/opentuiAdapter.js"
import { useRenderer, useTerminalDimensions } from "@opentui/react"
import { Cause } from "effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { AppCommand } from "./commands.js"
import { type IssueItem, type LoadStatus, type PullRequestItem, type SubmitPullRequestReviewInput } from "./domain.js"
import { errorMessage } from "./errors.js"
import { parseRepositoryInput, viewCacheKey } from "./pullRequestViews.js"

import { colors } from "./ui/colors.js"
import {
	favoriteRepositoriesAtom,
	readRepoRollupAtom,
	readWorkspacePreferencesAtom,
	recentRepositoriesAtom,
	repoRollupAtom,
	selectedRepositoryIndexAtom,
	workspaceSurfaceAtom,
	writeWorkspacePreferencesAtom,
} from "./workspace/atoms.js"
import { computeLayout } from "./workspace/layout.js"
import { computeModalLayouts } from "./workspace/modalLayouts.js"
import { computeWorkspaceDerivations } from "./workspace/derivations.js"
import { buildRepositoryItems } from "./workspace/repositoryItems.js"
import { useWorkspacePreferencesPersistence } from "./workspace/useWorkspacePreferencesPersistence.js"
import {
	commentsViewActiveAtom,
	commentsViewSelectionAtom,
	listIssueCommentsAtom,
	listPullRequestCommentsAtom,
	pullRequestCommentsAtom,
	pullRequestCommentsLoadedAtom,
} from "./ui/comments/atoms.js"
import { activeIssueViewAtom, addIssueLabelAtom, closeIssueAtom, issueLoadAtom, issuesAtom, issueViewRepository, removeIssueLabelAtom } from "./ui/issues/atoms.js"
import { detailFullViewAtom, detailScrollOffsetAtom } from "./ui/detail/atoms.js"
import { filterDraftAtom, filterModeAtom, filterQueryAtom } from "./ui/filter/atoms.js"
import { filterByScore, issueFilterScore, repositoryFilterScore } from "./ui/filter/scoring.js"
import { selectedIndexAtom, selectedIssueIndexAtom } from "./ui/listSelection/atoms.js"
import { activeModalAtom } from "./ui/modals/atoms.js"
import { noticeAtom } from "./ui/notice/atoms.js"
import { useFlashNotice } from "./ui/notice/useFlashNotice.js"
import { canEditComment, useCommentMutations } from "./ui/comments/useCommentMutations.js"
import { useDetailHydration } from "./ui/pullRequests/useDetailHydration.js"
import {
	activeViewAtom,
	addPullRequestLabelAtom,
	closePullRequestAtom,
	activeViewsAtom,
	displayedPullRequestsAtom,
	groupStartsAtom,
	hasMorePullRequestsAtom,
	issueOverridesAtom,
	loadedPullRequestCountAtom,
	prewarmRepositoryDetailsAtom,
	pruneCacheAtom,
	pullRequestDetailKey,
	pullRequestLoadAtom,
	pullRequestOverridesAtom,
	pullRequestsAtom,
	pullRequestStatusAtom,
	queueLoadCacheAtom,
	queueSelectionAtom,
	recentlyCompletedPullRequestsAtom,
	removePullRequestLabelAtom,
	retryProgressAtom,
	selectedPullRequestAtom,
	selectedRepositoryAtom,
	toggleDraftAtom,
	usernameAtom,
	visibleGroupsAtom,
	visiblePullRequestsAtom,
} from "./ui/pullRequests/atoms.js"

import { useFocusReturnRefresh } from "./hooks/useFocusReturnRefresh.js"
import { useCommentsLoader } from "./hooks/useCommentsLoader.js"
import { useDiffLoader } from "./hooks/useDiffLoader.js"
import { useLinkNavigation } from "./hooks/useLinkNavigation.js"
import { useCommandRegistry } from "./hooks/useCommandRegistry.js"
import { useListSelectionStepping } from "./hooks/useListSelectionStepping.js"
import { useModalSelectionMovers } from "./hooks/useModalSelectionMovers.js"
import { usePasteRouter } from "./hooks/usePasteRouter.js"
import { useWorkspaceNavigation } from "./hooks/useWorkspaceNavigation.js"
import { useDiffSelectionSync } from "./hooks/useDiffSelectionSync.js"
import { useLoadMoreOnScroll } from "./hooks/useLoadMoreOnScroll.js"
import { useLoadMore } from "./ui/pullRequests/useLoadMore.js"
import { useFilterModal } from "./ui/filter/useFilterModal.js"
import { useRefreshCompletionToast } from "./ui/pullRequests/useRefreshCompletionToast.js"
import { useRepositoryDetails } from "./ui/pullRequests/useRepositoryDetails.js"
import { openUrlAtom, submitPullRequestReviewAtom } from "./services/systemAtoms.js"
import {
	diffCommentAnchorIndexAtom,
	diffCommentRangeStartIndexAtom,
	diffCommentsLoadedAtom,
	diffCommentThreadsAtom,
	diffFileIndexAtom,
	diffFullViewAtom,
	diffPreferredSideAtom,
	diffRenderViewAtom,
	diffScrollTopAtom,
	diffWhitespaceModeAtom,
	diffWrapModeAtom,
	listPullRequestReviewCommentsAtom,
	pullRequestDiffCacheAtom,
	selectedDiffKeyAtom,
	selectedDiffStateAtom,
} from "./ui/diff/atoms.js"
import { diffCommentThreadMapKey } from "./ui/diff/comments.js"
import { useDiffLineColors } from "./ui/diff/useDiffLineColors.js"
import { useDiffLocationPreservation } from "./ui/diff/useDiffLocationPreservation.js"
import { useDiffPrefetch } from "./ui/diff/useDiffPrefetch.js"
import { themeIdAtom } from "./ui/theme/atoms.js"
import { useThemeModal } from "./ui/theme/useThemeModal.js"
import { useMergeFlow } from "./ui/merge/useMergeFlow.js"
import type { CommentEditorValue } from "./ui/commentEditor.js"
import { minimizeWhitespaceDiffFiles, pullRequestDiffKey } from "./ui/diff.js"
import { type DetailCommentsStatus, type DetailPlaceholderContent } from "./ui/DetailsPane.js"
import { RetryProgress } from "./ui/FooterHints.js"
import { LoadingLogoPane } from "./ui/LoadingLogo.js"
import { Divider, fitCell, TextLine } from "./ui/primitives.js"
import {
	filterChangedFiles,
	initialChangedFilesModalState,
	initialCloseModalState,
	initialCommandPaletteState,
	initialCommentModalState,
	initialDeleteCommentModalState,
	initialFilterModalState,
	initialLabelModalState,
	initialMergeModalState,
	initialModal,
	initialOpenRepositoryModalState,
	initialPullRequestStateModalState,
	initialSubmitReviewModalState,
	initialThemeModalState,
	Modal,
	submitReviewOptions,
	type ChangedFilesModalState,
	type CloseModalState,
	type CommandPaletteState,
	type CommentModalState,
	type DeleteCommentModalState,
	type FilterModalState,
	type LabelModalState,
	type MergeModalState,
	type ModalState,
	type ModalTag,
	type OpenRepositoryModalState,
	type PullRequestStateModalState,
	type SubmitReviewModalState,
	type ThemeModalState,
} from "./ui/modals.js"
import { commentsViewRowCount, orderCommentsForDisplay } from "./ui/CommentsPane.js"
import { buildPullRequestListRows, pullRequestListRowIndex } from "./ui/PullRequestList.js"
import { type RepositoryListItem } from "./ui/RepoList.js"
import { WorkspaceContent } from "./surfaces/WorkspaceContent.js"
import { WorkspaceFooter } from "./surfaces/WorkspaceFooter.js"
import { WorkspaceHeader } from "./surfaces/WorkspaceHeader.js"
import { WorkspaceModals } from "./surfaces/WorkspaceModals.js"
import { WorkspaceTabs } from "./ui/WorkspaceTabs.js"
import { issueListRowIndex, orderIssuesForDisplay } from "./ui/IssueList.js"
import { SPINNER_FRAMES } from "./ui/spinner.js"
import { useClampedIndex } from "./ui/useClampedIndex.js"
import { useScrollFollowSelected } from "./ui/useScrollFollowSelected.js"
import { useScrollPersistence } from "./ui/useScrollPersistence.js"
import { useSpinnerFrame } from "./ui/useSpinnerFrame.js"
import { useTextInputDispatcher } from "./ui/useTextInputDispatcher.js"
import { useCommandHandoffs } from "./hooks/useCommandHandoffs.js"
import { useDiffCommentDerivations } from "./hooks/useDiffCommentDerivations.js"
import { useDiffCommentNavigator } from "./hooks/useDiffCommentNavigator.js"
import { usePullRequestModalActions } from "./hooks/usePullRequestModalActions.js"
import { repositoryWorkspaceSurfaces, userWorkspaceSurfaces, type WorkspaceSurface } from "./workspaceSurfaces.js"
import { detectedRepository, mockRepositoryCatalog, mockWorkspacePreferencesPath } from "./services/runtime.js"

interface DetailPlaceholderInput {
	readonly status: LoadStatus
	readonly retryProgress: RetryProgress
	readonly loadingIndicator: string
	readonly visibleCount: number
	readonly filterText: string
}

interface AppProps {
	readonly systemThemeGeneration?: number
}

const FOCUS_RETURN_REFRESH_MIN_MS = 60_000
const FOCUSED_IDLE_REFRESH_MS = 5 * 60_000
const AUTO_REFRESH_JITTER_MS = 10_000

const reviewStatusAfterSubmit = {
	COMMENT: null,
	APPROVE: "approved",
	REQUEST_CHANGES: "changes",
} satisfies Record<SubmitPullRequestReviewInput["event"], PullRequestItem["reviewStatus"] | null>

const getDetailPlaceholderContent = ({ status, retryProgress, loadingIndicator, visibleCount, filterText }: DetailPlaceholderInput): DetailPlaceholderContent => {
	if (status === "loading") {
		return {
			title: `${loadingIndicator} Loading pull requests`,
			hint: retryProgress._tag === "Retrying" ? `Retry ${retryProgress.attempt}/${retryProgress.max}` : "Fetching latest open PRs",
		}
	}

	if (status === "error") {
		return {
			title: "Could not load pull requests",
			hint: "Press r to retry",
		}
	}

	if (visibleCount === 0 && filterText.length > 0) {
		return {
			title: "No matching pull requests",
			hint: "Press esc to clear the filter",
		}
	}

	if (visibleCount === 0) {
		return {
			title: "No open pull requests",
			hint: "Press r to refresh",
		}
	}

	return {
		title: "Select a pull request",
		hint: "Use up/down to move",
	}
}

export const App = ({ systemThemeGeneration = 0 }: AppProps) => {
	const renderer = useRenderer()
	const { width, height } = useTerminalDimensions()
	const registry = useContext(RegistryContext)

	const pullRequestResult = useAtomValue(pullRequestsAtom)
	const refreshPullRequestsAtomRaw = useAtomRefresh(pullRequestsAtom)
	const refreshPullRequestsAtom = useCallback(() => {
		if (registry.get(pullRequestsAtom).waiting) return
		refreshPullRequestsAtomRaw()
	}, [refreshPullRequestsAtomRaw, registry])
	const [activeView, setActiveView] = useAtom(activeViewAtom)
	const setQueueLoadCache = useAtomSet(queueLoadCacheAtom)
	const setQueueSelection = useAtomSet(queueSelectionAtom)
	const [selectedIndex, setSelectedIndex] = useAtom(selectedIndexAtom)
	const [notice, setNotice] = useAtom(noticeAtom)
	const [filterQuery, setFilterQuery] = useAtom(filterQueryAtom)
	const [filterDraft, setFilterDraft] = useAtom(filterDraftAtom)
	const [filterMode, setFilterMode] = useAtom(filterModeAtom)
	const [activeIssueView, setActiveIssueView] = useAtom(activeIssueViewAtom)
	const [detailFullView, setDetailFullView] = useAtom(detailFullViewAtom)
	const setDetailScrollOffset = useAtomSet(detailScrollOffsetAtom)
	const [diffFullView, setDiffFullView] = useAtom(diffFullViewAtom)
	const [commentsViewActive, setCommentsViewActive] = useAtom(commentsViewActiveAtom)
	const [commentsViewSelection, setCommentsViewSelection] = useAtom(commentsViewSelectionAtom)
	const [diffFileIndex, setDiffFileIndex] = useAtom(diffFileIndexAtom)
	const [diffScrollTop, setDiffScrollTop] = useAtom(diffScrollTopAtom)
	const [diffRenderView, setDiffRenderView] = useAtom(diffRenderViewAtom)
	const diffWrapMode = useAtomValue(diffWrapModeAtom)
	const diffWhitespaceMode = useAtomValue(diffWhitespaceModeAtom)
	const [diffCommentAnchorIndex, setDiffCommentAnchorIndex] = useAtom(diffCommentAnchorIndexAtom)
	const [diffPreferredSide, setDiffPreferredSide] = useAtom(diffPreferredSideAtom)
	const [diffCommentRangeStartIndex, setDiffCommentRangeStartIndex] = useAtom(diffCommentRangeStartIndexAtom)
	const [diffCommentThreads, setDiffCommentThreads] = useAtom(diffCommentThreadsAtom)
	const setDiffCommentsLoaded = useAtomSet(diffCommentsLoadedAtom)
	const setPullRequestComments = useAtomSet(pullRequestCommentsAtom)
	const setPullRequestCommentsLoaded = useAtomSet(pullRequestCommentsLoadedAtom)
	const setPullRequestDiffCache = useAtomSet(pullRequestDiffCacheAtom)
	const [activeModal, setActiveModal] = useAtom(activeModalAtom)
	const themeId = useAtomValue(themeIdAtom)
	const closeActiveModal = () => setActiveModal(initialModal)
	const labelModalActive = Modal.$is("Label")(activeModal)
	const closeModalActive = Modal.$is("Close")(activeModal)
	const pullRequestStateModalActive = Modal.$is("PullRequestState")(activeModal)
	const mergeModalActive = Modal.$is("Merge")(activeModal)
	const commentModalActive = Modal.$is("Comment")(activeModal)
	const deleteCommentModalActive = Modal.$is("DeleteComment")(activeModal)
	const commentThreadModalActive = Modal.$is("CommentThread")(activeModal)
	const changedFilesModalActive = Modal.$is("ChangedFiles")(activeModal)
	const filterModalActive = Modal.$is("Filter")(activeModal)
	const submitReviewModalActive = Modal.$is("SubmitReview")(activeModal)
	const themeModalActive = Modal.$is("Theme")(activeModal)
	const commandPaletteActive = Modal.$is("CommandPalette")(activeModal)
	const openRepositoryModalActive = Modal.$is("OpenRepository")(activeModal)
	const labelModal: LabelModalState = labelModalActive ? activeModal : initialLabelModalState
	const closeModal: CloseModalState = closeModalActive ? activeModal : initialCloseModalState
	const pullRequestStateModal: PullRequestStateModalState = pullRequestStateModalActive ? activeModal : initialPullRequestStateModalState
	const mergeModal: MergeModalState = mergeModalActive ? activeModal : initialMergeModalState
	const commentModal: CommentModalState = commentModalActive ? activeModal : initialCommentModalState
	const deleteCommentModal: DeleteCommentModalState = deleteCommentModalActive ? activeModal : initialDeleteCommentModalState
	const changedFilesModal: ChangedFilesModalState = changedFilesModalActive ? activeModal : initialChangedFilesModalState
	const filterModal: FilterModalState = filterModalActive ? activeModal : initialFilterModalState
	const submitReviewModal: SubmitReviewModalState = submitReviewModalActive ? activeModal : initialSubmitReviewModalState
	const themeModal: ThemeModalState = themeModalActive ? activeModal : initialThemeModalState
	const commandPalette: CommandPaletteState = commandPaletteActive ? activeModal : initialCommandPaletteState
	const openRepositoryModal: OpenRepositoryModalState = openRepositoryModalActive ? activeModal : initialOpenRepositoryModalState
	const makeModalSetter =
		<Tag extends Exclude<ModalTag, "None">>(tag: Tag) =>
		(next: ModalState<Tag> | ((prev: ModalState<Tag>) => ModalState<Tag>)) =>
			setActiveModal((current) => {
				const ctor = Modal[tag] as unknown as (args: ModalState<Tag>) => Modal
				if (typeof next === "function") {
					const updater = next as (prev: ModalState<Tag>) => ModalState<Tag>
					if (current._tag !== tag) return current
					return ctor(updater(current as unknown as ModalState<Tag>))
				}
				return ctor(next)
			})
	const setLabelModal = makeModalSetter("Label")
	const setPullRequestStateModal = makeModalSetter("PullRequestState")
	const setMergeModal = makeModalSetter("Merge")
	const setCommentModal = makeModalSetter("Comment")
	const setDeleteCommentModal = makeModalSetter("DeleteComment")
	const setCommentThreadModal = makeModalSetter("CommentThread")
	const setChangedFilesModal = makeModalSetter("ChangedFiles")
	const setFilterModal = makeModalSetter("Filter")
	const setSubmitReviewModal = makeModalSetter("SubmitReview")
	const setThemeModal = makeModalSetter("Theme")
	const setCommandPalette = makeModalSetter("CommandPalette")
	const setOpenRepositoryModal = makeModalSetter("OpenRepository")
	const setPullRequestOverrides = useAtomSet(pullRequestOverridesAtom)
	const setIssueOverrides = useAtomSet(issueOverridesAtom)
	const setRecentlyCompletedPullRequests = useAtomSet(recentlyCompletedPullRequestsAtom)
	const retryProgress = useAtomValue(retryProgressAtom)
	const [startupLoadComplete, setStartupLoadComplete] = useState(false)
	const [homeCrumbHovered, setHomeCrumbHovered] = useState(false)
	const usernameResult = useAtomValue(usernameAtom)
	const addPullRequestLabel = useAtomSet(addPullRequestLabelAtom, { mode: "promise" })
	const removePullRequestLabel = useAtomSet(removePullRequestLabelAtom, { mode: "promise" })
	const addIssueLabel = useAtomSet(addIssueLabelAtom, { mode: "promise" })
	const removeIssueLabel = useAtomSet(removeIssueLabelAtom, { mode: "promise" })
	const toggleDraftStatus = useAtomSet(toggleDraftAtom, { mode: "promise" })
	const listPullRequestReviewComments = useAtomSet(listPullRequestReviewCommentsAtom, { mode: "promise" })
	const listPullRequestComments = useAtomSet(listPullRequestCommentsAtom, { mode: "promise" })
	const listIssueComments = useAtomSet(listIssueCommentsAtom, { mode: "promise" })
	const readWorkspacePreferences = useAtomSet(readWorkspacePreferencesAtom, { mode: "promise" })
	const writeWorkspacePreferences = useAtomSet(writeWorkspacePreferencesAtom, { mode: "promise" })
	const pruneCache = useAtomSet(pruneCacheAtom, { mode: "promise" })
	const prewarmRepositoryDetails = useAtomSet(prewarmRepositoryDetailsAtom, { mode: "promise" })
	const closePullRequest = useAtomSet(closePullRequestAtom, { mode: "promise" })
	const closeIssue = useAtomSet(closeIssueAtom, { mode: "promise" })
	const refreshIssuesAtomRaw = useAtomRefresh(issuesAtom)
	const submitPullRequestReview = useAtomSet(submitPullRequestReviewAtom, { mode: "promise" })
	const openUrl = useAtomSet(openUrlAtom, { mode: "promise" })
	const terminalWidth = width ?? 100
	const terminalHeight = height ?? 24
	const showWorkspaceTabs = !detailFullView && !diffFullView && !commentsViewActive
	const {
		contentWidth,
		isWideLayout,
		sectionPadding,
		leftPaneWidth,
		rightPaneWidth,
		leftContentWidth,
		rightContentWidth,
		dividerJunctionAt,
		wideBodyHeight,
		wideDetailLines,
		headerFooterWidth,
		fullscreenContentWidth,
		fullscreenBodyLines,
	} = computeLayout({ terminalWidth, terminalHeight, showWorkspaceTabs })
	const refreshGenerationRef = useRef(0)
	const lastPullRequestRefreshAtRef = useRef(0)
	const pullRequestStatusRef = useRef<LoadStatus>("loading")
	const refreshPullRequestsRef = useRef<(message?: string, options?: { readonly resetTransientState?: boolean }) => void>(() => {})
	const maybeRefreshPullRequestsRef = useRef<(minimumAgeMs: number) => void>(() => {})
	const detailScrollRef = useRef<ScrollBoxRenderable | null>(null)
	const detailPreviewScrollRef = useRef<ScrollBoxRenderable | null>(null)
	const diffScrollRef = useRef<ScrollBoxRenderable | null>(null)
	const prListScrollRef = useRef<ScrollBoxRenderable | null>(null)
	const issueListScrollRef = useRef<ScrollBoxRenderable | null>(null)
	// Persisted scrollTop per surface so switching tabs preserves list position.
	// Detail preview intentionally resets per selection — persisting it would
	// surprise users who expect to see new content from the top.
	const prListScrollPersistedRef = useRef(0)
	const issueListScrollPersistedRef = useRef(0)
	const suppressNextDiffCommentScrollRef = useRef(false)

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

	const pullRequestLoad = useAtomValue(pullRequestLoadAtom)
	const [activeWorkspaceSurface, setActiveWorkspaceSurface] = useAtom(workspaceSurfaceAtom)
	const [selectedRepositoryIndex, setSelectedRepositoryIndex] = useAtom(selectedRepositoryIndexAtom)
	const [favoriteRepositories, setFavoriteRepositories] = useAtom(favoriteRepositoriesAtom)
	const [recentRepositories, setRecentRepositories] = useAtom(recentRepositoriesAtom)
	const repoRollup = useAtomValue(repoRollupAtom)
	const setRepoRollup = useAtomSet(repoRollupAtom)
	const readRepoRollup = useAtomSet(readRepoRollupAtom, { mode: "promise" })
	const issuesResult = useAtomValue(issuesAtom)
	const issueLoad = useAtomValue(issueLoadAtom)
	const [selectedIssueIndex, setSelectedIssueIndex] = useAtom(selectedIssueIndexAtom)
	const pullRequests = useAtomValue(displayedPullRequestsAtom)
	const pullRequestStatus = useAtomValue(pullRequestStatusAtom)
	const pullRequestFetchInFlight = pullRequestResult.waiting
	const selectedRepository = useAtomValue(selectedRepositoryAtom)
	const selectedIssueRepository = issueViewRepository(activeIssueView)
	const pullRequestAuthorFilterActive = selectedRepository !== null && activeView._tag === "Queue" && activeView.mode === "authored"
	const issueAuthorFilterActive = selectedIssueRepository !== null && activeIssueView._tag === "Queue" && activeIssueView.mode === "authored"
	const pullRequestActiveFilterLabel = pullRequestAuthorFilterActive ? "author:@me" : null
	const issueActiveFilterLabel = issueAuthorFilterActive ? "author:@me" : null
	const isInitialLoading = !startupLoadComplete && pullRequestStatus === "loading" && pullRequests.length === 0
	const pullRequestError = AsyncResult.isFailure(pullRequestResult) ? errorMessage(Cause.squash(pullRequestResult.cause)) : null
	const issueOverrides = useAtomValue(issueOverridesAtom)
	const visibleFilterText = filterMode ? filterDraft : filterQuery
	const username = AsyncResult.isSuccess(usernameResult) ? usernameResult.value : null
	const rawIssues: readonly IssueItem[] = issueLoad?.data ?? []
	const showIssueRepositoryGroups = selectedRepository === null
	// Reorder so the array order matches IssueList's grouped display. Otherwise
	// j/k stepping jumps across groups, since groupBy reorders alphabetically.
	// Fold in optimistically-closed orphans so freshly-closed issues stay
	// visible (marked closed) until the next server refresh removes them.
	const allIssues = useMemo(() => {
		const seen = new Set<string>()
		const mapped: IssueItem[] = []
		for (const issue of rawIssues) {
			seen.add(issue.url)
			mapped.push(issueOverrides[issue.url] ?? issue)
		}
		const orphans = Object.values(issueOverrides).filter((issue) => !seen.has(issue.url) && issue.state === "closed")
		const merged = [...mapped, ...orphans].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
		return orderIssuesForDisplay(merged, showIssueRepositoryGroups)
	}, [rawIssues, issueOverrides, showIssueRepositoryGroups])
	// Server applies mode-based filtering (authored/assigned/mentioned); no client-side scope filter needed.
	// `allIssues` is already ordered by `orderIssuesForDisplay`; filterByScore preserves order when the
	// query is empty and produces score-then-time order otherwise (re-grouping that is intentional).
	const issues = useMemo(() => {
		if (activeWorkspaceSurface !== "issues" || visibleFilterText.trim().length === 0) return allIssues
		const filtered = filterByScore(allIssues, visibleFilterText, issueFilterScore, (issue) => issue.updatedAt.getTime())
		return orderIssuesForDisplay(filtered, showIssueRepositoryGroups)
	}, [activeWorkspaceSurface, allIssues, visibleFilterText, showIssueRepositoryGroups])
	const issuesStatus: LoadStatus = selectedRepository === null ? "ready" : issuesResult.waiting ? "loading" : AsyncResult.isFailure(issuesResult) ? "error" : "ready"
	const issuesError = AsyncResult.isFailure(issuesResult) ? errorMessage(Cause.squash(issuesResult.cause)) : null
	const selectedIssue = issues[Math.max(0, Math.min(selectedIssueIndex, issues.length - 1))] ?? null
	const selectedIssueRowIndex = issueListRowIndex(issues, selectedIssueIndex, showIssueRepositoryGroups)
	pullRequestStatusRef.current = pullRequestStatus

	const visibleGroups = useAtomValue(visibleGroupsAtom)
	const visiblePullRequests = useAtomValue(visiblePullRequestsAtom)
	const selectedPullRequest = useAtomValue(selectedPullRequestAtom)
	const workspaceTabSurfaces: readonly WorkspaceSurface[] = selectedRepository ? repositoryWorkspaceSurfaces : userWorkspaceSurfaces
	const allRepositoryItems = useMemo(
		(): readonly RepositoryListItem[] =>
			buildRepositoryItems({
				recentRepositories,
				favoriteRepositories,
				detectedRepository,
				repoRollup,
				pullRequests,
				allIssues,
				mockRepositoryCatalog,
			}),
		[favoriteRepositories, recentRepositories, pullRequests, allIssues, repoRollup],
	)
	const repositoryItems = useMemo(
		() => (activeWorkspaceSurface === "repos" ? allRepositoryItems.filter((repository) => repositoryFilterScore(repository, visibleFilterText) !== null) : allRepositoryItems),
		[activeWorkspaceSurface, allRepositoryItems, visibleFilterText],
	)
	const selectedRepositoryItem = repositoryItems[Math.max(0, Math.min(selectedRepositoryIndex, repositoryItems.length - 1))] ?? null
	const selectedRepositoryDetails = useRepositoryDetails(selectedRepositoryItem?.repository ?? null)
	const pullRequestComments = useAtomValue(pullRequestCommentsAtom)
	const pullRequestCommentsLoaded = useAtomValue(pullRequestCommentsLoadedAtom)
	const activeViews = useAtomValue(activeViewsAtom)
	const currentQueueCacheKey = viewCacheKey(activeView)
	const loadedPullRequestCount = useAtomValue(loadedPullRequestCountAtom)
	const hasMorePullRequests = useAtomValue(hasMorePullRequestsAtom)
	const pullRequestListFilterActive = filterMode || filterQuery.length > 0
	const visibleHasMorePullRequests = !pullRequestListFilterActive && hasMorePullRequests
	const { loadMorePullRequests, isLoadingMorePullRequests, resetLoadingMore } = useLoadMore({
		activeView,
		currentQueueCacheKey,
		pullRequestLoad,
		hasMorePullRequests,
		username,
		refreshGenerationRef,
		flashNotice,
		setQueueLoadCache,
	})
	const pullRequestListRows = useMemo(
		() =>
			buildPullRequestListRows({
				groups: visibleGroups,
				status: pullRequestStatus,
				error: pullRequestError,
				filterText: visibleFilterText,
				loadedCount: loadedPullRequestCount,
				hasMore: visibleHasMorePullRequests,
				isLoadingMore: isLoadingMorePullRequests,
			}),
		[visibleGroups, pullRequestStatus, pullRequestError, visibleFilterText, loadedPullRequestCount, visibleHasMorePullRequests, isLoadingMorePullRequests],
	)
	const selectedPullRequestRowIndex = pullRequestListRowIndex(pullRequestListRows, selectedPullRequest?.url ?? null)
	const selectedDiffKey = useAtomValue(selectedDiffKeyAtom)
	const selectedCommentSubject = activeWorkspaceSurface === "issues" ? selectedIssue : activeWorkspaceSurface === "pullRequests" ? selectedPullRequest : null
	const selectedCommentKey =
		activeWorkspaceSurface === "issues"
			? selectedIssue
				? `issue:${selectedIssue.repository}#${selectedIssue.number}`
				: null
			: activeWorkspaceSurface === "pullRequests" && selectedPullRequest
				? pullRequestDiffKey(selectedPullRequest)
				: null
	const selectedItemLabels = selectedCommentSubject?.labels ?? []
	// Stabilize the reference so the orderedComments memo only refires when the
	// underlying comment array actually changes (not every App re-render).
	const selectedComments = useMemo(() => (selectedCommentKey ? (pullRequestComments[selectedCommentKey] ?? []) : []), [selectedCommentKey, pullRequestComments])
	const selectedCommentsStatus: DetailCommentsStatus = selectedCommentKey ? (pullRequestCommentsLoaded[selectedCommentKey] ?? "idle") : "idle"
	const selectedCommentCount = activeWorkspaceSurface === "issues" ? Math.max(selectedIssue?.commentCount ?? 0, selectedComments.length) : selectedComments.length
	const selectedDiffState = useAtomValue(selectedDiffStateAtom)
	const effectiveDiffRenderView = contentWidth >= 100 ? diffRenderView : "unified"
	const readyDiffFiles = useMemo(
		() => (selectedDiffState?._tag === "Ready" ? (diffWhitespaceMode === "ignore" ? minimizeWhitespaceDiffFiles(selectedDiffState.files) : selectedDiffState.files) : []),
		[selectedDiffState, diffWhitespaceMode],
	)
	const changedFileResults = useMemo(
		() => (changedFilesModalActive ? filterChangedFiles(readyDiffFiles, changedFilesModal.query) : []),
		[changedFilesModalActive, readyDiffFiles, changedFilesModal.query],
	)
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
		contentWidth,
		diffFullView,
		diffCommentAnchorIndex,
		diffCommentRangeStartIndex,
		selectedDiffKey,
		diffCommentThreads,
	})
	const groupStarts = useAtomValue(groupStartsAtom)
	const getCurrentGroupIndex = (current: number) => {
		if (groupStarts.length === 0) return 0
		let low = 0
		let high = groupStarts.length - 1
		while (low < high) {
			const mid = (low + high + 1) >>> 1
			if (groupStarts[mid]! <= current) low = mid
			else high = mid - 1
		}
		return low
	}
	const headerRight = username ? `@${username}` : ""
	const headerLeftWidth = Math.max(0, headerFooterWidth - headerRight.length)
	const footerNotice = notice ? fitCell(notice, headerFooterWidth) : null
	const homeCrumb = "HOME"
	const breadcrumbSeparator = "/"
	const breadcrumbSeparatorText = ` ${breadcrumbSeparator} `
	const headerRepoWidth = selectedRepository ? Math.max(0, headerLeftWidth - homeCrumb.length - breadcrumbSeparatorText.length) : 0
	const selectPullRequestByUrl = (url: string) => {
		const index = visiblePullRequests.findIndex((pullRequest) => pullRequest.url === url)
		if (index >= 0) {
			setSelectedIndex(index)
			setQueueSelection((current) => ({ ...current, [currentQueueCacheKey]: index }))
		}
	}
	const updatePullRequest = (url: string, transform: (pullRequest: PullRequestItem) => PullRequestItem) => {
		const pullRequest = pullRequests.find((item) => item.url === url)
		if (!pullRequest) return
		setPullRequestOverrides((current) => ({ ...current, [url]: transform(pullRequest) }))
	}
	const updateIssue = (url: string, transform: (issue: IssueItem) => IssueItem) => {
		const issue = issues.find((item) => item.url === url)
		if (!issue) return
		setIssueOverrides((current) => ({ ...current, [url]: transform(issue) }))
	}
	const markPullRequestCompleted = (pullRequest: PullRequestItem, state: "closed" | "merged") => {
		setRecentlyCompletedPullRequests((current) => ({
			...current,
			[pullRequest.url]: {
				...pullRequest,
				state,
				autoMergeEnabled: false,
			},
		}))
	}
	const restoreOptimisticPullRequest = (pullRequest: PullRequestItem) => {
		setRecentlyCompletedPullRequests((current) => {
			if (!(pullRequest.url in current)) return current
			const next = { ...current }
			delete next[pullRequest.url]
			return next
		})
		updatePullRequest(pullRequest.url, () => pullRequest)
	}

	const { detailHydrationState, resetHydration } = useDetailHydration({
		selectedPullRequest,
		pullRequestStatus,
		visiblePullRequests,
		selectedIndex,
		currentQueueCacheKey,
		refreshGenerationRef,
		queueFetchedAtMs: pullRequestLoad?.fetchedAt?.getTime() ?? null,
		flashNotice,
		setQueueLoadCache,
	})

	const refreshPullRequests = (message?: string, options: { readonly resetTransientState?: boolean } = {}) => {
		if (pullRequestFetchInFlight) return
		refreshGenerationRef.current += 1
		resetHydration()
		resetLoadingMore()
		setPullRequestOverrides({})
		if (options.resetTransientState) {
			setRecentlyCompletedPullRequests({})
			setPullRequestComments({})
			setPullRequestCommentsLoaded({})
		}
		if (message) {
			setNotice(null)
			armRefreshToast(message)
		}
		refreshPullRequestsAtom()
	}
	refreshPullRequestsRef.current = refreshPullRequests

	const { armRefreshToast, cancelRefreshToast } = useRefreshCompletionToast({
		pullRequestStatus,
		pullRequestError,
		fetchedAt: pullRequestLoad?.fetchedAt?.getTime(),
		pullRequestLoad,
		selectedPullRequest,
		lastPullRequestRefreshAtRef,
		flashNotice,
		pullRequests,
	})

	const {
		switchViewTo,
		switchQueueMode,
		switchWorkspaceSurface,
		cycleWorkspaceSurface,
		goUpWorkspaceScope,
		openSelectedRepository,
		toggleFavoriteRepository,
		removeSelectedRepository,
	} = useWorkspaceNavigation({
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
		setRecentRepositories,
		setFavoriteRepositories,
		setActiveWorkspaceSurface,
		activeWorkspaceSurface,
		workspaceTabSurfaces,
		selectedRepository,
		selectedRepositoryItem,
		detectedRepository,
		refreshGenerationRef,
		resetHydration,
		resetLoadingMore,
		flashNotice,
	})
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
	maybeRefreshPullRequestsRef.current = (minimumAgeMs) => {
		if (!terminalFocusedRef.current || pullRequestStatusRef.current === "loading" || pullRequestFetchInFlight) return
		const lastRefreshAt = lastPullRequestRefreshAtRef.current
		if (lastRefreshAt > 0 && Date.now() - lastRefreshAt < minimumAgeMs) return
		refreshPullRequestsRef.current()
	}

	useEffect(() => {
		const fetchedAt = pullRequestLoad?.fetchedAt?.getTime()
		if (fetchedAt !== undefined) {
			lastPullRequestRefreshAtRef.current = fetchedAt
		}
	}, [pullRequestLoad?.fetchedAt])

	// View-change refetch is now driven by `pullRequestsAtom`'s reactive
	// dependency on `activeViewAtom`. `pullRequestLoadAtom` reads the in-memory
	// cache first, so the user sees the previous list instantly while the new
	// view's fetch lands.

	// Best-effort startup prune: writeQueue prunes after each successful refresh,
	// but a session that only browses cached state (or stays offline) never prunes.
	// Firing once at mount keeps the cache bounded for those sessions.
	useEffect(() => {
		void pruneCache().catch(() => {})
	}, [pruneCache])

	const { terminalFocusedRef } = useFocusReturnRefresh({
		renderer,
		lastRefreshAtRef: lastPullRequestRefreshAtRef,
		refreshGeneration: pullRequestLoad?.fetchedAt?.getTime(),
		focusReturnMinMs: FOCUS_RETURN_REFRESH_MIN_MS,
		idleAfterMs: FOCUSED_IDLE_REFRESH_MS,
		jitterMs: AUTO_REFRESH_JITTER_MS,
		onRefresh: (ms) => maybeRefreshPullRequestsRef.current(ms),
	})

	useClampedIndex(visiblePullRequests.length, setSelectedIndex)
	useClampedIndex(issues.length, setSelectedIssueIndex)
	useClampedIndex(repositoryItems.length, setSelectedRepositoryIndex)

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

	// Hydrate the repo rollup once we know who we are. The rollup seeds the
	// Repos tab with cached counts and last-activity dates so it can render
	// before the live PR + issue queries return. Re-runs whenever live queue
	// loads land so the rollup stays current within the session.
	useEffect(() => {
		if (!username) return
		void readRepoRollup(username)
			.then((rows) => setRepoRollup(rows))
			.catch(() => {})
	}, [username, pullRequestLoad?.fetchedAt, issueLoad?.fetchedAt, readRepoRollup, setRepoRollup])

	// Background prewarm of `repository_details` for the user's repo set.
	// Skips fetches with cached rows younger than the in-atom TTL. Fire-and-
	// forget; failures don't surface to the user.
	useEffect(() => {
		if (!username) return
		const repositories = Array.from(new Set([...recentRepositories, ...Object.keys(favoriteRepositories), ...(detectedRepository ? [detectedRepository] : [])]))
		if (repositories.length === 0) return
		void prewarmRepositoryDetails(repositories).catch(() => {})
	}, [username, recentRepositories, favoriteRepositories, prewarmRepositoryDetails])

	useEffect(() => {
		setQueueSelection((current) => (current[currentQueueCacheKey] === selectedIndex ? current : { ...current, [currentQueueCacheKey]: selectedIndex }))
	}, [currentQueueCacheKey, selectedIndex])

	useLoadMoreOnScroll({
		prListScrollRef,
		visiblePullRequestsLength: visiblePullRequests.length,
		pullRequestListFilterActive,
		selectedIndex,
		hasMorePullRequests,
		isLoadingMorePullRequests,
		detailFullView,
		diffFullView,
		currentQueueCacheKey,
		loadMorePullRequests,
	})

	useScrollFollowSelected(prListScrollRef, selectedPullRequestRowIndex)
	useScrollFollowSelected(issueListScrollRef, issues.length === 0 ? null : selectedIssueRowIndex)

	// Keep list scroll position when toggling between surfaces. Each list's
	// scrollbox remounts on surface switch; without persistence it starts at
	// scrollTop=0 and useScrollFollowSelected snaps it back to the selected
	// row — reads as a jump.
	useScrollPersistence(prListScrollRef, prListScrollPersistedRef, activeWorkspaceSurface === "pullRequests" && !detailFullView && !diffFullView && !commentsViewActive)
	useScrollPersistence(issueListScrollRef, issueListScrollPersistedRef, activeWorkspaceSurface === "issues" && !detailFullView && !diffFullView && !commentsViewActive)

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
	const selectedPullRequestDetailHydrationState = selectedPullRequestDetailKey ? (detailHydrationState[selectedPullRequestDetailKey] ?? null) : null
	const selectedPullRequestDetailError = selectedPullRequestDetailHydrationState?._tag === "Error" ? selectedPullRequestDetailHydrationState.message : null
	const isHydratingPullRequestDetails = selectedPullRequestDetailHydrationState?._tag === "Loading"
	const isRefreshingPullRequests = pullRequestResult.waiting && pullRequestLoad !== null
	const isActiveSurfaceLoading =
		(activeWorkspaceSurface === "pullRequests" && (pullRequestStatus === "loading" || isRefreshingPullRequests || isHydratingPullRequestDetails || isLoadingMorePullRequests)) ||
		(activeWorkspaceSurface === "issues" && issuesStatus === "loading")
	const hasActiveLoadingIndicator =
		pullRequestResult.waiting ||
		isHydratingPullRequestDetails ||
		isLoadingMorePullRequests ||
		selectedCommentsStatus === "loading" ||
		labelModal.loading ||
		closeModal.running ||
		pullRequestStateModal.running ||
		mergeModal.loading ||
		mergeModal.running ||
		submitReviewModal.running ||
		selectedDiffState?._tag === "Loading"
	const loadingFrame = useSpinnerFrame({ active: hasActiveLoadingIndicator, reset: isInitialLoading })
	const loadingIndicator = SPINNER_FRAMES[loadingFrame % SPINNER_FRAMES.length]!

	useEffect(() => {
		if (startupLoadComplete || pullRequestStatus === "loading") return
		setStartupLoadComplete(true)
	}, [startupLoadComplete, pullRequestStatus])

	useEffect(() => {
		if (pullRequestStatus !== "ready" || !selectedPullRequest) return
		loadPullRequestComments(selectedPullRequest)
	}, [pullRequestStatus, selectedPullRequest?.url, selectedPullRequest?.headRefOid, selectedPullRequest?.repository, selectedPullRequest?.number])

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

	const openDiffView = () => {
		if (!selectedPullRequest) return
		resetDiffLineColors()
		setDiffFullView(true)
		setDetailFullView(false)
		setCommentsViewActive(false)
		setDiffFileIndex(0)
		setDiffScrollTop(0)
		setDiffCommentAnchorIndex(0)
		setDiffPreferredSide(null)
		setDiffCommentRangeStartIndex(null)
		setDiffRenderView(contentWidth >= 100 ? "split" : "unified")
		diffScrollRef.current?.scrollTo({ x: 0, y: 0 })
		loadPullRequestDiff(selectedPullRequest, { includeComments: true })
	}

	const openCommentsView = () => {
		if (activeWorkspaceSurface === "issues") {
			if (!selectedIssue) return
			loadIssueComments(selectedIssue, true)
		} else {
			if (!selectedPullRequest) return
			loadPullRequestComments(selectedPullRequest, true)
		}
		setCommentsViewActive(true)
		setDetailFullView(false)
		setDiffFullView(false)
		setCommentsViewSelection(0)
	}

	const closeCommentsView = () => {
		setCommentsViewActive(false)
	}

	// j/k navigates the *visual* (threaded) order, not the raw load order — so
	// the comment under the cursor is the one immediately below the previously
	// highlighted row, regardless of where it lives in the flat array.
	const orderedComments = useMemo(() => orderCommentsForDisplay(selectedComments), [selectedComments])
	const selectedOrderedComment = orderedComments[commentsViewSelection]?.comment ?? null
	const commentsRowCount = commentsViewRowCount(selectedComments.length)
	const moveCommentsSelection = (delta: number) => {
		setCommentsViewSelection((current) => {
			const max = commentsRowCount - 1
			return Math.max(0, Math.min(max, current + delta))
		})
	}

	const setCommentsSelection = (index: number) => {
		const max = commentsRowCount - 1
		setCommentsViewSelection(Math.max(0, Math.min(max, index)))
	}

	const confirmCommentSelection = () => {
		if (commentsViewSelection >= selectedComments.length) {
			openNewIssueCommentModal()
			return
		}
		openReplyToSelectedComment()
	}

	const openSelectedCommentInBrowser = () => {
		const comment = selectedOrderedComment
		if (!comment?.url) return
		void openUrl(comment.url)
			.then(() => flashNotice(`Opened ${comment.url}`))
			.catch((error) => flashNotice(errorMessage(error)))
	}

	const refreshSelectedComments = () => {
		if (activeWorkspaceSurface === "issues") {
			if (selectedIssue) loadIssueComments(selectedIssue, true)
		} else if (selectedPullRequest) {
			loadPullRequestComments(selectedPullRequest, true)
		}
	}

	const scrollDetailPreviewBy = (y: number) => {
		detailPreviewScrollRef.current?.scrollBy({ x: 0, y })
	}
	const scrollDetailPreviewTo = (y: number) => {
		detailPreviewScrollRef.current?.scrollTo({ x: 0, y })
	}

	const setCommentEditorValue = (body: string, cursor: number) => {
		setCommentModal((current) => (current.body === body && current.cursor === cursor && current.error === null ? current : { ...current, body, cursor, error: null }))
	}

	const editSubmitReview = (transform: (state: CommentEditorValue) => CommentEditorValue) => {
		setSubmitReviewModal((current) => {
			const next = transform({ body: current.body, cursor: current.cursor })
			if (next.body === current.body && next.cursor === current.cursor && current.error === null) return current
			return { ...current, body: next.body, cursor: next.cursor, error: null }
		})
	}

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

	const { movePullRequestStateSelection, confirmPullRequestStateChange, confirmCloseModal, toggleLabelAtIndex, confirmSubmitReview } = usePullRequestModalActions({
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
		refreshIssuesAtomRaw,
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
	const scrollDetailFullViewBy = (delta: number) => {
		detailScrollRef.current?.scrollBy({ x: 0, y: delta })
		setDetailScrollOffset((current) => Math.max(0, current + delta))
	}
	const scrollDetailFullViewTo = (y: number) => {
		detailScrollRef.current?.scrollTo({ x: 0, y })
		setDetailScrollOffset(y)
	}
	const { stepSelected, stepSelectedDown, stepSelectedUp, stepSelectedDownWithLoadMore, stepSelectedUpWrap, moveSelectedToPreviousGroup, moveSelectedToNextGroup } =
		useListSelectionStepping({
			activeWorkspaceSurface,
			visiblePullRequests,
			issues,
			repositoryItems,
			selectedIndex,
			visibleHasMorePullRequests,
			groupStarts,
			getCurrentGroupIndex,
			setSelectedIndex,
			setSelectedIssueIndex,
			setSelectedRepositoryIndex,
			loadMorePullRequests,
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

	// === Build the keymap context ===
	const appCtx: AppCtx = buildAppCtx({
		flags: {
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
			textInputActive:
				commentModalActive ||
				commandPaletteActive ||
				openRepositoryModalActive ||
				changedFilesModalActive ||
				submitReviewModalActive ||
				labelModalActive ||
				filterMode ||
				(themeModalActive && themeModal.filterMode),
		},
		closeModal: { closeActiveModal, confirmCloseModal },
		pullRequestStateModal: { closeActiveModal, confirmPullRequestStateChange, movePullRequestStateSelection },
		mergeModal: { mergeModal, cancelOrCloseMergeModal, confirmMergeAction, cycleMergeMethod, moveMergeSelection },
		commentThreadModal: { halfPage, closeActiveModal, openDiffCommentModal, scrollCommentThread },
		changedFilesModal: { hasResults: changedFileResults.length > 0, closeActiveModal, selectChangedFile, moveChangedFileSelection },
		filterModal: { closeActiveModal, applySelected: applySelectedFilter, moveSelection: moveFilterSelection },
		submitReviewModal: { submitReviewModal, closeActiveModal, setSubmitReviewModal, confirmSubmitReview, editSubmitReview, moveSubmitReviewActionSelection },
		labelModal: { closeActiveModal, toggleLabelAtIndex, moveLabelSelection },
		themeModal: { themeModal, closeThemeModal, updateThemeQuery, toggleThemeMode, toggleThemeTone, moveThemeSelection },
		openRepositoryModal: { closeActiveModal, openRepositoryFromInput },
		commentModal: { closeActiveModal },
		deleteCommentModal: { closeActiveModal, confirmDeleteComment },
		commandPalette: { closeActiveModal, selectedCommand, runCommandPaletteCommand, moveCommandPaletteSelection },
		filterModeCtx: {
			cancelFilter: () => {
				setFilterDraft(filterQuery)
				setFilterMode(false)
			},
			commitFilter: () => {
				setFilterQuery(filterDraft)
				setFilterMode(false)
			},
		},
		diff: {
			halfPage,
			diffCommentRangeActive,
			setDiffCommentRangeStartIndex,
			runCommandById,
			openSelectedDiffComment,
			moveDiffCommentAnchor,
			moveDiffCommentToBoundary,
			alignSelectedDiffCommentAnchor,
			selectDiffCommentSide,
		},
		detail: { halfPage, activeSurface: activeWorkspaceSurface, scrollDetailFullViewBy, scrollDetailFullViewTo, runCommandById },
		commentsView: {
			halfPage,
			visibleCount: commentsRowCount,
			canEditSelected: canEditComment(selectedOrderedComment, username),
			moveCommentsSelection,
			setCommentsSelection,
			closeCommentsView,
			openSelectedCommentInBrowser,
			refreshSelectedComments,
			confirmCommentSelection,
			runCommandById,
		},
		listNav: {
			halfPage,
			visibleCount: activeWorkspaceSurface === "repos" ? repositoryItems.length : activeWorkspaceSurface === "pullRequests" ? visiblePullRequests.length : issues.length,
			hasFilter: filterQuery.length > 0,
			activeSurface: activeWorkspaceSurface,
			surfaces: workspaceTabSurfaces,
			canGoUpWorkspace: selectedRepository !== null,
			canScrollDetailPreview:
				(activeWorkspaceSurface === "pullRequests" && selectedPullRequest !== null) ||
				(activeWorkspaceSurface === "issues" && !isWideLayout && selectedIssue !== null) ||
				(activeWorkspaceSurface === "repos" && !isWideLayout && selectedRepositoryItem !== null),
			runCommandById,
			openSelection: () => {
				if (activeWorkspaceSurface === "repos") openSelectedRepository()
				else runCommandById("detail.open")
			},
			openRepositoryPicker,
			toggleFavoriteRepository,
			removeSelectedRepository,
			openFilterModal,
			goUpWorkspace: () => {
				goUpWorkspaceScope()
			},
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
			setSelected: (index) =>
				activeWorkspaceSurface === "repos" ? setSelectedRepositoryIndex(index) : activeWorkspaceSurface === "issues" ? setSelectedIssueIndex(index) : setSelectedIndex(index),
		},
		openCommandPalette: () => runCommandById("command.open"),
		handleQuitOrClose,
	})

	useKeymap(appKeymap, appCtx, useOpenTuiSubscribe())

	useTextInputDispatcher({
		commandPaletteActive,
		openRepositoryModalActive,
		themeModalActive,
		commentModalActive,
		submitReviewModalActive,
		changedFilesModalActive,
		labelModalActive,
		filterMode,
		detailFullView,
		diffFullView,
		commentsViewActive,
		themeModal,
		submitReviewModal,
		workspaceTabSurfaces,
		activeWorkspaceSurface,
		switchWorkspaceSurface,
		setCommandPalette,
		setOpenRepositoryModal,
		setChangedFilesModal,
		setLabelModal,
		setFilterDraft,
		editThemeQuery,
		editSubmitReview,
	})

	if (isInitialLoading) {
		return (
			<box width={terminalWidth} height={terminalHeight} flexDirection="column" backgroundColor={colors.background}>
				<LoadingLogoPane content={detailPlaceholderContent} width={contentWidth} height={terminalHeight} frame={loadingFrame} />
			</box>
		)
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
	})
	const {
		fullscreenDetailHeaderHeight,
		fullscreenDetailBodyScrollable,
		wideDetailHeaderHeight,
		wideDetailBodyScrollable,
		narrowPullRequestListHeight,
		narrowDetailsPaneHeight,
		narrowRepoListHeight,
		narrowRepoDetailHeight,
		narrowIssueListHeight,
		narrowIssueDetailHeight,
		narrowPreviewBodyHeight,
		narrowPreviewBodyScrollable,
		widePullRequestListHeight,
		narrowPullRequestRowsHeight,
		widePullRequestListNeedsScroll,
		narrowPullRequestListNeedsScroll,
		detailJunctions,
		prListProps,
		issueListProps,
		repoListProps,
		showPaneSplit,
		issueJunctions,
		issueListNeedsScroll,
		narrowIssueListNeedsScroll,
		repoListNeedsScroll,
		narrowRepoListNeedsScroll,
		workspaceTabCounts,
		filterPlaceholder,
		workspaceTopDividerJunctions,
		workspaceBottomDividerJunctions,
	} = derivations

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
	return (
		<box width={terminalWidth} height={terminalHeight} flexDirection="column" backgroundColor={colors.background}>
			<box paddingLeft={1} paddingRight={1} flexDirection="column" backgroundColor={colors.background}>
				<box width={headerFooterWidth} height={1} flexDirection="row">
					<WorkspaceHeader
						selectedRepository={selectedRepository}
						homeCrumb={homeCrumb}
						breadcrumbSeparatorText={breadcrumbSeparatorText}
						headerLeftWidth={headerLeftWidth}
						headerRepoWidth={headerRepoWidth}
						homeCrumbHovered={homeCrumbHovered}
						setHomeCrumbHovered={setHomeCrumbHovered}
						goUpWorkspaceScope={goUpWorkspaceScope}
					/>
					{headerRight ? (
						<TextLine width={headerRight.length}>
							<span fg={colors.muted}>{headerRight}</span>
						</TextLine>
					) : null}
				</box>
			</box>
			<Divider width={contentWidth} junctions={workspaceTopDividerJunctions} />
			{showWorkspaceTabs ? (
				<>
					<box paddingRight={1} backgroundColor={colors.background}>
						<WorkspaceTabs
							activeSurface={activeWorkspaceSurface}
							width={Math.max(24, contentWidth - 1)}
							surfaces={workspaceTabSurfaces}
							counts={workspaceTabCounts}
							onSelect={switchWorkspaceSurface}
						/>
					</box>
					<Divider width={contentWidth} junctions={workspaceBottomDividerJunctions} />
				</>
			) : null}
			<WorkspaceContent
				activeWorkspaceSurface={activeWorkspaceSurface}
				commentsViewActive={commentsViewActive}
				diffFullView={diffFullView}
				detailFullView={detailFullView}
				isWideLayout={isWideLayout}
				wideBodyHeight={wideBodyHeight}
				contentWidth={contentWidth}
				leftPaneWidth={leftPaneWidth}
				rightPaneWidth={rightPaneWidth}
				leftContentWidth={leftContentWidth}
				rightContentWidth={rightContentWidth}
				fullscreenContentWidth={fullscreenContentWidth}
				sectionPadding={sectionPadding}
				wideDetailHeaderHeight={wideDetailHeaderHeight}
				wideDetailBodyScrollable={wideDetailBodyScrollable}
				wideDetailLines={wideDetailLines}
				fullscreenDetailHeaderHeight={fullscreenDetailHeaderHeight}
				fullscreenDetailBodyScrollable={fullscreenDetailBodyScrollable}
				fullscreenBodyLines={fullscreenBodyLines}
				widePullRequestListHeight={widePullRequestListHeight}
				widePullRequestListNeedsScroll={widePullRequestListNeedsScroll}
				narrowPullRequestListHeight={narrowPullRequestListHeight}
				narrowPullRequestRowsHeight={narrowPullRequestRowsHeight}
				narrowPullRequestListNeedsScroll={narrowPullRequestListNeedsScroll}
				narrowDetailsPaneHeight={narrowDetailsPaneHeight}
				narrowPreviewBodyHeight={narrowPreviewBodyHeight}
				narrowPreviewBodyScrollable={narrowPreviewBodyScrollable}
				narrowRepoListHeight={narrowRepoListHeight}
				narrowRepoDetailHeight={narrowRepoDetailHeight}
				narrowIssueListHeight={narrowIssueListHeight}
				narrowIssueDetailHeight={narrowIssueDetailHeight}
				repoListNeedsScroll={repoListNeedsScroll}
				narrowRepoListNeedsScroll={narrowRepoListNeedsScroll}
				repoListProps={repoListProps}
				selectedRepositoryItem={selectedRepositoryItem}
				selectedRepositoryDetails={selectedRepositoryDetails}
				issueListNeedsScroll={issueListNeedsScroll}
				narrowIssueListNeedsScroll={narrowIssueListNeedsScroll}
				issueActiveFilterLabel={issueActiveFilterLabel}
				issueJunctions={issueJunctions}
				issueListProps={issueListProps}
				selectedIssue={selectedIssue}
				issueListScrollRef={issueListScrollRef}
				pullRequestActiveFilterLabel={pullRequestActiveFilterLabel}
				detailJunctions={detailJunctions}
				prListProps={prListProps}
				selectedPullRequest={selectedPullRequest}
				selectedComments={selectedComments}
				selectedCommentsStatus={selectedCommentsStatus}
				detailPlaceholderContent={detailPlaceholderContent}
				isSelectedPullRequestDetailLoading={isSelectedPullRequestDetailLoading}
				isSelectedPullRequestDetailError={isSelectedPullRequestDetailError}
				selectedPullRequestDetailError={selectedPullRequestDetailError}
				commentsViewSelection={commentsViewSelection}
				orderedComments={orderedComments}
				selectedCommentSubject={selectedCommentSubject}
				displayedDiffState={displayedDiffState}
				stackedDiffFiles={stackedDiffFiles}
				diffScrollTop={diffScrollTop}
				effectiveDiffRenderView={effectiveDiffRenderView}
				diffWhitespaceMode={diffWhitespaceMode}
				diffWrapMode={diffWrapMode}
				selectedDiffCommentAnchor={selectedDiffCommentAnchor}
				selectedDiffCommentLabel={selectedDiffCommentLabel}
				selectedDiffCommentThread={selectedDiffCommentThread}
				selectDiffCommentLine={selectDiffCommentLine}
				setDiffRenderableRef={setDiffRenderableRef}
				loadingIndicator={loadingIndicator}
				themeId={themeId}
				systemThemeGeneration={systemThemeGeneration}
				prListScrollRef={prListScrollRef}
				detailScrollRef={detailScrollRef}
				detailPreviewScrollRef={detailPreviewScrollRef}
				diffScrollRef={diffScrollRef}
				openInlineLink={openInlineLink}
			/>

			{showPaneSplit ? <Divider width={contentWidth} junctionAt={dividerJunctionAt} junctionChar="┴" /> : <Divider width={contentWidth} />}
			<WorkspaceFooter
				footerNotice={footerNotice}
				filterMode={filterMode}
				visibleFilterText={visibleFilterText}
				filterPlaceholder={filterPlaceholder}
				showFilterClear={filterMode || filterQuery.length > 0}
				detailFullView={detailFullView}
				diffFullView={diffFullView}
				diffRangeActive={diffCommentRangeActive}
				commentsViewActive={commentsViewActive}
				commentsViewOnRealComment={commentsViewActive && selectedCommentsStatus === "ready" && selectedOrderedComment !== null}
				commentsViewCanEditSelected={canEditComment(selectedOrderedComment, username)}
				commentsViewCount={selectedComments.length}
				hasSelection={selectedCommentSubject !== null}
				canOpenDetails={selectedCommentSubject !== null}
				canOpenRepository={activeWorkspaceSurface === "repos" && selectedRepositoryItem !== null}
				canAddRepository={activeWorkspaceSurface === "repos"}
				canRemoveRepository={activeWorkspaceSurface === "repos" && selectedRepositoryItem !== null}
				canCycleScopeFilter={selectedRepository !== null && (activeWorkspaceSurface === "pullRequests" || activeWorkspaceSurface === "issues")}
				canOpenDiff={activeWorkspaceSurface === "pullRequests" && selectedPullRequest !== null}
				canOpenComments={selectedCommentSubject !== null}
				hasComments={selectedCommentCount > 0}
				hasError={pullRequestStatus === "error"}
				isLoading={isActiveSurfaceLoading || closeModal.running || pullRequestStateModal.running || mergeModal.running || submitReviewModal.running}
				loadingIndicator={loadingIndicator}
				retryProgress={retryProgress}
			/>
			<WorkspaceModals
				activeModal={activeModal}
				loadingIndicator={loadingIndicator}
				selectedItemLabels={selectedItemLabels}
				commentAnchorLabel={commentAnchorLabel}
				selectedDiffCommentThread={selectedDiffCommentThread}
				changedFileResults={changedFileResults}
				readyDiffFileCount={readyDiffFiles.length}
				commandPaletteCommands={commandPaletteCommands}
				selectedCommandIndex={selectedCommandIndex}
				onSelectCommandIndex={selectCommandPaletteIndex}
				onRunCommand={runCommandPaletteCommand}
				onCommentChange={setCommentEditorValue}
				onCommentSubmit={submitCommentModal}
				layouts={{
					Label: modalLayouts.label,
					Close: modalLayouts.close,
					PullRequestState: modalLayouts.pullRequestState,
					Comment: modalLayouts.comment,
					DeleteComment: modalLayouts.deleteComment,
					CommentThread: modalLayouts.commentThread,
					ChangedFiles: modalLayouts.changedFiles,
					Filter: modalLayouts.filter,
					SubmitReview: modalLayouts.submitReview,
					Merge: modalLayouts.merge,
					Theme: modalLayouts.theme,
					OpenRepository: modalLayouts.openRepository,
					CommandPalette: modalLayouts.commandPalette,
				}}
			/>
		</box>
	)
}
