import type { IssueItem, PullRequestItem, PullRequestLabel, SubmitPullRequestReviewInput } from "../domain.js"
import { errorMessage } from "../errors.js"
import { filterLabels } from "../ui/modals/shared.js"
import type { CloseModalState, LabelModalState, PullRequestStateModalState, SubmitReviewModalState } from "../ui/modals/types.js"

interface SubmitReviewOption {
	readonly event: SubmitPullRequestReviewInput["event"]
	readonly title: string
}

export interface UseItemModalActionsInput {
	readonly pullRequestStateModal: PullRequestStateModalState
	readonly setPullRequestStateModal: (next: PullRequestStateModalState | ((prev: PullRequestStateModalState) => PullRequestStateModalState)) => void
	readonly closeModal: CloseModalState
	readonly labelModal: LabelModalState
	readonly submitReviewModal: SubmitReviewModalState
	readonly setSubmitReviewModal: (next: SubmitReviewModalState | ((prev: SubmitReviewModalState) => SubmitReviewModalState)) => void
	readonly submitReviewOptions: readonly SubmitReviewOption[]
	readonly reviewStatusAfterSubmit: Readonly<Record<string, PullRequestItem["reviewStatus"] | null>>
	readonly selectedItemLabels: readonly PullRequestLabel[]
	readonly selectedCommentSubject: IssueItem | PullRequestItem | null
	readonly selectedIssue: IssueItem | null
	readonly selectedPullRequest: PullRequestItem | null
	readonly activeWorkspaceSurface: string
	readonly pullRequests: readonly PullRequestItem[]
	readonly allIssues: readonly IssueItem[]
	readonly closeActiveModal: () => void
	readonly flashNotice: (msg: string) => void
	readonly updatePullRequest: (url: string, transform: (pr: PullRequestItem) => PullRequestItem) => void
	readonly updateIssue: (url: string, transform: (issue: IssueItem) => IssueItem) => void
	readonly setIssueOverrides: (next: (prev: Record<string, IssueItem>) => Record<string, IssueItem>) => void
	readonly markPullRequestCompleted: (pr: PullRequestItem, state: "closed" | "merged") => void
	readonly restoreOptimisticPullRequest: (pr: PullRequestItem) => void
	readonly refreshPullRequests: (message?: string, options?: { readonly resetTransientState?: boolean }) => void
	readonly refreshIssues: () => void
	readonly toggleDraftStatus: (input: { repository: string; number: number; isDraft: boolean }) => Promise<unknown>
	readonly closePullRequest: (input: { repository: string; number: number }) => Promise<unknown>
	readonly closeIssue: (input: { repository: string; number: number }) => Promise<unknown>
	readonly submitPullRequestReview: (input: SubmitPullRequestReviewInput) => Promise<unknown>
	readonly addPullRequestLabel: (input: { repository: string; number: number; label: string }) => Promise<unknown>
	readonly removePullRequestLabel: (input: { repository: string; number: number; label: string }) => Promise<unknown>
	readonly addIssueLabel: (input: { repository: string; number: number; label: string }) => Promise<unknown>
	readonly removeIssueLabel: (input: { repository: string; number: number; label: string }) => Promise<unknown>
}

export interface ItemModalActions {
	readonly movePullRequestStateSelection: () => void
	readonly confirmPullRequestStateChange: () => void
	readonly confirmCloseModal: () => void
	readonly toggleLabelAtIndex: () => void
	readonly confirmSubmitReview: () => void
}

