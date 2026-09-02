import { allowedMergeMethodList } from "../../domain.ts"
import { visibleMergeKinds } from "../../mergeActions.ts"
import type { MergeModalState } from "../../ui/modals.ts"
import type { MergeModalCtx } from "../mergeModal.ts"

export interface BuildMergeModalCtxInput {
	readonly mergeModal: MergeModalState
	readonly cancelOrCloseMergeModal: () => void
	readonly confirmMergeAction: () => void
	readonly cycleMergeMethod: (delta: -1 | 1) => void
	readonly moveMergeSelection: (delta: -1 | 1) => void
}

export const buildMergeModalCtx = ({ mergeModal, cancelOrCloseMergeModal, confirmMergeAction, cycleMergeMethod, moveMergeSelection }: BuildMergeModalCtxInput): MergeModalCtx => ({
	availableActionCount: mergeModal.error ? 0 : visibleMergeKinds(mergeModal.info, mergeModal.allowedMethods, mergeModal.selectedMethod).length,
	multipleMethodsAllowed: mergeModal.allowedMethods ? allowedMergeMethodList(mergeModal.allowedMethods).length > 1 : false,
	inConfirmMode: mergeModal.pendingConfirm !== null,
	closeOrBackOut: cancelOrCloseMergeModal,
	confirmMerge: confirmMergeAction,
	cycleMethod: cycleMergeMethod,
	moveSelection: moveMergeSelection,
})
