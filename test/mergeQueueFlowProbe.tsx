import { RegistryContext } from "@effect/atom-react"
import { createTestRenderer } from "@opentui/core/testing"
import { createRoot } from "@opentui/react"
import { Effect, Layer } from "effect"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import { act, useState } from "react"
import { visibleMergeKinds } from "../src/mergeActions.ts"
import { CommandError } from "../src/services/CommandRunner.ts"
import { GitHubService } from "../src/services/GitHubService.ts"
import { githubRuntime } from "../src/services/runtime.ts"
import { useMergeFlow, type UseMergeFlowResult } from "../src/ui/merge/useMergeFlow.ts"
import { MergeModal } from "../src/ui/modals/MergeModal.tsx"
import type { MergeModalState } from "../src/ui/modals/types.ts"
import { getPullRequestMergeInfoAtom, getRepositoryMergeMethodsAtom } from "../src/ui/pullRequests/atoms.ts"
import type { PullRequestItem } from "../src/domain.ts"
import { mergeQueueCommandLayer, mergeQueuePullRequest } from "./fixtures/mergeQueue.ts"

const deferred = () => {
	let resolve: () => void = () => {}
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

export const probeMergeFlow = async (options: { queueEnabled: boolean; kind: "now" | "auto" | "admin"; isDraft?: boolean; pendingChecks?: boolean; fail?: boolean }) => {
	// @ts-expect-error -- React's act environment flag is intentionally global.
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	const started = deferred()
	const release = deferred()
	const finished = deferred()
	const calls: string[][] = []
	const mergeResult = Effect.promise(() => {
		started.resolve()
		return release.promise
	}).pipe(Effect.flatMap(() => (options.fail ? Effect.fail(new CommandError({ command: "gh", args: [], detail: "Fixture merge rejected", cause: "fixture" })) : Effect.void)))
	const layer = GitHubService.layerNoDeps.pipe(Layer.provide(mergeQueueCommandLayer({ ...options, mergeResult }, calls)))
	const registry = AtomRegistry.make({ initialValues: [[githubRuntime.layer, layer]] })
	const setup = await createTestRenderer({ width: 90, height: 24 })
	const root = createRoot(setup.renderer)
	let pr: PullRequestItem = { ...mergeQueuePullRequest, reviewStatus: options.isDraft ? "draft" : "approved" }
	const completed: string[] = []
	const refreshes: string[] = []
	const notices: string[] = []
	let restored = 0
	let flow: UseMergeFlowResult | undefined
	let modal: MergeModalState | undefined
	const Harness = () => {
		const [state, setState] = useState<MergeModalState>({
			repository: null,
			number: null,
			selectedIndex: 0,
			loading: false,
			running: false,
			info: null,
			error: null,
			selectedMethod: "squash",
			allowedMethods: null,
			pendingConfirm: null,
		})
		modal = state
		flow = useMergeFlow({
			mergeModal: state,
			setMergeModal: setState,
			selectedPullRequest: pr,
			pullRequests: [pr],
			closeActiveModal: () => {},
			flashNotice: (message) => {
				notices.push(message)
				finished.resolve()
			},
			updatePullRequest: (_url, transform) => {
				pr = transform(pr)
			},
			markPullRequestCompleted: (_target, state) => {
				completed.push(state)
				pr = { ...pr, state }
			},
			restoreOptimisticPullRequest: (previous) => {
				pr = previous
				restored += 1
			},
			refreshPullRequests: (message) => {
				if (message) refreshes.push(message)
				finished.resolve()
			},
		})
		return <MergeModal state={state} modalWidth={86} modalHeight={22} offsetLeft={0} offsetTop={0} loadingIndicator="." />
	}
	try {
		act(() =>
			root.render(
				<RegistryContext.Provider value={registry}>
					<Harness />
				</RegistryContext.Provider>,
			),
		)
		await act(async () => {
			flow?.openMergeModal()
			await Effect.runPromise(
				Effect.all([
					AtomRegistry.getResult(registry, getPullRequestMergeInfoAtom, { suspendOnWaiting: true }),
					AtomRegistry.getResult(registry, getRepositoryMergeMethodsAtom, { suspendOnWaiting: true }),
				]),
			)
		})
		if (!flow || !modal) throw new Error("Merge flow failed to mount")
		const kindIndex = visibleMergeKinds(modal.info, modal.allowedMethods, modal.selectedMethod).findIndex((kind) => kind.kind === options.kind)
		if (kindIndex < 0) throw new Error(`Missing merge action: ${options.kind}`)
		for (let index = 0; index < kindIndex; index++) act(() => flow?.moveMergeSelection(1))
		await setup.renderOnce()
		const modalFrame = setup.captureCharFrame()
		let firstConfirmMutations: string[][] = []
		act(() => flow?.confirmMergeAction())
		if (options.isDraft) {
			firstConfirmMutations = calls.filter((call) => call[1] === "pr" && call[2] !== "view")
			act(() => flow?.confirmMergeAction())
		}
		const pendingState = pr.state
		const autoMergeEnabled = pr.autoMergeEnabled
		await act(async () => {
			await Promise.race([started.promise, finished.promise])
		})
		await act(async () => {
			release.resolve()
			await finished.promise
		})
		return {
			pendingState,
			finalState: pr.state,
			finalReviewStatus: pr.reviewStatus,
			autoMergeEnabled,
			completed,
			refreshes,
			notices,
			restored,
			modalFrame,
			firstConfirmMutations,
			mutations: calls.filter((call) => call[1] === "pr" && call[2] !== "view"),
		}
	} finally {
		release.resolve()
		act(() => root.unmount())
		registry.dispose()
		setup.renderer.destroy()
	}
}