// Confirmation handlers for the close / draft-toggle / label / submit-review
// modals. Three of the four are item-agnostic — close and label work for
// both PRs and Issues; submit-review and draft-toggle are PR-only. The hook
// receives both PR and Issue dependencies and branches on
// `activeWorkspaceSurface` / `closeModal.kind`. Renamed from
// `usePullRequestModalActions` — the original name implied PR-only.
export const useItemModalActions = (input: UseItemModalActionsInput): ItemModalActions => {
	const {
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
		refreshIssues,
		toggleDraftStatus,
		closePullRequest,
		closeIssue,
		submitPullRequestReview,
		addPullRequestLabel,
		removePullRequestLabel,
		addIssueLabel,
		removeIssueLabel,
	} = input

	const movePullRequestStateSelection = () => {
		setPullRequestStateModal((current) => ({ ...current, selectedIsDraft: !current.selectedIsDraft }))
	}

	const confirmPullRequestStateChange = () => {
		if (!pullRequestStateModal.repository || pullRequestStateModal.number === null || !pullRequestStateModal.url || pullRequestStateModal.running) return
		const { repository, number, url, isDraft, selectedIsDraft } = pullRequestStateModal
		if (selectedIsDraft === isDraft) {
			closeActiveModal()
			return
		}
		const previousPullRequest = pullRequests.find((pullRequest) => pullRequest.url === url) ?? null
		const nextReviewStatus = selectedIsDraft ? "draft" : "review"
		if (previousPullRequest) {
			updatePullRequest(url, (pullRequest) => ({ ...pullRequest, reviewStatus: nextReviewStatus }))
		}
		closeActiveModal()
		flashNotice(selectedIsDraft ? `Converted #${number} to draft` : `Marked #${number} ready for review`)
		void toggleDraftStatus({ repository, number, isDraft }).catch((error) => {
			if (previousPullRequest) updatePullRequest(url, () => previousPullRequest)
			flashNotice(errorMessage(error))
		})
	}

	const confirmCloseModal = () => {
		if (!closeModal.repository || closeModal.number === null || !closeModal.url) return
		const { repository, number, url, kind } = closeModal
		closeActiveModal()
		flashNotice(`Closed #${number}`)

		if (kind === "issue") {
			const previousIssue = allIssues.find((issue) => issue.url === url)
			if (previousIssue) setIssueOverrides((current) => ({ ...current, [url]: { ...previousIssue, state: "closed" } }))
			void closeIssue({ repository, number })
				.then(() => refreshIssues())
				.catch((error) => {
					if (previousIssue) setIssueOverrides((current) => ({ ...current, [url]: previousIssue }))
					flashNotice(errorMessage(error))
				})
			return
		}

		const previousPullRequest = pullRequests.find((pullRequest) => pullRequest.url === url) ?? null
		if (previousPullRequest) markPullRequestCompleted(previousPullRequest, "closed")
		void closePullRequest({ repository, number })
			.then(() => refreshPullRequests())
			.catch((error) => {
				if (previousPullRequest) restoreOptimisticPullRequest(previousPullRequest)
				flashNotice(errorMessage(error))
			})
	}

	const toggleLabelAtIndex = () => {
		if (!selectedCommentSubject) return
		const filtered = filterLabels(labelModal.availableLabels, labelModal.query)
		const label = filtered[labelModal.selectedIndex]
		if (!label) return
		const isIssue = activeWorkspaceSurface === "issues"
		const isActive = selectedItemLabels.some((l) => l.name.toLowerCase() === label.name.toLowerCase())
		const previousPullRequest = isIssue ? null : selectedPullRequest
		const previousIssue = isIssue ? selectedIssue : null
		const updateSelectedLabels = (labels: readonly PullRequestLabel[]) => {
			if (isIssue && selectedIssue) {
				updateIssue(selectedIssue.url, (issue) => ({ ...issue, labels }))
			} else if (selectedPullRequest) {
				updatePullRequest(selectedPullRequest.url, (pr) => ({ ...pr, labels }))
			}
		}
		const restorePreviousLabels = () => {
			if (previousIssue) updateIssue(previousIssue.url, () => previousIssue)
			if (previousPullRequest) updatePullRequest(previousPullRequest.url, () => previousPullRequest)
		}
		const { repository, number } = selectedCommentSubject

		if (isActive) {
			updateSelectedLabels(selectedItemLabels.filter((l) => l.name.toLowerCase() !== label.name.toLowerCase()))
			const removeLabel = isIssue ? removeIssueLabel : removePullRequestLabel
			void removeLabel({ repository, number, label: label.name })
				.then(() => flashNotice(`Removed ${label.name} from #${number}`))
				.catch((error) => {
					restorePreviousLabels()
					flashNotice(errorMessage(error))
				})
		} else {
			updateSelectedLabels([...selectedItemLabels, { name: label.name, color: label.color }])
			const addLabel = isIssue ? addIssueLabel : addPullRequestLabel
			void addLabel({ repository, number, label: label.name })
				.then(() => flashNotice(`Added ${label.name} to #${number}`))
				.catch((error) => {
					restorePreviousLabels()
					flashNotice(errorMessage(error))
				})
		}
	}

	const confirmSubmitReview = () => {
		if (!submitReviewModal.repository || submitReviewModal.number === null || submitReviewModal.running) return
		const option = submitReviewOptions[submitReviewModal.selectedIndex]
		if (!option) return
		const repository = submitReviewModal.repository
		const number = submitReviewModal.number
		const body = submitReviewModal.body.trim()
		const targetPullRequest = pullRequests.find((pullRequest) => pullRequest.repository === repository && pullRequest.number === number) ?? null
		const nextReviewStatus = reviewStatusAfterSubmit[option.event]

		setSubmitReviewModal((current) => ({ ...current, running: true, error: null }))
		void submitPullRequestReview({ repository, number, event: option.event, body })
			.then(() => {
				if (targetPullRequest && nextReviewStatus) {
					updatePullRequest(targetPullRequest.url, (pullRequest) => ({ ...pullRequest, reviewStatus: nextReviewStatus }))
				}
				closeActiveModal()
				flashNotice(`Submitted ${option.title.toLowerCase()} review for #${number}`)
			})
			.catch((error) => {
				setSubmitReviewModal((current) => ({ ...current, running: false, error: errorMessage(error) }))
				flashNotice(errorMessage(error))
			})
	}

	return {
		movePullRequestStateSelection,
		confirmPullRequestStateChange,
		confirmCloseModal,
		toggleLabelAtIndex,
		confirmSubmitReview,
	}
}
