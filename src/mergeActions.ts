import type {
	PullRequestItem,
	PullRequestMergeAction,
	PullRequestMergeInfo,
	PullRequestMergeKind,
	PullRequestMergeMethod,
	PullRequestState,
	RepositoryMergeMethods,
} from "./domain.js"

export interface MergeKindDefinition {
	readonly kind: PullRequestMergeKind
	readonly title: (method: PullRequestMergeMethod) => string
	readonly description: (method: PullRequestMergeMethod) => string
	readonly pastTense: (method: PullRequestMergeMethod) => string
	readonly danger?: boolean
	readonly refreshOnSuccess?: boolean
	readonly optimisticState?: PullRequestState
	readonly optimisticAutoMergeEnabled?: boolean
	readonly methodAgnostic?: boolean
	readonly isAvailable: (info: PullRequestMergeInfo) => boolean
}

const isCleanlyMergeable = (info: PullRequestMergeInfo) =>
	info.state === "open" &&
	!info.isDraft &&
	info.mergeable === "mergeable" &&
	info.reviewStatus !== "changes" &&
	info.reviewStatus !== "review" &&
	info.checkStatus !== "pending" &&
	info.checkStatus !== "failing"

interface MethodCopy {
	readonly verb: string
	readonly pastTense: string
	readonly autoDescription: string
	readonly adminDescription: string
	readonly cliFlag: string
}

const methodCopy = {
	squash: {
		verb: "Squash and merge",
		pastTense: "Merged",
		autoDescription: "Squash and merge automatically once GitHub requirements pass.",
		adminDescription: "Bypass merge requirements and squash with --admin.",
		cliFlag: "--squash",
	},
	merge: {
		verb: "Create a merge commit",
		pastTense: "Merged",
		autoDescription: "Create a merge commit automatically once GitHub requirements pass.",
		adminDescription: "Bypass merge requirements and create a merge commit with --admin.",
		cliFlag: "--merge",
	},
	rebase: {
		verb: "Rebase and merge",
		pastTense: "Rebased",
		autoDescription: "Rebase and merge automatically once GitHub requirements pass.",
		adminDescription: "Bypass merge requirements and rebase with --admin.",
		cliFlag: "--rebase",
	},
} as const satisfies Record<PullRequestMergeMethod, MethodCopy>

const mergeKindDefinitions = {
	now: {
		kind: "now",
		title: (method) => `${methodCopy[method].verb} now`,
		description: () => "Merge this pull request and delete the branch.",
		pastTense: (method) => methodCopy[method].pastTense,
		refreshOnSuccess: true,
		optimisticState: "merged",
		isAvailable: isCleanlyMergeable,
	},
	auto: {
		kind: "auto",
		title: () => "Enable auto-merge",
		description: (method) => methodCopy[method].autoDescription,
		pastTense: () => "Enabled auto-merge",
		optimisticAutoMergeEnabled: true,
		isAvailable: (info) => info.state === "open" && !info.autoMergeEnabled && !info.isDraft && info.mergeable !== "conflicting",
	},
	"disable-auto": {
		kind: "disable-auto",
		title: () => "Disable auto-merge",
		description: () => "Cancel the pending GitHub auto-merge request.",
		pastTense: () => "Disabled auto-merge",
		optimisticAutoMergeEnabled: false,
		methodAgnostic: true,
		isAvailable: (info) => info.state === "open" && info.autoMergeEnabled,
	},
	admin: {
		kind: "admin",
		title: (method) => `${methodCopy[method].verb} (admin)`,
		description: (method) => methodCopy[method].adminDescription,
		pastTense: () => "Admin merged",
		danger: true,
		refreshOnSuccess: true,
		optimisticState: "merged",
		isAvailable: (info) => info.viewerCanMergeAsAdmin && info.state === "open" && !info.isDraft && info.mergeable !== "conflicting",
	},
} as const satisfies Record<PullRequestMergeKind, MergeKindDefinition>

export const mergeKinds: readonly MergeKindDefinition[] = Object.values(mergeKindDefinitions)

export const availableMergeKinds = (info: PullRequestMergeInfo | null): readonly MergeKindDefinition[] => {
	if (!info) return []
	return mergeKinds.filter((kind) => kind.isAvailable(info)).map((kind) => getMergeKindDefinition(kind.kind, info.mergeQueueEnabled))
}

export const visibleMergeKinds = (info: PullRequestMergeInfo | null, allowed: RepositoryMergeMethods | null, selected: PullRequestMergeMethod): readonly MergeKindDefinition[] => {
	if (!allowed || !info) return []
	// Draft PRs surface the same kinds they would once marked ready; the merge
	// flow handles `gh pr ready` ahead of the actual merge.
	const queryInfo = info.isDraft ? { ...info, isDraft: false } : info
	const available = availableMergeKinds(queryInfo)
	if (allowed[selected]) return available
	return available.filter((kind) => kind.methodAgnostic)
}

export const requiresMarkReady = (info: PullRequestMergeInfo | null, kind: MergeKindDefinition): boolean => Boolean(info?.isDraft && !kind.methodAgnostic)

export const mergeKindRowTitle = (kind: MergeKindDefinition, method: PullRequestMergeMethod, fromDraft: boolean): string => {
	const baseTitle = kind.title(method)
	if (!fromDraft || kind.methodAgnostic) return baseTitle
	return `Mark ready & ${baseTitle.charAt(0).toLowerCase()}${baseTitle.slice(1)}`
}

export const getMergeKindDefinition = (kind: PullRequestMergeKind, mergeQueueEnabled: boolean): MergeKindDefinition => {
	const definition = mergeKindDefinitions[kind]
	if (!mergeQueueEnabled || kind === "disable-auto") return definition
	if (kind === "admin") return { ...definition, description: () => "Bypass the merge queue and merge directly with --admin." }
	return {
		...definition,
		title: () => (kind === "now" ? "Add to merge queue" : "Enable merge queue when ready"),
		description: () => "Queue when requirements pass; GitHub chooses the merge method.",
		pastTense: () => "Requested merge queue for",
		refreshOnSuccess: true,
	}
}

export const mergeActionCliArgs = (action: PullRequestMergeAction): readonly string[] => {
	if (action.kind === "disable-auto") return ["--disable-auto"]
	const methodFlag = methodCopy[action.method].cliFlag
	// gh rejects branch deletion for queue targets, even with --admin.
	const deleteBranch = action.mergeQueueEnabled ? [] : ["--delete-branch"]
	if (action.kind === "now") return [methodFlag, ...deleteBranch]
	if (action.kind === "auto") return [methodFlag, "--auto", ...deleteBranch]
	return [methodFlag, "--admin", ...deleteBranch]
}

export const mergeInfoFromPullRequest = (pullRequest: PullRequestItem): PullRequestMergeInfo => ({
	repository: pullRequest.repository,
	number: pullRequest.number,
	title: pullRequest.title,
	state: pullRequest.state,
	isDraft: pullRequest.reviewStatus === "draft",
	mergeable: "unknown",
	reviewStatus: pullRequest.reviewStatus,
	checkStatus: pullRequest.checkStatus,
	checkSummary: pullRequest.checkSummary,
	autoMergeEnabled: pullRequest.autoMergeEnabled,
	viewerCanMergeAsAdmin: false,
	mergeQueueEnabled: false,
})
