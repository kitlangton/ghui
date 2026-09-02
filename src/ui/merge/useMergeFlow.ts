import { RegistryContext, useAtomSet } from "@effect/atom-react"
import { useContext } from "react"
import { allowedMergeMethodList, type PullRequestItem, type PullRequestMergeAction, type PullRequestMergeMethod, type RepositoryMergeMethods } from "../../domain.js"
import { pullRequestMergeMethods } from "../../domain.js"
import { errorMessage } from "../../errors.js"
import { getMergeKindDefinition, mergeInfoFromPullRequest, requiresMarkReady, visibleMergeKinds } from "../../mergeActions.js"
import type { MergeModalState } from "../modals.js"
import {
	getPullRequestMergeInfoAtom,
	getRepositoryMergeMethodsAtom,
	lastUsedMergeMethodAtom,
	mergePullRequestAtom,
	repoMergeMethodsCacheAtom,
	toggleDraftAtom,
} from "../pullRequests/atoms.js"

const wrapIndex = (index: number, length: number) => (length === 0 ? 0 : ((index % length) + length) % length)

const pickInitialMergeMethod = (allowed: RepositoryMergeMethods | null, preferred: PullRequestMergeMethod | undefined): PullRequestMergeMethod => {
	if (!allowed) return preferred ?? pullRequestMergeMethods[0]
	if (preferred && allowed[preferred]) return preferred
	return allowedMergeMethodList(allowed)[0] ?? pullRequestMergeMethods[0]
}

export interface UseMergeFlowInput {
	readonly mergeModal: MergeModalState
	readonly setMergeModal: (next: MergeModalState | ((prev: MergeModalState) => MergeModalState)) => void
	readonly selectedPullRequest: PullRequestItem | null
	readonly pullRequests: readonly PullRequestItem[]
	readonly closeActiveModal: () => void
	readonly flashNotice: (message: string) => void
	readonly updatePullRequest: (url: string, transform: (pr: PullRequestItem) => PullRequestItem) => void
	readonly markPullRequestCompleted: (pullRequest: PullRequestItem, state: "closed" | "merged") => void
	readonly restoreOptimisticPullRequest: (pullRequest: PullRequestItem) => void
	readonly refreshPullRequests: (message?: string) => void
}

export interface UseMergeFlowResult {
	readonly openMergeModal: () => void
	readonly cancelOrCloseMergeModal: () => void
	readonly confirmMergeAction: () => void
	readonly cycleMergeMethod: (delta: -1 | 1) => void
	readonly moveMergeSelection: (delta: -1 | 1) => void
}

/**
 * Owns the merge workflow: open → load info+methods asynchronously →
 * cycle method → choose kind → confirm (with two-stage confirm for
 * draft PRs) → execute optimistic + server call + rollback on error.
 *
 * The two-stage confirm is the load-bearing invariant: a draft PR with
 * a non-method-agnostic kind enters confirm mode (requires a second
 * Enter to mark-ready then merge). Cancel inside confirm mode backs
 * out instead of closing the modal.
 */
