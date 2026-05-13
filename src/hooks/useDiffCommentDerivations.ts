import { useMemo } from "react"
import type { PullRequestReviewComment } from "../domain.js"
import {
	buildStackedDiffFiles,
	diffCommentAnchorLabel,
	diffCommentLocationKey,
	getStackedDiffCommentAnchors,
	PullRequestDiffState,
	type DiffFilePatch,
	type DiffView,
	type DiffWhitespaceMode,
	type DiffWrapMode,
	type StackedDiffCommentAnchor,
	type StackedDiffFilePatch,
	type PullRequestDiffState as PullRequestDiffStateType,
} from "../ui/diff.js"
import { diffCommentRangeContains, diffCommentRangeLabel, diffCommentRangeSelection, diffCommentThreadMapKey } from "../ui/diff/comments.js"

export interface UseDiffCommentDerivationsInput {
	readonly selectedDiffState: PullRequestDiffStateType | undefined
	readonly readyDiffFiles: readonly DiffFilePatch[]
	readonly effectiveDiffRenderView: DiffView
	readonly diffWrapMode: DiffWrapMode
	readonly diffWhitespaceMode: DiffWhitespaceMode
	readonly contentWidth: number
	readonly diffFullView: boolean
	readonly diffCommentAnchorIndex: number
	readonly diffCommentRangeStartIndex: number | null
	readonly selectedDiffKey: string | null
	readonly diffCommentThreads: Record<string, readonly PullRequestReviewComment[]>
}

export interface DiffCommentDerivations {
	readonly displayedDiffState: PullRequestDiffStateType | undefined
	readonly stackedDiffFiles: readonly StackedDiffFilePatch[]
	readonly diffCommentAnchors: readonly StackedDiffCommentAnchor[]
	readonly selectedDiffCommentAnchorIndex: number
	readonly selectedDiffCommentAnchor: StackedDiffCommentAnchor | null
	readonly diffCommentRangeStartAnchor: StackedDiffCommentAnchor | null
	readonly selectedDiffCommentRange: ReturnType<typeof diffCommentRangeSelection>
	readonly selectedDiffCommentRangeAnchors: readonly StackedDiffCommentAnchor[]
	readonly diffCommentRangeActive: boolean
	readonly selectedDiffCommentLabel: string | null
	readonly selectedDiffCommentThread: readonly PullRequestReviewComment[]
	readonly diffLineColorContextKey: string | null
	readonly diffCommentThreadAnchors: readonly StackedDiffCommentAnchor[]
}

export const useDiffCommentDerivations = (input: UseDiffCommentDerivationsInput): DiffCommentDerivations => {
	const {
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
	} = input

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

	return {
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
	}
}
