import type { PullRequestItem, PullRequestMergeAction, PullRequestMergeInfo, PullRequestMergeMethod, PullRequestState } from "./domain.js"

export interface MergeActionDefinition {
	readonly action: PullRequestMergeAction
	readonly title: string
	readonly description: string
	readonly cliArgs: readonly string[]
	readonly pastTense: string
	readonly danger?: boolean
	readonly refreshOnSuccess?: boolean
	readonly optimisticState?: PullRequestState
	readonly optimisticAutoMergeEnabled?: boolean
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

const allowsMethod = (info: PullRequestMergeInfo, method: PullRequestMergeMethod) =>
	info.allowedMethods.includes(method)

const mergeActionDefinitions = {
	merge: {
		action: "merge",
		title: "Merge now",
		description: "Create a merge commit and delete the branch.",
		cliArgs: ["--merge", "--delete-branch"],
		pastTense: "Merged",
		refreshOnSuccess: true,
		isAvailable: (info) => isCleanlyMergeable(info) && allowsMethod(info, "merge"),
	},
	squash: {
		action: "squash",
		title: "Squash merge now",
		description: "Merge this pull request and delete the branch.",
		cliArgs: ["--squash", "--delete-branch"],
		pastTense: "Merged",
		refreshOnSuccess: true,
		optimisticState: "merged",
		isAvailable: (info) => isCleanlyMergeable(info) && allowsMethod(info, "squash"),
	},
	rebase: {
		action: "rebase",
		title: "Rebase merge now",
		description: "Rebase onto the base branch and delete the branch.",
		cliArgs: ["--rebase", "--delete-branch"],
		pastTense: "Merged",
		refreshOnSuccess: true,
		isAvailable: (info) => isCleanlyMergeable(info) && allowsMethod(info, "rebase"),
	},
	"auto-merge": {
		action: "auto-merge",
		title: "Enable auto-merge",
		description: "Merge automatically after GitHub requirements pass.",
		cliArgs: ["--merge", "--auto", "--delete-branch"],
		pastTense: "Enabled auto-merge",
		optimisticAutoMergeEnabled: true,
		isAvailable: (info) =>
			info.state === "open" &&
			!info.autoMergeEnabled &&
			!info.isDraft &&
			info.mergeable !== "conflicting" &&
			allowsMethod(info, "merge"),
	},
	"auto-squash": {
		action: "auto-squash",
		title: "Enable auto-squash",
		description: "Squash merge automatically after GitHub requirements pass.",
		cliArgs: ["--squash", "--auto", "--delete-branch"],
		pastTense: "Enabled auto-merge",
		optimisticAutoMergeEnabled: true,
		isAvailable: (info) =>
			info.state === "open" &&
			!info.autoMergeEnabled &&
			!info.isDraft &&
			info.mergeable !== "conflicting" &&
			allowsMethod(info, "squash"),
	},
	"auto-rebase": {
		action: "auto-rebase",
		title: "Enable auto-rebase",
		description: "Rebase merge automatically after GitHub requirements pass.",
		cliArgs: ["--rebase", "--auto", "--delete-branch"],
		pastTense: "Enabled auto-merge",
		optimisticAutoMergeEnabled: true,
		isAvailable: (info) =>
			info.state === "open" &&
			!info.autoMergeEnabled &&
			!info.isDraft &&
			info.mergeable !== "conflicting" &&
			allowsMethod(info, "rebase"),
	},
	"disable-auto": {
		action: "disable-auto",
		title: "Disable auto-merge",
		description: "Cancel the pending GitHub auto-merge request.",
		cliArgs: ["--disable-auto"],
		pastTense: "Disabled auto-merge",
		optimisticAutoMergeEnabled: false,
		isAvailable: (info) => info.state === "open" && info.autoMergeEnabled,
	},
	"admin-merge": {
		action: "admin-merge",
		title: "Admin override merge",
		description: "Bypass unmet merge requirements with a merge commit.",
		cliArgs: ["--merge", "--admin", "--delete-branch"],
		pastTense: "Admin merged",
		danger: true,
		refreshOnSuccess: true,
		isAvailable: (info) =>
			info.viewerCanMergeAsAdmin &&
			info.state === "open" &&
			!info.isDraft &&
			info.mergeable !== "conflicting" &&
			allowsMethod(info, "merge"),
	},
	"admin-squash": {
		action: "admin-squash",
		title: "Admin override squash",
		description: "Bypass unmet merge requirements with a squash merge.",
		cliArgs: ["--squash", "--admin", "--delete-branch"],
		pastTense: "Admin merged",
		danger: true,
		refreshOnSuccess: true,
		optimisticState: "merged",
		isAvailable: (info) =>
			info.viewerCanMergeAsAdmin &&
			info.state === "open" &&
			!info.isDraft &&
			info.mergeable !== "conflicting" &&
			allowsMethod(info, "squash"),
	},
	"admin-rebase": {
		action: "admin-rebase",
		title: "Admin override rebase",
		description: "Bypass unmet merge requirements with a rebase merge.",
		cliArgs: ["--rebase", "--admin", "--delete-branch"],
		pastTense: "Admin merged",
		danger: true,
		refreshOnSuccess: true,
		isAvailable: (info) =>
			info.viewerCanMergeAsAdmin &&
			info.state === "open" &&
			!info.isDraft &&
			info.mergeable !== "conflicting" &&
			allowsMethod(info, "rebase"),
	},
} as const satisfies Record<PullRequestMergeAction, MergeActionDefinition>

export const mergeActions: readonly MergeActionDefinition[] = Object.values(mergeActionDefinitions)

export const availableMergeActions = (info: PullRequestMergeInfo | null): readonly MergeActionDefinition[] => {
	if (!info) return []
	return mergeActions.filter((action) => action.isAvailable(info))
}

export const getMergeActionDefinition = (action: PullRequestMergeAction): MergeActionDefinition => mergeActionDefinitions[action]

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
	allowedMethods: ["merge", "squash", "rebase"],
})