export const useMergeFlow = ({
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
}: UseMergeFlowInput): UseMergeFlowResult => {
	const registry = useContext(RegistryContext)
	const setRepoMergeMethodsCache = useAtomSet(repoMergeMethodsCacheAtom)
	const setLastUsedMergeMethod = useAtomSet(lastUsedMergeMethodAtom)
	const getPullRequestMergeInfo = useAtomSet(getPullRequestMergeInfoAtom, { mode: "promise" })
	const getRepositoryMergeMethods = useAtomSet(getRepositoryMergeMethodsAtom, { mode: "promise" })
	const mergePullRequest = useAtomSet(mergePullRequestAtom, { mode: "promise" })
	const toggleDraftStatus = useAtomSet(toggleDraftAtom, { mode: "promise" })

	const openMergeModal = () => {
		if (!selectedPullRequest) return
		const repository = selectedPullRequest.repository
		const number = selectedPullRequest.number
		const seededInfo = mergeInfoFromPullRequest(selectedPullRequest)

		const cachedAllowedMethods = registry.get(repoMergeMethodsCacheAtom)[repository] ?? null
		const lastUsed = registry.get(lastUsedMergeMethodAtom)[repository]
		const selectedMethod = pickInitialMergeMethod(cachedAllowedMethods, lastUsed)

		setMergeModal({
			repository,
			number,
			selectedIndex: 0,
			loading: true,
			running: false,
			info: seededInfo,
			error: null,
			selectedMethod,
			allowedMethods: cachedAllowedMethods,
			pendingConfirm: null,
		})

		void getPullRequestMergeInfo({ repository, number })
			.then((info) => {
				setMergeModal((current) => (current.repository === repository && current.number === number ? { ...current, loading: false, info, selectedIndex: 0 } : current))
			})
			.catch((error) => {
				setMergeModal((current) => (current.repository === repository && current.number === number ? { ...current, loading: false, error: errorMessage(error) } : current))
			})

		if (!cachedAllowedMethods) {
			void getRepositoryMergeMethods(repository)
				.then((methods) => {
					setRepoMergeMethodsCache((current) => ({ ...current, [repository]: methods }))
					setMergeModal((current) => {
						if (current.repository !== repository || current.number !== number) return current
						const nextSelected = pickInitialMergeMethod(methods, registry.get(lastUsedMergeMethodAtom)[repository])
						return { ...current, allowedMethods: methods, selectedMethod: nextSelected }
					})
				})
				.catch((error) => {
					setMergeModal((current) =>
						current.repository === repository && current.number === number ? { ...current, error: `Unable to load repository merge methods: ${errorMessage(error)}` } : current,
					)
				})
		}
	}

	const executeMergeAction = (
		kindDef: ReturnType<typeof getMergeKindDefinition>,
		method: PullRequestMergeMethod,
		info: NonNullable<MergeModalState["info"]>,
		markReady: boolean,
	) => {
		const { repository, number } = info
		const targetPullRequest = pullRequests.find((pullRequest) => pullRequest.repository === repository && pullRequest.number === number)
		const previousPullRequest = targetPullRequest ?? null
		const queueRequest = info.mergeQueueEnabled && (kindDef.kind === "now" || kindDef.kind === "auto")

		if (targetPullRequest && markReady) {
			updatePullRequest(targetPullRequest.url, (pullRequest) => (pullRequest.reviewStatus === "draft" ? { ...pullRequest, reviewStatus: "none" } : pullRequest))
		}
		if (targetPullRequest && !queueRequest && kindDef.optimisticAutoMergeEnabled !== undefined) {
			updatePullRequest(targetPullRequest.url, (pullRequest) => ({ ...pullRequest, autoMergeEnabled: kindDef.optimisticAutoMergeEnabled! }))
		}
		if (targetPullRequest && !queueRequest && kindDef.optimisticState === "merged") markPullRequestCompleted(targetPullRequest, "merged")

		const kind = kindDef.kind
		const action: PullRequestMergeAction = kind === "disable-auto" ? { kind } : { kind, method, mergeQueueEnabled: info.mergeQueueEnabled }
		const pastTense = kindDef.pastTense(method)

		closeActiveModal()
		if (!kindDef.methodAgnostic) {
			setLastUsedMergeMethod((current) => ({ ...current, [repository]: method }))
		}

		let markedReady = false
		const run = async () => {
			if (markReady) {
				await toggleDraftStatus({ repository, number, isDraft: true })
				markedReady = true
			}
			await mergePullRequest({ repository, number, action })
		}

		void run()
			.then(() => {
				if (kindDef.refreshOnSuccess) {
					refreshPullRequests(`${pastTense} #${number}`)
				} else {
					flashNotice(`${pastTense} #${number}`)
				}
			})
			.catch((error) => {
				if (markReady && markedReady) {
					refreshPullRequests(`Merge failed for #${number}`)
				} else if (previousPullRequest && (!queueRequest || markReady)) {
					restoreOptimisticPullRequest(previousPullRequest)
				}
				flashNotice(errorMessage(error))
			})
	}

	const confirmMergeAction = () => {
		if (!mergeModal.info || !mergeModal.allowedMethods || mergeModal.loading || mergeModal.running || mergeModal.error) return

		// Second confirm: enter while pending executes the queued action with mark-ready.
		if (mergeModal.pendingConfirm) {
			const pending = mergeModal.pendingConfirm
			const kindDef = getMergeKindDefinition(pending.kind, mergeModal.info.mergeQueueEnabled)
			executeMergeAction(kindDef, pending.method, mergeModal.info, /* markReady = */ true)
			return
		}

		const selectedMethod = mergeModal.selectedMethod
		const kinds = visibleMergeKinds(mergeModal.info, mergeModal.allowedMethods, selectedMethod)
		const kind = kinds[mergeModal.selectedIndex]
		if (!kind) return

		// Draft PR + non-agnostic kind → enter confirm mode rather than merge immediately.
		if (requiresMarkReady(mergeModal.info, kind)) {
			setMergeModal((current) => ({ ...current, pendingConfirm: { kind: kind.kind, method: selectedMethod } }))
			return
		}

		executeMergeAction(kind, selectedMethod, mergeModal.info, /* markReady = */ false)
	}

	const cancelOrCloseMergeModal = () => {
		if (mergeModal.pendingConfirm) {
			setMergeModal((current) => ({ ...current, pendingConfirm: null }))
			return
		}
		closeActiveModal()
	}

	const cycleMergeMethod = (delta: -1 | 1) => {
		setMergeModal((current) => {
			if (current.pendingConfirm) return current
			if (!current.allowedMethods) return current
			const allowed = allowedMergeMethodList(current.allowedMethods)
			if (allowed.length <= 1) return current
			const currentIndex = Math.max(0, allowed.indexOf(current.selectedMethod))
			const nextMethod = allowed[wrapIndex(currentIndex + delta, allowed.length)]!
			return { ...current, selectedMethod: nextMethod, selectedIndex: 0 }
		})
	}

	const moveMergeSelection = (delta: -1 | 1) =>
		setMergeModal((current) => {
			if (current.pendingConfirm) return current
			const kinds = visibleMergeKinds(current.info, current.allowedMethods, current.selectedMethod)
			const selectedIndex = wrapIndex(current.selectedIndex + delta, kinds.length)
			return selectedIndex === current.selectedIndex ? current : { ...current, selectedIndex }
		})

	return {
		openMergeModal,
		cancelOrCloseMergeModal,
		confirmMergeAction,
		cycleMergeMethod,
		moveMergeSelection,
	}
}
