import type { ScrollBoxRenderable } from "@opentui/core"
import { useAtom, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { Cause, Effect, Layer, Schedule } from "effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import { useEffect, useMemo, useRef, useState } from "react"
import { config } from "./config.js"
import type { PullRequestItem, PullRequestLabel, PullRequestMergeAction } from "./domain.js"
import { formatShortDate, formatTimestamp } from "./date.js"
import { availableMergeActions, mergeInfoFromPullRequest } from "./mergeActions.js"
import { Observability } from "./observability.js"
import { GitHubService } from "./services/GitHubService.js"
import { colors, setActiveTheme, themeDefinitions, type ThemeId } from "./ui/colors.js"
import { pullRequestDiffKey, splitPatchFiles, type PullRequestDiffState } from "./ui/diff.js"
import { DetailBody, DetailHeader, DetailPlaceholder, DetailsPane, getDetailBodyHeight, getDetailHeaderHeight, getDetailJunctionRows, getDetailsPaneHeight, LoadingPane, type DetailPlaceholderContent } from "./ui/DetailsPane.js"
import { FooterHints, type RetryProgress } from "./ui/FooterHints.js"
import { Divider, fitCell, PlainLine, SeparatorColumn } from "./ui/primitives.js"
import { initialLabelModalState, initialMergeModalState, initialThemeModalState, LabelModal, MergeModal, ThemeModal } from "./ui/modals.js"
import { groupBy, reviewLabel } from "./ui/pullRequests.js"
import { PullRequestDiffPane } from "./ui/PullRequestDiffPane.js"
import { PullRequestList } from "./ui/PullRequestList.js"

const githubRuntime = Atom.runtime(GitHubService.layer.pipe(Layer.provideMerge(Observability.layer)))

type LoadStatus = "loading" | "ready" | "error"

interface PullRequestLoad {
	readonly data: readonly PullRequestItem[]
	readonly fetchedAt: Date | null
}

interface DetailPlaceholderInput {
	readonly status: LoadStatus
	readonly retryProgress: RetryProgress | null
	readonly loadingIndicator: string
	readonly visibleCount: number
	readonly filterText: string
}

const PR_FETCH_RETRIES = 6
const FOCUS_RETURN_REFRESH_MIN_MS = 60_000
const FOCUSED_IDLE_REFRESH_MS = 5 * 60_000
const AUTO_REFRESH_JITTER_MS = 10_000
const LOADING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

const retryProgressAtom = Atom.make<RetryProgress | null>(null).pipe(Atom.keepAlive)
const pullRequestsAtom = githubRuntime.atom(
	GitHubService.use((github) =>
		Effect.gen(function*() {
			yield* Atom.set(retryProgressAtom, null)
			const data = yield* github.listOpenPullRequests().pipe(
				Effect.tapError(() =>
					Atom.update(retryProgressAtom, (current) => ({
						attempt: Math.min((current?.attempt ?? 0) + 1, PR_FETCH_RETRIES),
						max: PR_FETCH_RETRIES,
					}))
				),
				Effect.retry({ times: PR_FETCH_RETRIES, schedule: Schedule.exponential("300 millis", 2) }),
				Effect.tapError(() => Atom.set(retryProgressAtom, null)),
			)

			yield* Atom.set(retryProgressAtom, null)
			return { data, fetchedAt: new Date() } satisfies PullRequestLoad
		})
	),
).pipe(Atom.keepAlive)
const selectedIndexAtom = Atom.make(0).pipe(Atom.keepAlive)
const noticeAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive)
const filterQueryAtom = Atom.make("").pipe(Atom.keepAlive)
const filterDraftAtom = Atom.make("").pipe(Atom.keepAlive)
const filterModeAtom = Atom.make(false).pipe(Atom.keepAlive)
const pendingGAtom = Atom.make(false).pipe(Atom.keepAlive)
const detailFullViewAtom = Atom.make(false).pipe(Atom.keepAlive)
const detailScrollOffsetAtom = Atom.make(0).pipe(Atom.keepAlive)
const diffFullViewAtom = Atom.make(false).pipe(Atom.keepAlive)
const diffFileIndexAtom = Atom.make(0).pipe(Atom.keepAlive)
const diffRenderViewAtom = Atom.make<"unified" | "split">("split").pipe(Atom.keepAlive)
const diffWrapModeAtom = Atom.make<"none" | "word">("none").pipe(Atom.keepAlive)
const pullRequestDiffCacheAtom = Atom.make<Record<string, PullRequestDiffState>>({}).pipe(Atom.keepAlive)

const labelModalAtom = Atom.make(initialLabelModalState).pipe(Atom.keepAlive)
const mergeModalAtom = Atom.make(initialMergeModalState).pipe(Atom.keepAlive)
const themeIdAtom = Atom.make<ThemeId>("ghui").pipe(Atom.keepAlive)
const themeModalAtom = Atom.make(initialThemeModalState).pipe(Atom.keepAlive)
const labelCacheAtom = Atom.make<Record<string, readonly PullRequestLabel[]>>({}).pipe(Atom.keepAlive)
const pullRequestOverridesAtom = Atom.make<Record<string, PullRequestItem>>({}).pipe(Atom.keepAlive)
const usernameAtom = githubRuntime.atom(
	config.author === "@me"
		? GitHubService.use((github) => github.getAuthenticatedUser())
		: Effect.succeed(config.author.replace(/^@/, "")),
).pipe(Atom.keepAlive)

const listRepoLabelsAtom = githubRuntime.fn<string>()((repository) =>
	GitHubService.use((github) => github.listRepoLabels(repository))
)
const listOpenPullRequestDetailsAtom = githubRuntime.fn<void>()(() =>
	GitHubService.use((github) => github.listOpenPullRequestDetails())
)
const addPullRequestLabelAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly label: string }>()((input) =>
	GitHubService.use((github) => github.addPullRequestLabel(input.repository, input.number, input.label))
)
const removePullRequestLabelAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly label: string }>()((input) =>
	GitHubService.use((github) => github.removePullRequestLabel(input.repository, input.number, input.label))
)
const toggleDraftAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly isDraft: boolean }>()((input) =>
	GitHubService.use((github) => github.toggleDraftStatus(input.repository, input.number, input.isDraft))
)
const getPullRequestDiffAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number }>()((input) =>
	GitHubService.use((github) => github.getPullRequestDiff(input.repository, input.number))
)
const getPullRequestMergeInfoAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number }>()((input) =>
	GitHubService.use((github) => github.getPullRequestMergeInfo(input.repository, input.number))
)
const mergePullRequestAtom = githubRuntime.fn<{ readonly repository: string; readonly number: number; readonly action: PullRequestMergeAction }>()((input) =>
	GitHubService.use((github) => github.mergePullRequest(input.repository, input.number, input.action))
)

