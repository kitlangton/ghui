import { type ScrollBoxRenderable } from "@opentui/core"
import { RegistryContext, useAtom, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useKeymap } from "@ghui/keymap/react"
import { appKeymap, type AppCtx } from "./keymap/all.js"
import { buildAppCtx } from "./keymap/contexts/appCtx.js"
import { useOpenTuiSubscribe } from "./keyboard/opentuiAdapter.js"
import { useRenderer, useTerminalDimensions } from "@opentui/react"
import { Cause, Effect } from "effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { AppCommand } from "./commands.js"
import { clampCommandIndex, type CommandScope, commandEnabled, defineCommand, filterCommands, sortCommandsByActiveScope } from "./commands.js"
import { commandSnapshotsAtom } from "./commands/atoms.js"
import { dispatchCommandAtom } from "./commands/dispatch.js"
import { type IssueItem, type LoadStatus, type PullRequestItem, type PullRequestReviewComment, type SubmitPullRequestReviewInput } from "./domain.js"
import { errorMessage } from "./errors.js"
import { nextView, parseRepositoryInput, type PullRequestView, viewCacheKey, viewEquals } from "./pullRequestViews.js"

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
	pullRequestRevisionAtomKey,
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
	pullRequestDiffAtom,
	pullRequestDiffCacheAtom,
	selectedDiffKeyAtom,
	selectedDiffStateAtom,
} from "./ui/diff/atoms.js"
import {
	diffCommentRangeContains,
	diffCommentRangeLabel,
	diffCommentRangeSelection,
	diffCommentThreadMapKey,
	groupDiffCommentThreads,
	isLocalDiffComment,
} from "./ui/diff/comments.js"
import { useDiffLineColors } from "./ui/diff/useDiffLineColors.js"
import { useDiffLocationPreservation } from "./ui/diff/useDiffLocationPreservation.js"
import { useDiffPrefetch } from "./ui/diff/useDiffPrefetch.js"
import { themeIdAtom } from "./ui/theme/atoms.js"
import { useThemeModal } from "./ui/theme/useThemeModal.js"
import { useMergeFlow } from "./ui/merge/useMergeFlow.js"
import { insertText, type CommentEditorValue } from "./ui/commentEditor.js"
import {
	buildStackedDiffFiles,
	diffCommentAnchorLabel,
	diffCommentLocationKey,
	getStackedDiffCommentAnchors,
	minimizeWhitespaceDiffFiles,
	PullRequestDiffState,
	pullRequestDiffKey,
	safeDiffFileIndex,
	splitPatchFiles,
	type StackedDiffCommentAnchor,
} from "./ui/diff.js"
import { type DetailCommentsStatus, type DetailPlaceholderContent } from "./ui/DetailsPane.js"
import { RetryProgress } from "./ui/FooterHints.js"
import { LoadingLogoPane } from "./ui/LoadingLogo.js"
import { Divider, fitCell, TextLine } from "./ui/primitives.js"
import {
	filterChangedFiles,
	filterLabels,
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
import { IssueSurface } from "./surfaces/IssueSurface.js"
import { PullRequestSurface } from "./surfaces/PullRequestSurface.js"
import { RepoSurface } from "./surfaces/RepoSurface.js"
import { WorkspaceFooter } from "./surfaces/WorkspaceFooter.js"
import { WorkspaceHeader } from "./surfaces/WorkspaceHeader.js"
import { WorkspaceModals } from "./surfaces/WorkspaceModals.js"
import { WorkspaceTabs } from "./ui/WorkspaceTabs.js"
import { issueListRowIndex, orderIssuesForDisplay } from "./ui/IssueList.js"
import { parseIssueReferenceUrl } from "./ui/inlineSegments.js"
import { singleLineText } from "./ui/singleLineInput.js"
import { SPINNER_FRAMES } from "./ui/spinner.js"
import { useClampedIndex } from "./ui/useClampedIndex.js"
import { usePasteHandler } from "./ui/usePasteHandler.js"
import { useScrollFollowSelected } from "./ui/useScrollFollowSelected.js"
import { useScrollPersistence } from "./ui/useScrollPersistence.js"
import { useSpinnerFrame } from "./ui/useSpinnerFrame.js"
import { useTextInputDispatcher } from "./ui/useTextInputDispatcher.js"
import { useCommandHandoffs } from "./hooks/useCommandHandoffs.js"
import { useDiffCommentNavigator } from "./hooks/useDiffCommentNavigator.js"
import { usePullRequestModalActions } from "./hooks/usePullRequestModalActions.js"
import { commandRuntimeAtom } from "./commands/runtimeAtom.js"
import { issueViewForPullRequestView } from "./viewSync.js"
import { nextWorkspaceSurface, repositoryWorkspaceSurfaces, userWorkspaceSurfaces, type WorkspaceSurface } from "./workspaceSurfaces.js"
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
const LOAD_MORE_SELECTION_THRESHOLD = 8
const LOAD_MORE_SCROLL_THRESHOLD = 3
const wrapIndex = (index: number, length: number) => (length === 0 ? 0 : ((index % length) + length) % length)

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
	const allRepositoryItems = useMemo((): readonly RepositoryListItem[] => {
		const byRepository = new Map<string, RepositoryListItem>()
		const catalog = new Map(mockRepositoryCatalog.map((item) => [item.repository, item]))
		const ensure = (repository: string): RepositoryListItem => {
			const existing = byRepository.get(repository)
			if (existing) return existing
			const catalogItem = catalog.get(repository)
			const item: RepositoryListItem = {
				repository,
				pullRequestCount: 0,
				issueCount: 0,
				current: repository === detectedRepository,
				favorite: favoriteRepositories[repository] === true,
				recent: recentRepositories.includes(repository),
				lastActivityAt: null,
				description: catalogItem?.description ?? null,
			}
			byRepository.set(repository, item)
			return item
		}
		// Seed phase: repos surfaced by user state (favorites/recents/cwd) and by
		// the cached rollup, so the Repos tab can render with counts + activity
		// dates before the live PR/issue queries return.
		for (const repository of [...recentRepositories, ...Object.keys(favoriteRepositories), ...(detectedRepository ? [detectedRepository] : [])]) {
			ensure(repository)
		}
		for (const row of repoRollup) {
			const item = ensure(row.repository)
			byRepository.set(row.repository, {
				...item,
				pullRequestCount: row.pullRequestCount,
				issueCount: row.issueCount,
				lastActivityAt: row.lastActivityAt,
			})
		}
		// Live phase: aggregate per-repo from the currently-loaded PR + issue
		// arrays, then *override* the seeded counts/activity for repos that have
		// fresh data. Repos with rollup-only data keep their cached values.
		const liveCounts = new Map<string, { pullRequestCount: number; issueCount: number; lastActivityAt: Date | null }>()
		const bumpLive = (repository: string, at: Date, key: "pullRequestCount" | "issueCount") => {
			const entry = liveCounts.get(repository) ?? { pullRequestCount: 0, issueCount: 0, lastActivityAt: null }
			entry[key] = entry[key] + 1
			if (!entry.lastActivityAt || entry.lastActivityAt < at) entry.lastActivityAt = at
			liveCounts.set(repository, entry)
		}
		for (const pullRequest of pullRequests) {
			bumpLive(pullRequest.repository, pullRequest.updatedAt, "pullRequestCount")
		}
		for (const issue of allIssues) {
			bumpLive(issue.repository, issue.updatedAt, "issueCount")
		}
		for (const [repository, entry] of liveCounts) {
			const current = ensure(repository)
			const lastActivityAt = entry.lastActivityAt && (!current.lastActivityAt || current.lastActivityAt < entry.lastActivityAt) ? entry.lastActivityAt : current.lastActivityAt
			byRepository.set(repository, {
				...current,
				pullRequestCount: entry.pullRequestCount,
				issueCount: entry.issueCount,
				lastActivityAt,
			})
		}
		return [...byRepository.values()].sort((left, right) => {
			if (left.current !== right.current) return left.current ? -1 : 1
			if (left.favorite !== right.favorite) return left.favorite ? -1 : 1
			if (left.recent !== right.recent) return left.recent ? -1 : 1
			const leftTime = left.lastActivityAt?.getTime() ?? 0
			const rightTime = right.lastActivityAt?.getTime() ?? 0
			return rightTime - leftTime || left.repository.localeCompare(right.repository)
		})
	}, [favoriteRepositories, recentRepositories, pullRequests, allIssues, repoRollup])
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
	const displayedDiffState = useMemo(
		() =>
			selectedDiffState?._tag === "Ready" ? PullRequestDiffState.Ready({ patch: readyDiffFiles.map((file) => file.patch).join("\n"), files: readyDiffFiles }) : selectedDiffState,
		[selectedDiffState, readyDiffFiles],
	)
	const stackedDiffFiles = useMemo(
		() => buildStackedDiffFiles(readyDiffFiles, effectiveDiffRenderView, diffWrapMode, contentWidth),
		[readyDiffFiles, effectiveDiffRenderView, diffWrapMode, contentWidth],
	)
	const diffCommentAnchors = useMemo(
		() => (diffFullView ? getStackedDiffCommentAnchors(stackedDiffFiles, effectiveDiffRenderView, diffWrapMode, contentWidth) : []),
		[diffFullView, stackedDiffFiles, effectiveDiffRenderView, diffWrapMode, contentWidth],
	)
	const selectedDiffCommentAnchorIndex = Math.max(0, Math.min(diffCommentAnchorIndex, diffCommentAnchors.length - 1))
	const selectedDiffCommentAnchor = diffCommentAnchors[selectedDiffCommentAnchorIndex] ?? null
	const diffCommentRangeStartAnchor =
		diffCommentRangeStartIndex === null ? null : (diffCommentAnchors[Math.max(0, Math.min(diffCommentRangeStartIndex, diffCommentAnchors.length - 1))] ?? null)
	const selectedDiffCommentRange = useMemo(
		() => diffCommentRangeSelection(diffCommentRangeStartAnchor, selectedDiffCommentAnchor),
		[diffCommentRangeStartAnchor, selectedDiffCommentAnchor],
	)
	const selectedDiffCommentRangeAnchors = useMemo(
		() => (selectedDiffCommentRange ? diffCommentAnchors.filter((anchor) => diffCommentRangeContains(selectedDiffCommentRange, anchor)) : []),
		[diffCommentAnchors, selectedDiffCommentRange],
	)
	const diffCommentRangeActive = selectedDiffCommentRange !== null
	const selectedDiffCommentLabel = selectedDiffCommentRange
		? diffCommentRangeLabel(selectedDiffCommentRange)
		: selectedDiffCommentAnchor
			? diffCommentAnchorLabel(selectedDiffCommentAnchor)
			: null
	const selectedDiffCommentThreadKey = selectedDiffKey && selectedDiffCommentAnchor ? diffCommentThreadMapKey(selectedDiffKey, selectedDiffCommentAnchor) : null
	const selectedDiffCommentThread = selectedDiffCommentThreadKey ? (diffCommentThreads[selectedDiffCommentThreadKey] ?? []) : []
	const diffLineColorContextKey = selectedDiffKey ? `${selectedDiffKey}:${effectiveDiffRenderView}:${diffWrapMode}:${diffWhitespaceMode}` : null
	const diffCommentThreadAnchors = useMemo(() => {
		if (!selectedDiffKey) return [] as readonly StackedDiffCommentAnchor[]
		const seen = new Set<string>()
		return diffCommentAnchors.filter((anchor) => {
			const key = diffCommentLocationKey(anchor)
			if (seen.has(key)) return false
			if ((diffCommentThreads[diffCommentThreadMapKey(selectedDiffKey, anchor)]?.length ?? 0) === 0) return false
			seen.add(key)
			return true
		})
	}, [diffCommentAnchors, diffCommentThreads, selectedDiffKey])
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
	const switchViewTo = (view: PullRequestView) => {
		if (viewEquals(view, activeView)) return
		refreshGenerationRef.current += 1
		setQueueSelection((current) => ({ ...current, [currentQueueCacheKey]: selectedIndex }))
		setActiveView(view)
		setSelectedIndex(registry.get(queueSelectionAtom)[viewCacheKey(view)] ?? 0)
		setSelectedIssueIndex(0)
		setRecentlyCompletedPullRequests({})
		resetHydration()
		resetLoadingMore()
		setDetailFullView(false)
		setDiffFullView(false)
		setDiffCommentRangeStartIndex(null)
		setFilterDraft(filterQuery)
		setNotice(null)
		cancelRefreshToast()
		// Keep the issue view's repository scope mirrored to the PR view so the
		// two surfaces share workspace context until issues get a dedicated
		// picker. `issueViewForPullRequestView` is a total projection — call
		// it unconditionally to avoid edge cases where view.repository equals
		// selectedRepository (e.g. Repository(opencode) → Queue(authored, opencode))
		// would skip the sync and leave activeIssueView stale.
		setActiveIssueView(issueViewForPullRequestView(view))
		if (view._tag === "Repository") {
			setRecentRepositories((current) => [view.repository, ...current.filter((repository) => repository !== view.repository)].slice(0, 12))
			if (activeWorkspaceSurface === "repos") setActiveWorkspaceSurface("pullRequests")
		} else if (view.repository === null && selectedRepository !== null) {
			setActiveWorkspaceSurface("repos")
		}
	}
	const switchQueueMode = (delta: 1 | -1) => {
		switchViewTo(nextView(activeView, activeViews, delta))
	}
	const switchWorkspaceSurface = (surface: WorkspaceSurface) => {
		if (!workspaceTabSurfaces.includes(surface)) return
		if (surface === activeWorkspaceSurface) return
		setActiveWorkspaceSurface(surface)
		setSelectedIssueIndex(0)
		setDetailFullView(false)
		setDiffFullView(false)
		setCommentsViewActive(false)
		setDiffCommentRangeStartIndex(null)
		setFilterMode(false)
		setFilterDraft(filterQuery)
		setNotice(null)
		// Sync the issue view's scope to whatever the PR view is on, so
		// pressing 2/clicking the Issues tab doesn't surface a stale repo's
		// issues under the current breadcrumb.
		setActiveIssueView(issueViewForPullRequestView(activeView))
	}
	const cycleWorkspaceSurface = (delta: 1 | -1) => {
		switchWorkspaceSurface(nextWorkspaceSurface(activeWorkspaceSurface, delta, workspaceTabSurfaces))
	}
	const goUpWorkspaceScope = () => {
		if (!selectedRepository) return false
		switchViewTo({ _tag: "Queue", mode: "authored", repository: null })
		return true
	}
	const openSelectedRepository = () => {
		if (!selectedRepositoryItem) return
		switchViewTo({ _tag: "Repository", repository: selectedRepositoryItem.repository })
	}
	const toggleFavoriteRepository = () => {
		if (!selectedRepositoryItem) return
		const repository = selectedRepositoryItem.repository
		setFavoriteRepositories((current) => {
			if (current[repository]) {
				const next = { ...current }
				delete next[repository]
				return next
			}
			return { ...current, [repository]: true }
		})
	}
	const removeSelectedRepository = () => {
		if (!selectedRepositoryItem) return
		const repository = selectedRepositoryItem.repository
		setFavoriteRepositories((current) => {
			if (!current[repository]) return current
			const next = { ...current }
			delete next[repository]
			return next
		})
		setRecentRepositories((current) => current.filter((item) => item !== repository))
		flashNotice(repository === detectedRepository ? `Removed saved state for ${repository}; current repo stays pinned` : `Removed ${repository} from tracked repositories`)
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
	})
	const loadPullRequestComments = (pullRequest: PullRequestItem, force = false) => {
		const key = pullRequestDiffKey(pullRequest)
		const previousLoadState = registry.get(pullRequestCommentsLoadedAtom)[key]
		if (!force && previousLoadState) return
		const generation = refreshGenerationRef.current
		setPullRequestCommentsLoaded((current) => ({ ...current, [key]: "loading" }))
		void listPullRequestComments({ repository: pullRequest.repository, number: pullRequest.number })
			.then((items) => {
				if (generation !== refreshGenerationRef.current) return
				setPullRequestComments((current) => ({ ...current, [key]: items }))
				setPullRequestCommentsLoaded((current) => ({ ...current, [key]: "ready" }))
			})
			.catch((error) => {
				if (generation !== refreshGenerationRef.current) return
				setPullRequestCommentsLoaded((current) => {
					if (previousLoadState === "ready") return { ...current, [key]: previousLoadState }
					const next = { ...current }
					delete next[key]
					return next
				})
				flashNotice(errorMessage(error))
			})
	}
	const loadIssueComments = (issue: IssueItem, force = false) => {
		const key = `issue:${issue.repository}#${issue.number}`
		const previousLoadState = registry.get(pullRequestCommentsLoadedAtom)[key]
		if (!force && previousLoadState) return
		const generation = refreshGenerationRef.current
		setPullRequestCommentsLoaded((current) => ({ ...current, [key]: "loading" }))
		void listIssueComments({ repository: issue.repository, number: issue.number })
			.then((items) => {
				if (generation !== refreshGenerationRef.current) return
				setPullRequestComments((current) => ({ ...current, [key]: items }))
				setPullRequestCommentsLoaded((current) => ({ ...current, [key]: "ready" }))
			})
			.catch((error) => {
				if (generation !== refreshGenerationRef.current) return
				setPullRequestCommentsLoaded((current) => {
					if (previousLoadState === "ready") return { ...current, [key]: previousLoadState }
					const next = { ...current }
					delete next[key]
					return next
				})
				flashNotice(errorMessage(error))
			})
	}
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

	useEffect(() => {
		if (pullRequestListFilterActive || visiblePullRequests.length === 0) return
		const thresholdIndex = Math.max(0, visiblePullRequests.length - LOAD_MORE_SELECTION_THRESHOLD)
		if (selectedIndex >= thresholdIndex) loadMorePullRequests()
	}, [selectedIndex, visiblePullRequests.length, pullRequestListFilterActive, hasMorePullRequests, isLoadingMorePullRequests, currentQueueCacheKey])

	useEffect(() => {
		if (pullRequestListFilterActive || visiblePullRequests.length === 0 || detailFullView || diffFullView) return
		if (!hasMorePullRequests || isLoadingMorePullRequests) return
		const checkScroll = () => {
			const scroll = prListScrollRef.current
			if (!scroll || scroll.viewport.height <= 0) return
			const bottom = scroll.scrollTop + scroll.viewport.height
			if (bottom >= scroll.scrollHeight - LOAD_MORE_SCROLL_THRESHOLD) loadMorePullRequests()
		}
		checkScroll()
		const interval = globalThis.setInterval(checkScroll, 120)
		return () => globalThis.clearInterval(interval)
	}, [visiblePullRequests.length, pullRequestListFilterActive, detailFullView, diffFullView, hasMorePullRequests, isLoadingMorePullRequests, currentQueueCacheKey])

	useScrollFollowSelected(prListScrollRef, selectedPullRequestRowIndex)
	useScrollFollowSelected(issueListScrollRef, issues.length === 0 ? null : selectedIssueRowIndex)

	// Keep list scroll position when toggling between surfaces. Each list's
	// scrollbox remounts on surface switch; without persistence it starts at
	// scrollTop=0 and useScrollFollowSelected snaps it back to the selected
	// row — reads as a jump.
	useScrollPersistence(prListScrollRef, prListScrollPersistedRef, activeWorkspaceSurface === "pullRequests" && !detailFullView && !diffFullView && !commentsViewActive)
	useScrollPersistence(issueListScrollRef, issueListScrollPersistedRef, activeWorkspaceSurface === "issues" && !detailFullView && !diffFullView && !commentsViewActive)

	useEffect(() => {
		setDiffFileIndex(0)
		setDiffScrollTop(0)
		setDiffCommentAnchorIndex(0)
		setDiffPreferredSide(null)
		setDiffCommentRangeStartIndex(null)
		detailPreviewScrollRef.current?.scrollTo({ x: 0, y: 0 })
	}, [selectedIndex])

	useEffect(() => {
		detailPreviewScrollRef.current?.scrollTo({ x: 0, y: 0 })
	}, [selectedIssueIndex, selectedRepositoryIndex])

	useEffect(() => {
		setDiffFileIndex((current) => safeDiffFileIndex(readyDiffFiles, current))
	}, [readyDiffFiles.length])

	useEffect(() => {
		setDiffCommentAnchorIndex((current) => {
			if (diffCommentAnchors.length === 0) return 0
			return Math.max(0, Math.min(current, diffCommentAnchors.length - 1))
		})
		setDiffCommentRangeStartIndex((current) => {
			if (current === null || diffCommentAnchors.length === 0) return null
			return Math.max(0, Math.min(current, diffCommentAnchors.length - 1))
		})
	}, [diffCommentAnchors.length])

	useEffect(() => {
		if (!diffFullView || !selectedDiffCommentAnchor) return
		setDiffFileIndex((current) => (current === selectedDiffCommentAnchor.fileIndex ? current : selectedDiffCommentAnchor.fileIndex))
	}, [diffFullView, selectedDiffCommentAnchor?.fileIndex])

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
		const atom = pullRequestDiffAtom(pullRequestRevisionAtomKey(pullRequest))
		if (force) registry.refresh(atom)
		void Effect.runPromise(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }))
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

	const navigateIssueReference = (repository: string, number: number) => {
		const issueIndex = issues.findIndex((issue) => issue.repository === repository && issue.number === number)
		if (issueIndex >= 0) {
			setActiveWorkspaceSurface("issues")
			setSelectedIssueIndex(issueIndex)
			setDetailFullView(false)
			flashNotice(`Opened ${repository}#${number}`)
			return true
		}

		const unfilteredIssueIndex = allIssues.findIndex((issue) => issue.repository === repository && issue.number === number)
		if (unfilteredIssueIndex >= 0) {
			setFilterQuery("")
			setFilterDraft("")
			setFilterMode(false)
			setActiveWorkspaceSurface("issues")
			setSelectedIssueIndex(unfilteredIssueIndex)
			setDetailFullView(false)
			flashNotice(`Opened ${repository}#${number}`)
			return true
		}

		const pullRequest = pullRequests.find((item) => item.repository === repository && item.number === number)
		if (pullRequest) {
			setActiveWorkspaceSurface("pullRequests")
			selectPullRequestByUrl(pullRequest.url)
			setDetailFullView(false)
			flashNotice(`Opened ${repository}#${number}`)
			return true
		}

		if (selectedRepository !== repository) {
			switchViewTo({ _tag: "Repository", repository })
			setActiveWorkspaceSurface("issues")
			setSelectedIssueIndex(0)
			flashNotice(`Opened ${repository}; #${number} will appear if it is loaded`)
			return true
		}

		return false
	}

	const openInlineLink = (url: string) => {
		const issueReference = parseIssueReferenceUrl(url)
		const targetUrl = issueReference ? `https://github.com/${issueReference.repository}/issues/${issueReference.number}` : url
		if (issueReference && navigateIssueReference(issueReference.repository, issueReference.number)) return
		void openUrl(targetUrl)
			.then(() => flashNotice(`Opened ${targetUrl}`))
			.catch((error) => flashNotice(errorMessage(error)))
	}

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
	const insertPastedText = (text: string) => {
		if (text.length === 0) return false
		if (commandPaletteActive) {
			setCommandPalette((current) => ({ ...current, query: current.query + singleLineText(text), selectedIndex: 0 }))
			return true
		}
		if (openRepositoryModalActive) {
			setOpenRepositoryModal((current) => ({ ...current, query: current.query + singleLineText(text), error: null }))
			return true
		}
		if (themeModalActive && themeModal.filterMode) {
			editThemeQuery((query) => query + singleLineText(text))
			return true
		}
		if (commentModalActive) return false
		if (submitReviewModalActive) {
			setSubmitReviewModal((current) => {
				const next = insertText({ body: current.body, cursor: current.cursor }, text.replace(/\r\n?/g, "\n"))
				return { ...current, focus: "body", body: next.body, cursor: next.cursor, error: null }
			})
			return true
		}
		if (labelModalActive) {
			setLabelModal((current) => ({ ...current, query: current.query + singleLineText(text), selectedIndex: 0 }))
			return true
		}
		if (changedFilesModalActive) {
			setChangedFilesModal((current) => ({ ...current, query: current.query + singleLineText(text), selectedIndex: 0 }))
			return true
		}
		if (filterMode) {
			setFilterDraft((current) => current + singleLineText(text))
			return true
		}
		return false
	}

	usePasteHandler({ renderer, onPaste: insertPastedText })

	const dispatchCommand = useAtomSet(dispatchCommandAtom, { mode: "promise" })
	const commandSnapshots = useAtomValue(commandSnapshotsAtom)
	const registeredCommands = useMemo<readonly AppCommand[]>(
		() =>
			commandSnapshots.map((snapshot) => ({
				id: snapshot.id,
				title: snapshot.title,
				scope: snapshot.scope,
				...(snapshot.subtitle !== undefined && { subtitle: snapshot.subtitle }),
				...(snapshot.shortcut !== undefined && { shortcut: snapshot.shortcut }),
				...(snapshot.keywords !== undefined && { keywords: snapshot.keywords }),
				disabledReason: snapshot.disabledReason,
				run: () => {
					void dispatchCommand(snapshot.id)
				},
			})),
		[commandSnapshots, dispatchCommand],
	)

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

	// Snapshot per-render computed values into commandRuntimeAtom so command
	// derivation atoms (selectedDiffLineReasonAtom, etc.) can read them.
	// Some of these underlying values come from useMemo over contentWidth +
	// diff layout state that isn't yet atom-driven; this is the transitional
	// seam until those derivations move into pure atom land.
	const setCommandRuntime = useAtomSet(commandRuntimeAtom)
	useEffect(() => {
		setCommandRuntime({
			readyDiffFileCount: readyDiffFiles.length,
			diffFileIndex,
			selectedDiffCommentAnchorLabel: selectedDiffCommentLabel,
			selectedDiffCommentThreadCount: selectedDiffCommentThread.length,
			hasDiffCommentThreads: diffCommentThreadAnchors.length > 0,
			diffRangeActive: diffCommentRangeActive,
			hasSelectedComment: selectedCommentsStatus === "ready" && selectedOrderedComment !== null,
			canEditSelectedComment: canEditComment(selectedOrderedComment, username),
		})
	}, [
		setCommandRuntime,
		readyDiffFiles.length,
		diffFileIndex,
		selectedDiffCommentLabel,
		selectedDiffCommentThread.length,
		diffCommentThreadAnchors.length,
		diffCommentRangeActive,
		selectedCommentsStatus,
		selectedOrderedComment,
		username,
	])

	const appCommands = registeredCommands
	const runCommand = (command: AppCommand, options: { readonly notifyDisabled?: boolean; readonly closePalette?: boolean } = {}) => {
		if (!commandEnabled(command)) {
			if (options.notifyDisabled && command.disabledReason) flashNotice(command.disabledReason)
			return false
		}
		if (options.closePalette) closeActiveModal()
		command.run()
		return true
	}
	const runCommandById = (id: string, options: { readonly notifyDisabled?: boolean } = {}) => {
		const command = appCommands.find((entry) => entry.id === id)
		return command ? runCommand(command, options) : false
	}
	const runCommandByIdRef = useRef(runCommandById)
	runCommandByIdRef.current = runCommandById
	const dynamicPaletteCommands: readonly AppCommand[] = (() => {
		if (!commandPaletteActive) return []
		const repository = parseRepositoryInput(commandPalette.query)
		if (!repository || repository === selectedRepository) return []
		return [
			defineCommand({
				id: `view.repository.dynamic:${repository}`,
				title: `Open ${repository}`,
				scope: "View",
				subtitle: "Switch to this repository",
				run: () => switchViewTo({ _tag: "Repository", repository }),
			}),
		]
	})()
	// Dynamic commands always pin to the top of the palette; they came directly from the
	// user's typed input so they shouldn't be filtered by fuzzy score against themselves.
	const staticPaletteCommands = commandPaletteActive
		? filterCommands(
				appCommands.filter((command) => command.id !== "command.open" && commandEnabled(command)),
				commandPalette.query,
			)
		: []
	const activePaletteScope: CommandScope | null = commentsViewActive ? "Comments" : diffFullView ? "Diff" : detailFullView ? "View" : null
	const commandPaletteCommands = commandPaletteActive
		? [...dynamicPaletteCommands, ...(commandPalette.query.trim().length > 0 ? staticPaletteCommands : sortCommandsByActiveScope(staticPaletteCommands, activePaletteScope))]
		: []
	const selectedCommandIndex = clampCommandIndex(commandPalette.selectedIndex, commandPaletteCommands)
	const selectedCommand = commandPaletteCommands[selectedCommandIndex] ?? null

	// === Helpers used by the keymap layers ===
	const scrollCommentThread = (delta: number) =>
		setCommentThreadModal((current) => ({
			...current,
			scrollOffset: Math.max(0, current.scrollOffset + delta),
		}))
	const moveLabelSelection = (delta: -1 | 1) =>
		setLabelModal((current) => {
			const filtered = filterLabels(labelModal.availableLabels, labelModal.query)
			const selectedIndex = wrapIndex(current.selectedIndex + delta, filtered.length)
			return selectedIndex === current.selectedIndex ? current : { ...current, selectedIndex }
		})
	const moveChangedFileSelection = (delta: -1 | 1) =>
		setChangedFilesModal((current) => {
			const selectedIndex = wrapIndex(current.selectedIndex + delta, changedFileResults.length)
			return selectedIndex === current.selectedIndex ? current : { ...current, selectedIndex }
		})
	const moveSubmitReviewActionSelection = (delta: -1 | 1) =>
		setSubmitReviewModal((current) => {
			const selectedIndex = wrapIndex(current.selectedIndex + delta, submitReviewOptions.length)
			return { ...current, selectedIndex, error: null }
		})
	const moveCommandPaletteSelection = (delta: -1 | 1) =>
		setCommandPalette((current) => {
			const selectedIndex = wrapIndex(current.selectedIndex + delta, commandPaletteCommands.length)
			return selectedIndex === current.selectedIndex ? current : { ...current, selectedIndex }
		})
	const selectCommandPaletteIndex = (index: number) =>
		setCommandPalette((current) => {
			const selectedIndex = clampCommandIndex(index, commandPaletteCommands)
			return selectedIndex === current.selectedIndex ? current : { ...current, selectedIndex }
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
	const moveSelectedToPreviousGroup = () =>
		setSelectedIndex((current) => {
			if (activeWorkspaceSurface !== "pullRequests") return current
			if (visiblePullRequests.length === 0 || groupStarts.length === 0) return 0
			const currentGroup = getCurrentGroupIndex(current)
			if (currentGroup <= 0) return groupStarts[groupStarts.length - 1]!
			return groupStarts[currentGroup - 1]!
		})
	const moveSelectedToNextGroup = () =>
		setSelectedIndex((current) => {
			if (activeWorkspaceSurface !== "pullRequests") return current
			if (visiblePullRequests.length === 0 || groupStarts.length === 0) return 0
			const currentGroup = getCurrentGroupIndex(current)
			if (currentGroup >= groupStarts.length - 1) return groupStarts[0]!
			return groupStarts[currentGroup + 1]!
		})
	const stepSelected = (delta: number) =>
		activeWorkspaceSurface === "repos"
			? setSelectedRepositoryIndex((current) => {
					if (repositoryItems.length === 0) return 0
					return Math.max(0, Math.min(repositoryItems.length - 1, current + delta))
				})
			: activeWorkspaceSurface === "issues"
				? setSelectedIssueIndex((current) => {
						if (issues.length === 0) return 0
						return Math.max(0, Math.min(issues.length - 1, current + delta))
					})
				: setSelectedIndex((current) => {
						if (visiblePullRequests.length === 0) return 0
						return Math.max(0, Math.min(visiblePullRequests.length - 1, current + delta))
					})
	const stepSelectedDown = (count = 1) => {
		if (activeWorkspaceSurface === "repos" || activeWorkspaceSurface === "issues") {
			stepSelected(count)
			return
		}
		if (visiblePullRequests.length === 0) return
		if (selectedIndex + count >= visiblePullRequests.length && visibleHasMorePullRequests) {
			loadMorePullRequests()
		}
		stepSelected(count)
	}
	const stepSelectedUp = (count = 1) => stepSelected(-count)
	const stepSelectedDownWithLoadMore = () => {
		if (activeWorkspaceSurface === "repos") {
			setSelectedRepositoryIndex((current) => {
				if (repositoryItems.length === 0) return 0
				return current >= repositoryItems.length - 1 ? 0 : current + 1
			})
			return
		}
		if (activeWorkspaceSurface === "issues") {
			setSelectedIssueIndex((current) => {
				if (issues.length === 0) return 0
				return current >= issues.length - 1 ? 0 : current + 1
			})
			return
		}
		if (visiblePullRequests.length > 0 && selectedIndex >= visiblePullRequests.length - 1 && visibleHasMorePullRequests) {
			loadMorePullRequests()
			return
		}
		setSelectedIndex((current) => {
			if (visiblePullRequests.length === 0) return 0
			return current >= visiblePullRequests.length - 1 ? 0 : current + 1
		})
	}
	// PR / Issue / Repo lists are long and load lazily; wrapping to the bottom
	// from the top would jump past loading rows and feel disorienting. Clamp at
	// 0 instead. (The matching down handler stays as-is — pressing j at the
	// last loaded item triggers load-more rather than wrapping.)
	const stepSelectedUpWrap = () =>
		activeWorkspaceSurface === "repos"
			? setSelectedRepositoryIndex((current) => Math.max(0, current - 1))
			: activeWorkspaceSurface === "issues"
				? setSelectedIssueIndex((current) => Math.max(0, current - 1))
				: setSelectedIndex((current) => Math.max(0, current - 1))
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
			{activeWorkspaceSurface === "repos" && !commentsViewActive && !diffFullView && !detailFullView ? (
				<RepoSurface
					isWideLayout={isWideLayout}
					wideBodyHeight={wideBodyHeight}
					contentWidth={contentWidth}
					leftPaneWidth={leftPaneWidth}
					rightPaneWidth={rightPaneWidth}
					leftContentWidth={leftContentWidth}
					fullscreenContentWidth={fullscreenContentWidth}
					sectionPadding={sectionPadding}
					narrowRepoListHeight={narrowRepoListHeight}
					narrowRepoDetailHeight={narrowRepoDetailHeight}
					repoListNeedsScroll={repoListNeedsScroll}
					narrowRepoListNeedsScroll={narrowRepoListNeedsScroll}
					repoListProps={repoListProps}
					selectedRepositoryItem={selectedRepositoryItem}
					selectedRepositoryDetails={selectedRepositoryDetails}
					detailPreviewScrollRef={detailPreviewScrollRef}
				/>
			) : activeWorkspaceSurface === "issues" && !commentsViewActive && !diffFullView ? (
				<IssueSurface
					isWideLayout={isWideLayout}
					wideBodyHeight={wideBodyHeight}
					contentWidth={contentWidth}
					leftPaneWidth={leftPaneWidth}
					rightPaneWidth={rightPaneWidth}
					leftContentWidth={leftContentWidth}
					fullscreenContentWidth={fullscreenContentWidth}
					sectionPadding={sectionPadding}
					narrowIssueListHeight={narrowIssueListHeight}
					narrowIssueDetailHeight={narrowIssueDetailHeight}
					issueListNeedsScroll={issueListNeedsScroll}
					narrowIssueListNeedsScroll={narrowIssueListNeedsScroll}
					activeFilterLabel={issueActiveFilterLabel}
					issueJunctions={issueJunctions}
					issueListProps={issueListProps}
					selectedIssue={selectedIssue}
					issueListScrollRef={issueListScrollRef}
					detailPreviewScrollRef={detailPreviewScrollRef}
					detailFullView={detailFullView}
					onLinkOpen={openInlineLink}
				/>
			) : (
				<PullRequestSurface
					isWideLayout={isWideLayout}
					contentWidth={contentWidth}
					leftPaneWidth={leftPaneWidth}
					rightPaneWidth={rightPaneWidth}
					leftContentWidth={leftContentWidth}
					rightContentWidth={rightContentWidth}
					fullscreenContentWidth={fullscreenContentWidth}
					sectionPadding={sectionPadding}
					wideBodyHeight={wideBodyHeight}
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
					activeFilterLabel={pullRequestActiveFilterLabel}
					detailJunctions={detailJunctions}
					prListProps={prListProps}
					selectedPullRequest={selectedPullRequest}
					selectedComments={selectedComments}
					selectedCommentsStatus={selectedCommentsStatus}
					detailPlaceholderContent={detailPlaceholderContent}
					isSelectedPullRequestDetailLoading={isSelectedPullRequestDetailLoading}
					isSelectedPullRequestDetailError={isSelectedPullRequestDetailError}
					selectedPullRequestDetailError={selectedPullRequestDetailError}
					commentsViewActive={commentsViewActive}
					commentsViewSelection={commentsViewSelection}
					orderedComments={orderedComments}
					commentSubject={selectedCommentSubject}
					diffFullView={diffFullView}
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
					detailFullView={detailFullView}
					loadingIndicator={loadingIndicator}
					themeId={themeId}
					systemThemeGeneration={systemThemeGeneration}
					prListScrollRef={prListScrollRef}
					detailScrollRef={detailScrollRef}
					detailPreviewScrollRef={detailPreviewScrollRef}
					diffScrollRef={diffScrollRef}
					onLinkOpen={openInlineLink}
				/>
			)}

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