const deleteLastWord = (value: string) => value.replace(/\s*\S+\s*$/, "")

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const clipboardCommands = (): readonly (readonly string[])[] => {
	if (process.platform === "darwin") return [["pbcopy"]]
	if (process.platform === "linux") {
		return [
			...(process.env.WAYLAND_DISPLAY ? [["wl-copy"]] : []),
			["xclip", "-selection", "clipboard"],
			["xsel", "--clipboard", "--input"],
		]
	}
	return []
}

const copyToClipboard = async (text: string) => {
	const commands = clipboardCommands()
	let lastError = ""

	for (const command of commands) {
		let proc: Bun.Subprocess<"pipe", "ignore", "pipe">
		try {
			proc = Bun.spawn({
				cmd: [...command],
				stdin: "pipe",
				stdout: "ignore",
				stderr: "pipe",
			})
		} catch (error) {
			lastError = errorMessage(error)
			continue
		}

		proc.stdin.write(text)
		proc.stdin.end()

		const exitCode = await proc.exited
		if (exitCode === 0) return

		const stderr = await Bun.readableStreamToText(proc.stderr)
		lastError = stderr.trim()
	}

	const installHint = process.platform === "linux" ? " Install wl-clipboard, xclip, or xsel." : ""
	throw new Error(lastError || `Clipboard is not available.${installHint}`)
}

const openPullRequestInBrowser = async (pullRequest: PullRequestItem) => {
	const proc = Bun.spawn({
		cmd: ["gh", "pr", "view", String(pullRequest.number), "--repo", pullRequest.repository, "--web"],
		stdout: "ignore",
		stderr: "pipe",
	})

	const exitCode = await proc.exited
	if (exitCode === 0) return

	const stderr = await Bun.readableStreamToText(proc.stderr)
	throw new Error(stderr.trim() || "Could not open PR in browser")
}

const copyPullRequestMetadata = async (pullRequest: PullRequestItem) => {
	const lines = [
		pullRequest.title,
		`${pullRequest.repository} #${pullRequest.number}`,
		pullRequest.url,
	]

	const review = reviewLabel(pullRequest)
	if (review) {
		lines.push(`review: ${review}`)
	}
	if (pullRequest.checkSummary) {
		lines.push(pullRequest.checkSummary)
	}

	await copyToClipboard(lines.join("\n"))
}

const isShiftG = (key: { readonly name: string; readonly shift?: boolean }) => key.name === "G" || key.name === "g" && key.shift

const isShiftT = (key: { readonly name: string; readonly shift?: boolean }) => key.name === "T" || key.name === "t" && key.shift

const getDetailPlaceholderContent = ({
	status,
	retryProgress,
	loadingIndicator,
	visibleCount,
	filterText,
}: DetailPlaceholderInput): DetailPlaceholderContent => {
	if (status === "loading") {
		return {
			title: `${loadingIndicator} Loading pull requests`,
			hint: retryProgress ? `Retry ${retryProgress.attempt}/${retryProgress.max}` : "Fetching latest open PRs",
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

export const App = () => {
	const renderer = useRenderer()
	const { width, height } = useTerminalDimensions()
	const pullRequestResult = useAtomValue(pullRequestsAtom)
	const refreshPullRequestsAtom = useAtomRefresh(pullRequestsAtom)
	const [selectedIndex, setSelectedIndex] = useAtom(selectedIndexAtom)
	const [notice, setNotice] = useAtom(noticeAtom)
	const [filterQuery, setFilterQuery] = useAtom(filterQueryAtom)
	const [filterDraft, setFilterDraft] = useAtom(filterDraftAtom)
	const [filterMode, setFilterMode] = useAtom(filterModeAtom)
	const [pendingG, setPendingG] = useAtom(pendingGAtom)
	const [detailFullView, setDetailFullView] = useAtom(detailFullViewAtom)
	const [_detailScrollOffset, setDetailScrollOffset] = useAtom(detailScrollOffsetAtom)
	const [diffFullView, setDiffFullView] = useAtom(diffFullViewAtom)
	const [diffFileIndex, setDiffFileIndex] = useAtom(diffFileIndexAtom)
	const [diffRenderView, setDiffRenderView] = useAtom(diffRenderViewAtom)
	const [diffWrapMode, setDiffWrapMode] = useAtom(diffWrapModeAtom)
	const [pullRequestDiffCache, setPullRequestDiffCache] = useAtom(pullRequestDiffCacheAtom)
	const [labelModal, setLabelModal] = useAtom(labelModalAtom)
	const [mergeModal, setMergeModal] = useAtom(mergeModalAtom)
	const [themeId, setThemeId] = useAtom(themeIdAtom)
	const [themeModal, setThemeModal] = useAtom(themeModalAtom)
	setActiveTheme(themeId)
	const [labelCache, setLabelCache] = useAtom(labelCacheAtom)
	const [pullRequestOverrides, setPullRequestOverrides] = useAtom(pullRequestOverridesAtom)
	const retryProgress = useAtomValue(retryProgressAtom)
	const [loadingFrame, setLoadingFrame] = useState(0)
	const [terminalFocused, setTerminalFocused] = useState(true)
	const usernameResult = useAtomValue(usernameAtom)
	const loadRepoLabels = useAtomSet(listRepoLabelsAtom, { mode: "promise" })
	const loadPullRequestDetails = useAtomSet(listOpenPullRequestDetailsAtom, { mode: "promise" })
	const addPullRequestLabel = useAtomSet(addPullRequestLabelAtom, { mode: "promise" })
	const removePullRequestLabel = useAtomSet(removePullRequestLabelAtom, { mode: "promise" })
	const toggleDraftStatus = useAtomSet(toggleDraftAtom, { mode: "promise" })
	const getPullRequestDiff = useAtomSet(getPullRequestDiffAtom, { mode: "promise" })
	const getPullRequestMergeInfo = useAtomSet(getPullRequestMergeInfoAtom, { mode: "promise" })
	const mergePullRequest = useAtomSet(mergePullRequestAtom, { mode: "promise" })
	const contentWidth = Math.max(60, width ?? 100)
	const isWideLayout = (width ?? 100) >= 100
	const splitGap = 1
	const sectionPadding = 1
	const leftPaneWidth = isWideLayout ? Math.max(44, Math.floor((contentWidth - splitGap) * 0.56)) : contentWidth
	const rightPaneWidth = isWideLayout ? Math.max(28, contentWidth - leftPaneWidth - splitGap) : contentWidth
	const dividerJunctionAt = Math.max(1, leftPaneWidth)
	const leftContentWidth = isWideLayout ? Math.max(24, leftPaneWidth - 3) : Math.max(24, contentWidth - sectionPadding * 2)
	const rightContentWidth = isWideLayout ? Math.max(24, rightPaneWidth - sectionPadding * 2) : Math.max(24, contentWidth - sectionPadding * 2)
	const wideDetailLines = Math.max(8, (height ?? 24) - 8) // fill available vertical space
	const wideBodyHeight = Math.max(8, (height ?? 24) - 4)
	const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const pendingGTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const diffPrefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const detailHydrationRef = useRef<number | null>(null)
	const lastPullRequestRefreshAtRef = useRef(0)
	const terminalFocusedRef = useRef(true)
	const terminalWasBlurredRef = useRef(false)
	const pullRequestStatusRef = useRef<LoadStatus>("loading")
	const refreshPullRequestsRef = useRef<(message?: string) => void>(() => {})
	const maybeRefreshPullRequestsRef = useRef<(minimumAgeMs: number) => void>(() => {})
	const detailScrollRef = useRef<ScrollBoxRenderable | null>(null)
	const diffScrollRef = useRef<ScrollBoxRenderable | null>(null)
	const headerFooterWidth = Math.max(24, contentWidth - 2)

	const flashNotice = (message: string) => {
		if (noticeTimeoutRef.current !== null) {
			clearTimeout(noticeTimeoutRef.current)
		}
		setNotice(message)
		noticeTimeoutRef.current = globalThis.setTimeout(() => {
			setNotice((current) => (current === message ? null : current))
		}, 2500)
	}

	useEffect(() => {
		renderer.setBackgroundColor(colors.background)
	}, [renderer, themeId])

	useEffect(() => () => {
		if (noticeTimeoutRef.current !== null) {
			clearTimeout(noticeTimeoutRef.current)
		}
		if (pendingGTimeoutRef.current !== null) {
			clearTimeout(pendingGTimeoutRef.current)
		}
		if (diffPrefetchTimeoutRef.current !== null) {
			clearTimeout(diffPrefetchTimeoutRef.current)
		}
	}, [])

	const pullRequestLoad = AsyncResult.getOrElse(pullRequestResult, () => null)
	const pullRequests = useMemo(
		() => pullRequestLoad?.data.map((pullRequest) => pullRequestOverrides[pullRequest.url] ?? pullRequest) ?? [],
		[pullRequestLoad?.data, pullRequestOverrides],
	)
	const pullRequestStatus: LoadStatus = pullRequestResult.waiting && pullRequestLoad === null
		? "loading"
		: AsyncResult.isFailure(pullRequestResult)
			? "error"
			: "ready"
	const isInitialLoading = pullRequestStatus === "loading" && pullRequests.length === 0
	const pullRequestError = AsyncResult.isFailure(pullRequestResult) ? errorMessage(Cause.squash(pullRequestResult.cause)) : null
	const username = AsyncResult.isSuccess(usernameResult) ? usernameResult.value : null
	pullRequestStatusRef.current = pullRequestStatus

	const effectiveFilterQuery = (filterMode ? filterDraft : filterQuery).trim().toLowerCase()
	const visibleFilterText = filterMode ? filterDraft : filterQuery

	const filteredPullRequests = useMemo(() => pullRequests.filter((pullRequest) => {
		const query = effectiveFilterQuery
		if (query.length === 0) return true
		return [pullRequest.title, pullRequest.repository, String(pullRequest.number)]
			.some((value) => value.toLowerCase().includes(query))
	}), [pullRequests, effectiveFilterQuery])

	const visibleGroups = useMemo(
		() => groupBy(filteredPullRequests, (pullRequest) => pullRequest.repository),
		[filteredPullRequests],
	)
	const visiblePullRequests = useMemo(() => visibleGroups.flatMap(([, pullRequests]) => pullRequests), [visibleGroups])
	const groupStarts = useMemo(() => visibleGroups.reduce<Array<number>>((starts, [, pullRequests], index) => {
		if (index === 0) {
			starts.push(0)
			return starts
		}
		starts.push(starts[index - 1]! + visibleGroups[index - 1]![1].length)
		return starts
	}, []), [visibleGroups])
	const getCurrentGroupIndex = (current: number) => {
		for (let index = groupStarts.length - 1; index >= 0; index--) {
			if (groupStarts[index]! <= current) return index
		}
		return 0
	}
	const summaryRight = pullRequestLoad?.fetchedAt
		? `updated ${formatShortDate(pullRequestLoad.fetchedAt)} ${formatTimestamp(pullRequestLoad.fetchedAt)}`
		: pullRequestStatus === "loading"
			? "loading pull requests..."
			: ""
	const headerLeft = username ? `GHUI  ${username}` : "GHUI"
	const headerLine = `${fitCell(headerLeft, Math.max(0, headerFooterWidth - summaryRight.length))}${summaryRight}`
	const footerNotice = notice ? fitCell(notice, headerFooterWidth) : null
	const selectPullRequestByUrl = (url: string) => {
		const index = visiblePullRequests.findIndex((pullRequest) => pullRequest.url === url)
		if (index >= 0) setSelectedIndex(index)
	}
	const updatePullRequest = (url: string, transform: (pullRequest: PullRequestItem) => PullRequestItem) => {
		const pullRequest = pullRequests.find((item) => item.url === url)
		if (!pullRequest) return
		setPullRequestOverrides((current) => ({ ...current, [url]: transform(pullRequest) }))
	}
	const refreshPullRequests = (message?: string) => {
		refreshPullRequestsAtom()
		if (message) flashNotice(message)
	}
	refreshPullRequestsRef.current = refreshPullRequests
	maybeRefreshPullRequestsRef.current = (minimumAgeMs) => {
		if (!terminalFocusedRef.current || pullRequestStatusRef.current === "loading") return
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

	useEffect(() => {
		const handleFocus = () => {
			terminalFocusedRef.current = true
			setTerminalFocused(true)
			if (terminalWasBlurredRef.current) {
				maybeRefreshPullRequestsRef.current(FOCUS_RETURN_REFRESH_MIN_MS)
			}
		}
		const handleBlur = () => {
			terminalWasBlurredRef.current = true
			terminalFocusedRef.current = false
			setTerminalFocused(false)
		}

		renderer.on("focus", handleFocus)
		renderer.on("blur", handleBlur)
		return () => {
			renderer.off("focus", handleFocus)
			renderer.off("blur", handleBlur)
		}
	}, [renderer])

	useEffect(() => {
		if (!terminalFocused) return
		const lastRefreshAt = lastPullRequestRefreshAtRef.current || Date.now()
		const ageMs = Date.now() - lastRefreshAt
		const delayMs = Math.max(0, FOCUSED_IDLE_REFRESH_MS - ageMs) + Math.floor(Math.random() * AUTO_REFRESH_JITTER_MS)
		const timeout = globalThis.setTimeout(() => {
			maybeRefreshPullRequestsRef.current(FOCUSED_IDLE_REFRESH_MS)
		}, delayMs)
		return () => globalThis.clearTimeout(timeout)
	}, [terminalFocused, pullRequestLoad?.fetchedAt])

	useEffect(() => {
		setSelectedIndex((current) => {
			if (visiblePullRequests.length === 0) return 0
			return Math.max(0, Math.min(current, visiblePullRequests.length - 1))
		})
	}, [visiblePullRequests.length])

	useEffect(() => {
		setDiffFileIndex(0)
	}, [selectedIndex])

	const selectedPullRequest = visiblePullRequests[selectedIndex] ?? null
	const selectedDiffState = selectedPullRequest ? pullRequestDiffCache[pullRequestDiffKey(selectedPullRequest)] : undefined
	const effectiveDiffRenderView = contentWidth >= 100 ? diffRenderView : "unified"
	const isHydratingPullRequestDetails = pullRequestStatus === "ready" && pullRequests.some((pullRequest) => !pullRequest.detailLoaded)
	const hasActiveLoadingIndicator = pullRequestStatus === "loading" || isHydratingPullRequestDetails || labelModal.loading || mergeModal.loading || mergeModal.running || selectedDiffState?.status === "loading"
	const loadingIndicator = LOADING_FRAMES[loadingFrame % LOADING_FRAMES.length]!

	useEffect(() => {
		if (!hasActiveLoadingIndicator) return
		const interval = globalThis.setInterval(() => {
			setLoadingFrame((current) => (current + 1) % LOADING_FRAMES.length)
		}, 120)
		return () => globalThis.clearInterval(interval)
	}, [hasActiveLoadingIndicator])

	useEffect(() => {
		const fetchedAt = pullRequestLoad?.fetchedAt?.getTime()
		if (pullRequestStatus !== "ready" || fetchedAt === undefined) return
		if (detailHydrationRef.current === fetchedAt) return
		if (!pullRequests.some((pullRequest) => !pullRequest.detailLoaded)) return
		detailHydrationRef.current = fetchedAt
		void loadPullRequestDetails().then((details) => {
			setPullRequestOverrides((current) => {
				const next = { ...current }
				for (const detail of details) {
					next[detail.url] = current[detail.url]?.detailLoaded ? current[detail.url]! : detail
				}
				return next
			})
		}).catch((error) => {
			flashNotice(error instanceof Error ? error.message : String(error))
		})
	}, [pullRequestStatus, pullRequestLoad?.fetchedAt, pullRequests.length])

	const detailPlaceholderContent = getDetailPlaceholderContent({
		status: pullRequestStatus,
		retryProgress,
		loadingIndicator,
		visibleCount: visiblePullRequests.length,
		filterText: visibleFilterText,
	})
	const detailJunctions = getDetailJunctionRows(selectedPullRequest, rightPaneWidth, true)

	const halfPage = Math.max(1, Math.floor(wideBodyHeight / 2))

	const loadPullRequestDiff = (pullRequest: PullRequestItem, force = false) => {
		const key = pullRequestDiffKey(pullRequest)
		const existing = pullRequestDiffCache[key]
		if (!force && (existing?.status === "ready" || existing?.status === "loading")) return

		setPullRequestDiffCache((current) => ({ ...current, [key]: { status: "loading" } }))
		void getPullRequestDiff({ repository: pullRequest.repository, number: pullRequest.number })
			.then((patch) => {
				setPullRequestDiffCache((current) => ({
					...current,
					[key]: { status: "ready", patch, files: splitPatchFiles(patch) },
				}))
			})
			.catch((error) => {
				setPullRequestDiffCache((current) => ({
					...current,
					[key]: { status: "error", error: errorMessage(error) },
				}))
				flashNotice(errorMessage(error))
			})
	}

	useEffect(() => {
		if (!selectedPullRequest || diffFullView) return
		if (diffPrefetchTimeoutRef.current !== null) {
			clearTimeout(diffPrefetchTimeoutRef.current)
		}
		diffPrefetchTimeoutRef.current = setTimeout(() => {
			loadPullRequestDiff(selectedPullRequest)
		}, 250)
		return () => {
			if (diffPrefetchTimeoutRef.current !== null) {
				clearTimeout(diffPrefetchTimeoutRef.current)
				diffPrefetchTimeoutRef.current = null
			}
		}
	}, [selectedIndex, selectedPullRequest?.url, diffFullView])

	const openDiffView = () => {
		if (!selectedPullRequest) return
		setDiffFullView(true)
		setDetailFullView(false)
		setDiffFileIndex(0)
		setDiffRenderView(contentWidth >= 100 ? "split" : "unified")
		diffScrollRef.current?.scrollTo({ x: 0, y: 0 })
		loadPullRequestDiff(selectedPullRequest)
	}

	const openSelectedPullRequestInBrowser = (pullRequest: PullRequestItem) => {
		void openPullRequestInBrowser(pullRequest)
			.then(() => flashNotice(`Opened #${pullRequest.number} in browser`))
			.catch((error) => flashNotice(errorMessage(error)))
	}

	const openThemeModal = () => {
		setLabelModal(initialLabelModalState)
		setMergeModal(initialMergeModalState)
		setThemeModal({
			open: true,
			selectedIndex: Math.max(0, themeDefinitions.findIndex((theme) => theme.id === themeId)),
			initialThemeId: themeId,
		})
	}

	const closeThemeModal = (confirm: boolean) => {
		const selectedTheme = themeDefinitions[themeModal.selectedIndex]
		if (!confirm) {
			setThemeId(themeModal.initialThemeId)
		} else if (selectedTheme) {
			flashNotice(`Theme: ${selectedTheme.name}`)
		}
		setThemeModal(initialThemeModalState)
	}

	const moveThemeSelection = (delta: number) => {
		const selectedIndex = Math.max(0, Math.min(themeDefinitions.length - 1, themeModal.selectedIndex + delta))
		if (selectedIndex === themeModal.selectedIndex) return
		const theme = themeDefinitions[selectedIndex]
		if (theme && theme.id !== themeId) setThemeId(theme.id)
		setThemeModal((current) => ({ ...current, selectedIndex }))
	}

	const openLabelModal = () => {
		if (!selectedPullRequest) return
		setMergeModal(initialMergeModalState)
		setThemeModal(initialThemeModalState)
		const repository = selectedPullRequest.repository
		const cachedLabels = labelCache[repository]
		if (cachedLabels) {
			setLabelModal({
				open: true,
				repository,
				query: "",
				selectedIndex: 0,
				availableLabels: cachedLabels,
				loading: false,
			})
			return
		}

		setLabelModal((current) => ({ ...current, open: true, repository, query: "", selectedIndex: 0, availableLabels: [], loading: true }))
		void loadRepoLabels(repository)
			.then((labels) => {
				setLabelCache((current) => ({ ...current, [repository]: labels }))
				setLabelModal((current) => current.repository === repository ? { ...current, availableLabels: labels, loading: false } : current)
			})
			.catch((error) => {
				setLabelModal((current) => current.repository === repository ? { ...current, loading: false } : current)
				flashNotice(error instanceof Error ? error.message : String(error))
			})
	}

	const openMergeModal = () => {
		if (!selectedPullRequest) return
		setThemeModal(initialThemeModalState)
		const repository = selectedPullRequest.repository
		const number = selectedPullRequest.number
		const seededInfo = mergeInfoFromPullRequest(selectedPullRequest)
		setLabelModal(initialLabelModalState)
		setMergeModal({
			open: true,
			repository,
			number,
			selectedIndex: 0,
			loading: true,
			running: false,
			info: seededInfo,
			error: null,
		})
		void getPullRequestMergeInfo({ repository, number })
			.then((info) => {
				setMergeModal((current) => current.repository === repository && current.number === number
					? { ...current, loading: false, info, selectedIndex: 0 }
					: current)
			})
			.catch((error) => {
				setMergeModal((current) => current.repository === repository && current.number === number
					? { ...current, loading: false, error: errorMessage(error) }
					: current)
			})
	}

	const confirmMergeAction = () => {
		if (!mergeModal.info || mergeModal.loading || mergeModal.running) return
		const options = availableMergeActions(mergeModal.info)
		const option = options[mergeModal.selectedIndex]
		if (!option) return

		const { repository, number } = mergeModal.info
		const targetPullRequest = pullRequests.find((pullRequest) => pullRequest.repository === repository && pullRequest.number === number)
		const previousPullRequest = targetPullRequest ?? null
		const previousMergeInfo = mergeModal.info

		if (targetPullRequest && option.optimisticAutoMergeEnabled !== undefined) {
			updatePullRequest(targetPullRequest.url, (pullRequest) => ({ ...pullRequest, autoMergeEnabled: option.optimisticAutoMergeEnabled! }))
			setMergeModal((current) => ({
				...current,
				info: current.info ? { ...current.info, autoMergeEnabled: option.optimisticAutoMergeEnabled! } : current.info,
			}))
		}

		setMergeModal((current) => ({ ...current, running: true, error: null }))
		void mergePullRequest({ repository, number, action: option.action })
			.then(() => {
				setMergeModal(initialMergeModalState)
				if (option.refreshOnSuccess) {
					refreshPullRequests(`${option.pastTense} #${number}`)
				} else {
					flashNotice(`${option.pastTense} #${number}`)
				}
			})
			.catch((error) => {
				if (previousPullRequest) updatePullRequest(previousPullRequest.url, () => previousPullRequest)
				setMergeModal((current) => ({ ...current, running: false, info: previousMergeInfo, error: errorMessage(error) }))
				flashNotice(errorMessage(error))
			})
	}

	const toggleLabelAtIndex = () => {
		if (!selectedPullRequest) return
		const filtered = labelModal.availableLabels.filter((label) =>
			labelModal.query.length === 0 || label.name.toLowerCase().includes(labelModal.query.toLowerCase()),
		)
		const label = filtered[labelModal.selectedIndex]
		if (!label) return

		const isActive = selectedPullRequest.labels.some((l) => l.name.toLowerCase() === label.name.toLowerCase())
		const previousPullRequest = selectedPullRequest

		if (isActive) {
			updatePullRequest(selectedPullRequest.url, (pr) => ({
				...pr,
				labels: pr.labels.filter((l) => l.name.toLowerCase() !== label.name.toLowerCase()),
			}))
			void removePullRequestLabel({ repository: selectedPullRequest.repository, number: selectedPullRequest.number, label: label.name })
				.then(() => flashNotice(`Removed ${label.name} from #${selectedPullRequest.number}`))
				.catch((error) => {
					updatePullRequest(selectedPullRequest.url, () => previousPullRequest)
					flashNotice(error instanceof Error ? error.message : String(error))
				})
		} else {
			updatePullRequest(selectedPullRequest.url, (pr) => ({
				...pr,
				labels: [...pr.labels, { name: label.name, color: label.color }],
			}))
			void addPullRequestLabel({ repository: selectedPullRequest.repository, number: selectedPullRequest.number, label: label.name })
				.then(() => flashNotice(`Added ${label.name} to #${selectedPullRequest.number}`))
				.catch((error) => {
					updatePullRequest(selectedPullRequest.url, () => previousPullRequest)
					flashNotice(error instanceof Error ? error.message : String(error))
				})
		}
	}

	useKeyboard((key) => {
		if (key.name === "q" || (key.ctrl && key.name === "c")) {
			if (themeModal.open) {
				closeThemeModal(false)
				return
			}
			if (mergeModal.open) {
				setMergeModal(initialMergeModalState)
				return
			}
			if (labelModal.open) {
				setLabelModal(initialLabelModalState)
				return
			}
			renderer.destroy()
			return
		}

		if (themeModal.open) {
			if (key.name === "escape") {
				closeThemeModal(false)
				return
			}
			if (key.name === "return" || key.name === "enter") {
				closeThemeModal(true)
				return
			}
			if (key.name === "up" || key.name === "k") {
				moveThemeSelection(-1)
				return
			}
			if (key.name === "down" || key.name === "j") {
				moveThemeSelection(1)
				return
			}
			return
		}

		if (mergeModal.open) {
			const options = availableMergeActions(mergeModal.info)
			if (key.name === "escape") {
				setMergeModal(initialMergeModalState)
				return
			}
			if ((key.name === "return" || key.name === "enter") && options.length > 0) {
				confirmMergeAction()
				return
			}
			if (key.name === "up" || key.name === "k") {
				setMergeModal((current) => ({
					...current,
					selectedIndex: Math.max(0, current.selectedIndex - 1),
				}))
				return
			}
			if (key.name === "down" || key.name === "j") {
				setMergeModal((current) => ({
					...current,
					selectedIndex: Math.min(Math.max(0, options.length - 1), current.selectedIndex + 1),
				}))
				return
			}
			return
		}

		// Label modal takes priority over everything else
		if (labelModal.open) {
			if (key.name === "escape") {
				setLabelModal(initialLabelModalState)
				return
			}
			if (key.name === "return" || key.name === "enter") {
				toggleLabelAtIndex()
				return
			}
			if (key.name === "up" || key.name === "k") {
				setLabelModal((current) => ({
					...current,
					selectedIndex: Math.max(0, current.selectedIndex - 1),
				}))
				return
			}
			if (key.name === "down" || key.name === "j") {
				const filtered = labelModal.availableLabels.filter((label) =>
					labelModal.query.length === 0 || label.name.toLowerCase().includes(labelModal.query.toLowerCase()),
				)
				setLabelModal((current) => ({
					...current,
					selectedIndex: Math.min(Math.max(0, filtered.length - 1), current.selectedIndex + 1),
				}))
				return
			}
			if (key.name === "backspace") {
				setLabelModal((current) => ({
					...current,
					query: current.query.slice(0, -1),
					selectedIndex: 0,
				}))
				return
			}
			if (key.ctrl && key.name === "u") {
				setLabelModal((current) => ({ ...current, query: "", selectedIndex: 0 }))
				return
			}
			if (!key.ctrl && !key.meta && key.sequence.length === 1) {
				setLabelModal((current) => ({
					...current,
					query: current.query + key.sequence,
					selectedIndex: 0,
				}))
				return
			}
			return
		}

		if (diffFullView) {
			if (key.name === "escape" || key.name === "return" || key.name === "enter") {
				setDiffFullView(false)
				return
			}
			if (key.name === "home") {
				diffScrollRef.current?.scrollTo({ x: 0, y: 0 })
				return
			}
			if (key.name === "end") {
				diffScrollRef.current?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER })
				return
			}
			if (key.name === "pageup") {
				diffScrollRef.current?.scrollBy({ x: 0, y: -halfPage })
				return
			}
			if (key.name === "pagedown") {
				diffScrollRef.current?.scrollBy({ x: 0, y: halfPage })
				return
			}
			if (isShiftG(key)) {
				diffScrollRef.current?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER })
				setPendingG(false)
				if (pendingGTimeoutRef.current !== null) {
					clearTimeout(pendingGTimeoutRef.current)
					pendingGTimeoutRef.current = null
				}
				return
			}
			if (key.name === "g") {
				if (pendingG) {
					diffScrollRef.current?.scrollTo({ x: 0, y: 0 })
					setPendingG(false)
					if (pendingGTimeoutRef.current !== null) {
						clearTimeout(pendingGTimeoutRef.current)
						pendingGTimeoutRef.current = null
					}
				} else {
					setPendingG(true)
					pendingGTimeoutRef.current = setTimeout(() => {
						setPendingG(false)
						pendingGTimeoutRef.current = null
					}, 500)
				}
				return
			}
			if (key.name === "up" || key.name === "k") {
				diffScrollRef.current?.scrollBy({ x: 0, y: -1 })
				return
			}
			if (key.name === "down" || key.name === "j") {
				diffScrollRef.current?.scrollBy({ x: 0, y: 1 })
				return
			}
			if (key.ctrl && key.name === "u") {
				diffScrollRef.current?.scrollBy({ x: 0, y: -halfPage })
				return
			}
			if (key.ctrl && (key.name === "d" || key.name === "v")) {
				diffScrollRef.current?.scrollBy({ x: 0, y: halfPage })
				return
			}
			if (key.name === "v") {
				setDiffRenderView((current) => current === "unified" ? "split" : "unified")
				return
			}
			if (key.name === "w") {
				setDiffWrapMode((current) => current === "none" ? "word" : "none")
				return
			}
			if (key.name === "r" && selectedPullRequest) {
				loadPullRequestDiff(selectedPullRequest, true)
				flashNotice(`Refreshing diff for #${selectedPullRequest.number}`)
				return
			}
			if ((key.name === "]" || key.name === "right" || key.name === "l") && selectedDiffState?.status === "ready") {
				setDiffFileIndex((current) => Math.min(Math.max(0, selectedDiffState.files.length - 1), current + 1))
				diffScrollRef.current?.scrollTo({ x: 0, y: 0 })
				return
			}
			if ((key.name === "[" || key.name === "left" || key.name === "h") && selectedDiffState?.status === "ready") {
				setDiffFileIndex((current) => Math.max(0, current - 1))
				diffScrollRef.current?.scrollTo({ x: 0, y: 0 })
				return
			}
			if (key.name === "o" && selectedPullRequest) {
				openSelectedPullRequestInBrowser(selectedPullRequest)
				return
			}
			return
		}

		// Fullscreen detail mode handles its own navigation keys.
		if (detailFullView) {
			if (key.name === "escape" || (key.name === "return" || key.name === "enter")) {
				setDetailFullView(false)
				setDetailScrollOffset(0)
				return
			}
			if (key.name === "home") {
				detailScrollRef.current?.scrollTo({ x: 0, y: 0 })
				setDetailScrollOffset(0)
				return
			}
			if (key.name === "end" || isShiftG(key)) {
				detailScrollRef.current?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER })
				setDetailScrollOffset(Number.MAX_SAFE_INTEGER)
				setPendingG(false)
				if (pendingGTimeoutRef.current !== null) {
					clearTimeout(pendingGTimeoutRef.current)
					pendingGTimeoutRef.current = null
				}
				return
			}
			if (key.name === "pageup") {
				detailScrollRef.current?.scrollBy({ x: 0, y: -halfPage })
				setDetailScrollOffset((current) => Math.max(0, current - halfPage))
				return
			}
			if (key.name === "pagedown") {
				detailScrollRef.current?.scrollBy({ x: 0, y: halfPage })
				setDetailScrollOffset((current) => current + halfPage)
				return
			}
			if (key.name === "g") {
				if (pendingG) {
					detailScrollRef.current?.scrollTo({ x: 0, y: 0 })
					setDetailScrollOffset(0)
					setPendingG(false)
					if (pendingGTimeoutRef.current !== null) {
						clearTimeout(pendingGTimeoutRef.current)
						pendingGTimeoutRef.current = null
					}
				} else {
					setPendingG(true)
					pendingGTimeoutRef.current = setTimeout(() => {
						setPendingG(false)
						pendingGTimeoutRef.current = null
					}, 500)
				}
				return
			}
			if (key.name === "up" || key.name === "k") {
				detailScrollRef.current?.scrollBy({ x: 0, y: -1 })
				setDetailScrollOffset((current) => Math.max(0, current - 1))
				return
			}
			if (key.name === "down" || key.name === "j") {
				detailScrollRef.current?.scrollBy({ x: 0, y: 1 })
				setDetailScrollOffset((current) => current + 1)
				return
			}
			if (key.ctrl && key.name === "u") {
				detailScrollRef.current?.scrollBy({ x: 0, y: -halfPage })
				setDetailScrollOffset((current) => Math.max(0, current - halfPage))
				return
			}
			if (key.ctrl && (key.name === "d" || key.name === "v")) {
				detailScrollRef.current?.scrollBy({ x: 0, y: halfPage })
				setDetailScrollOffset((current) => current + halfPage)
				return
			}
			if (key.name === "o" && selectedPullRequest) {
				openSelectedPullRequestInBrowser(selectedPullRequest)
				return
			}
			if (key.name === "y" && selectedPullRequest) {
				void copyPullRequestMetadata(selectedPullRequest)
					.then(() => flashNotice(`Copied #${selectedPullRequest.number} metadata`))
					.catch((error) => flashNotice(error instanceof Error ? error.message : String(error)))
				return
			}
			return
		}

		if (filterMode) {
			if (key.name === "escape") {
				setFilterDraft(filterQuery)
				setFilterMode(false)
				return
			}
			if (key.name === "enter") {
				setFilterQuery(filterDraft)
				setFilterMode(false)
				return
			}
			if (key.ctrl && key.name === "u") {
				setFilterDraft("")
				return
			}
			if (key.ctrl && key.name === "w") {
				setFilterDraft((current) => deleteLastWord(current))
				return
			}
			if (key.name === "backspace") {
				setFilterDraft((current) => current.slice(0, -1))
				return
			}
			if (!key.ctrl && !key.meta && key.sequence.length === 1 && key.name !== "return") {
				setFilterDraft((current) => current + key.sequence)
				return
			}
		}

		if (isShiftT(key)) {
			openThemeModal()
			return
		}

		if (key.name === "/") {
			setFilterDraft(filterQuery)
			setFilterMode(true)
			return
		}
		if (key.name === "escape" && filterQuery.length > 0) {
			setFilterQuery("")
			setFilterDraft("")
			setFilterMode(false)
			return
		}
		if (key.name === "r") {
			refreshPullRequests("Refreshing pull requests...")
			return
		}
		if (
			key.name === "[" ||
			((key.option || key.meta) && (key.name === "up" || key.name === "k")) ||
			(key.shift && key.name === "k") ||
			key.name === "K"
		) {
			setSelectedIndex((current) => {
				if (visiblePullRequests.length === 0 || groupStarts.length === 0) return 0
				const currentGroup = getCurrentGroupIndex(current)
				if (currentGroup <= 0) return groupStarts[groupStarts.length - 1]!
				return groupStarts[currentGroup - 1]!
			})
			return
		}
		if (
			key.name === "]" ||
			((key.option || key.meta) && (key.name === "down" || key.name === "j")) ||
			(key.shift && key.name === "j") ||
			key.name === "J"
		) {
			setSelectedIndex((current) => {
				if (visiblePullRequests.length === 0 || groupStarts.length === 0) return 0
				const currentGroup = getCurrentGroupIndex(current)
				if (currentGroup >= groupStarts.length - 1) return groupStarts[0]!
				return groupStarts[currentGroup + 1]!
			})
			return
		}
		if (key.ctrl && key.name === "u") {
			setSelectedIndex((current) => {
				if (visiblePullRequests.length === 0) return 0
				return Math.max(0, current - halfPage)
			})
			return
		}
		if (key.ctrl && key.name === "d") {
			setSelectedIndex((current) => {
				if (visiblePullRequests.length === 0) return 0
				return Math.min(visiblePullRequests.length - 1, current + halfPage)
			})
			return
		}
		if (key.name === "up" || key.name === "k") {
			setSelectedIndex((current) => {
				if (visiblePullRequests.length === 0) return 0
				return current <= 0 ? visiblePullRequests.length - 1 : current - 1
			})
			return
		}
		if (key.name === "down" || key.name === "j") {
			setSelectedIndex((current) => {
				if (visiblePullRequests.length === 0) return 0
				return current >= visiblePullRequests.length - 1 ? 0 : current + 1
			})
			return
		}
		// Vim-style navigation: gg to go to top, G to go to bottom
		if (isShiftG(key)) {
			setSelectedIndex((_current) => {
				if (visiblePullRequests.length === 0) return 0
				return visiblePullRequests.length - 1
			})
			return
		}
		if (key.name === "g") {
			if (pendingG) {
				setSelectedIndex(0)
				setPendingG(false)
				if (pendingGTimeoutRef.current !== null) {
					clearTimeout(pendingGTimeoutRef.current)
					pendingGTimeoutRef.current = null
				}
			} else {
				setPendingG(true)
				pendingGTimeoutRef.current = setTimeout(() => {
					setPendingG(false)
					pendingGTimeoutRef.current = null
				}, 500)
			}
			return
		}
		if ((key.name === "return" || key.name === "enter") && !detailFullView) {
			setDetailFullView(true)
			setDetailScrollOffset(0)
			return
		}
		if ((key.name === "d" || key.name === "p") && selectedPullRequest) {
			openDiffView()
			return
		}
		if (key.name === "l" && selectedPullRequest) {
			openLabelModal()
			return
		}
		if (key.name === "m" || key.name === "M") {
			if (selectedPullRequest) openMergeModal()
			return
		}
		if (key.name === "o" && selectedPullRequest) {
			openSelectedPullRequestInBrowser(selectedPullRequest)
			return
		}
		if ((key.name === "s" || key.name === "S") && selectedPullRequest) {
			const previousPullRequest = selectedPullRequest
			const nextReviewStatus = selectedPullRequest.reviewStatus === "draft" ? "review" : "draft"
			updatePullRequest(selectedPullRequest.url, (pullRequest) => ({
				...pullRequest,
				reviewStatus: nextReviewStatus,
			}))
			void toggleDraftStatus({ repository: selectedPullRequest.repository, number: selectedPullRequest.number, isDraft: selectedPullRequest.reviewStatus === "draft" })
				.then(() => {
					flashNotice(selectedPullRequest.reviewStatus === "draft" ? `Marked #${selectedPullRequest.number} ready` : `Marked #${selectedPullRequest.number} draft`)
				})
				.catch((error) => {
					updatePullRequest(selectedPullRequest.url, () => previousPullRequest)
					flashNotice(error instanceof Error ? error.message : String(error))
				})
			return
		}
		if (key.name === "y" && selectedPullRequest) {
			void copyPullRequestMetadata(selectedPullRequest)
				.then(() => {
					flashNotice(`Copied #${selectedPullRequest.number} metadata`)
				})
				.catch((error) => {
					flashNotice(error instanceof Error ? error.message : String(error))
				})
		}
	})

	const fullscreenContentWidth = Math.max(24, contentWidth - 2)
	const fullscreenBodyLines = Math.max(8, (height ?? 24) - 8)
	const wideFullscreenDetailScrollable = getDetailsPaneHeight({
		pullRequest: selectedPullRequest,
		contentWidth: fullscreenContentWidth,
		bodyLines: fullscreenBodyLines,
		paneWidth: contentWidth,
		showChecks: true,
	}) > wideBodyHeight
	const narrowFullscreenDetailScrollable = getDetailsPaneHeight({
		pullRequest: selectedPullRequest,
		contentWidth: fullscreenContentWidth,
		bodyLines: fullscreenBodyLines,
		paneWidth: contentWidth,
	}) > wideBodyHeight
	const wideDetailHeaderHeight = getDetailHeaderHeight(selectedPullRequest, rightPaneWidth, true)
	const wideDetailBodyViewportHeight = Math.max(1, wideBodyHeight - wideDetailHeaderHeight)
	const wideDetailBodyScrollable = getDetailBodyHeight(selectedPullRequest, rightContentWidth, wideDetailLines) > wideDetailBodyViewportHeight

	const prListProps = {
		groups: visibleGroups,
		selectedUrl: selectedPullRequest?.url ?? null,
		status: pullRequestStatus,
		error: pullRequestError,
		filterText: visibleFilterText,
		showFilterBar: filterMode || filterQuery.length > 0,
		isFilterEditing: filterMode,
		onSelectPullRequest: selectPullRequestByUrl,
	} as const

	const longestLabelName = labelModal.availableLabels.reduce((max, label) => Math.max(max, label.name.length), 0)
	const labelModalWidth = Math.min(Math.max(42, longestLabelName + 16), 56, contentWidth - 4)
	const labelModalHeight = Math.min(20, (height ?? 24) - 4)
	const labelModalLeft = Math.floor((contentWidth - labelModalWidth) / 2)
	const labelModalTop = Math.floor(((height ?? 24) - labelModalHeight) / 2)
	const mergeModalWidth = Math.min(68, Math.max(46, contentWidth - 12))
	const mergeModalHeight = Math.min(16, (height ?? 24) - 4)
	const mergeModalLeft = Math.floor((contentWidth - mergeModalWidth) / 2)
	const mergeModalTop = Math.floor(((height ?? 24) - mergeModalHeight) / 2)
	const themeModalWidth = Math.min(58, Math.max(38, contentWidth - 12))
	const themeModalHeight = Math.min(10, (height ?? 24) - 4)
	const themeModalLeft = Math.floor((contentWidth - themeModalWidth) / 2)
	const themeModalTop = Math.floor(((height ?? 24) - themeModalHeight) / 2)

	return (
		<box flexGrow={1} flexDirection="column" backgroundColor={colors.background}>
			<box paddingLeft={1} paddingRight={1} flexDirection="column" backgroundColor={colors.panel}>
				<PlainLine text={headerLine} fg={colors.muted} bold />
			</box>
			{isWideLayout && !detailFullView && !diffFullView && !isInitialLoading ? (
				<Divider width={contentWidth} junctionAt={dividerJunctionAt} junctionChar="┬" />
			) : (
				<Divider width={contentWidth} />
			)}
			{isInitialLoading ? (
				<LoadingPane content={detailPlaceholderContent} width={contentWidth} height={wideBodyHeight} />
			) : diffFullView ? (
				<PullRequestDiffPane
					pullRequest={selectedPullRequest}
					diffState={selectedDiffState}
					fileIndex={diffFileIndex}
					view={effectiveDiffRenderView}
					wrapMode={diffWrapMode}
					paneWidth={contentWidth}
					height={wideBodyHeight}
					loadingIndicator={loadingIndicator}
					scrollRef={diffScrollRef}
					themeId={themeId}
				/>
			) : isWideLayout && detailFullView ? (
				<box flexGrow={1} flexDirection="column">
					<scrollbox ref={detailScrollRef} focused flexGrow={1} verticalScrollbarOptions={{ visible: wideFullscreenDetailScrollable }}>
						<DetailsPane
							pullRequest={selectedPullRequest}
							contentWidth={fullscreenContentWidth}
							bodyLines={fullscreenBodyLines}
							paneWidth={contentWidth}
							showChecks
							placeholderContent={detailPlaceholderContent}
							loadingIndicator={loadingIndicator}
						/>
					</scrollbox>
				</box>
			) : isWideLayout ? (
				<box flexGrow={1} flexDirection="row">
					<box width={leftPaneWidth} height={wideBodyHeight} flexDirection="column" paddingLeft={sectionPadding} paddingRight={sectionPadding}>
						<scrollbox height={wideBodyHeight} flexGrow={0}>
							<PullRequestList {...prListProps} contentWidth={leftContentWidth} />
						</scrollbox>
					</box>
					<SeparatorColumn height={wideBodyHeight} junctionRows={detailJunctions} />
					<box width={rightPaneWidth} height={wideBodyHeight} flexDirection="column">
						{selectedPullRequest ? (
							<>
								<DetailHeader pullRequest={selectedPullRequest} contentWidth={rightContentWidth} paneWidth={rightPaneWidth} showChecks />
								<scrollbox flexGrow={1} verticalScrollbarOptions={{ visible: wideDetailBodyScrollable }}>
									<DetailBody pullRequest={selectedPullRequest} contentWidth={rightContentWidth} bodyLines={wideDetailLines} loadingIndicator={loadingIndicator} />
								</scrollbox>
							</>
						) : (
							<DetailPlaceholder content={detailPlaceholderContent} paneWidth={rightPaneWidth} />
						)}
					</box>
				</box>
			) : detailFullView ? (
				<box flexGrow={1} flexDirection="column">
					<scrollbox ref={detailScrollRef} focused flexGrow={1} verticalScrollbarOptions={{ visible: narrowFullscreenDetailScrollable }}>
						<DetailsPane
							pullRequest={selectedPullRequest}
							contentWidth={fullscreenContentWidth}
							bodyLines={fullscreenBodyLines}
							paneWidth={contentWidth}
							placeholderContent={detailPlaceholderContent}
							loadingIndicator={loadingIndicator}
						/>
					</scrollbox>
				</box>
			) : (
				<>
					<DetailsPane pullRequest={selectedPullRequest} contentWidth={rightContentWidth} paneWidth={contentWidth} placeholderContent={detailPlaceholderContent} loadingIndicator={loadingIndicator} />
					<Divider width={contentWidth} />
					<box flexGrow={1} flexDirection="column">
						<scrollbox flexGrow={1}>
							<box paddingLeft={sectionPadding} paddingRight={sectionPadding}>
								<PullRequestList {...prListProps} contentWidth={leftContentWidth} />
							</box>
						</scrollbox>
					</box>
				</>
			)}

			{isWideLayout && !detailFullView && !diffFullView && !isInitialLoading ? (
				<Divider width={contentWidth} junctionAt={dividerJunctionAt} junctionChar="┴" />
			) : (
				<Divider width={contentWidth} />
			)}
			<box paddingLeft={1} paddingRight={1} backgroundColor={colors.panel}>
				{footerNotice ? (
					<PlainLine text={footerNotice} fg={colors.count} />
				) : (
					<FooterHints
						filterEditing={filterMode}
						showFilterClear={filterMode || filterQuery.length > 0}
						detailFullView={detailFullView}
						diffFullView={diffFullView}
						hasSelection={selectedPullRequest !== null}
						hasError={pullRequestStatus === "error"}
						isLoading={pullRequestStatus === "loading"}
						loadingIndicator={loadingIndicator}
						retryProgress={retryProgress}
					/>
				)}
			</box>
			{labelModal.open ? (
				<LabelModal
					state={labelModal}
					currentLabels={selectedPullRequest?.labels ?? []}
					modalWidth={labelModalWidth}
					modalHeight={labelModalHeight}
					offsetLeft={labelModalLeft}
					offsetTop={labelModalTop}
					loadingIndicator={loadingIndicator}
				/>
			) : null}
			{mergeModal.open ? (
				<MergeModal
					state={mergeModal}
					modalWidth={mergeModalWidth}
					modalHeight={mergeModalHeight}
					offsetLeft={mergeModalLeft}
					offsetTop={mergeModalTop}
					loadingIndicator={loadingIndicator}
				/>
			) : null}
			{themeModal.open ? (
				<ThemeModal
					state={themeModal}
					activeThemeId={themeId}
					modalWidth={themeModalWidth}
					modalHeight={themeModalHeight}
					offsetLeft={themeModalLeft}
					offsetTop={themeModalTop}
				/>
			) : null}
		</box>
	)
}
