import { RegistryContext, useAtomSet } from "@effect/atom-react"
import { useCallback, useContext } from "react"
import {
	addPullRequestLabelAtom,
	closePullRequestAtom,
	prewarmRepositoryDetailsAtom,
	pruneCacheAtom,
	removePullRequestLabelAtom,
	toggleDraftAtom,
} from "../ui/pullRequests/atoms.js"
import { addIssueLabelAtom, closeIssueAtom, issuesAtom, removeIssueLabelAtom } from "../ui/issues/atoms.js"
import { listIssueCommentsAtom, listPullRequestCommentsAtom } from "../ui/comments/atoms.js"
import { openUrlAtom, submitPullRequestReviewAtom } from "../services/systemAtoms.js"
import { readRepoRollupAtom, readWorkspacePreferencesAtom, writeWorkspacePreferencesAtom } from "../workspace/atoms.js"

/**
 * Bundle of `useAtomSet` calls for every GitHubService action the App
 * fires. Stays a separate hook so the bulk of action wiring isn't
 * inlined in App.tsx — and so adding a new action only touches this
 * file plus the consuming surface.
 */
export const useGitHubActions = () => {
	const addPullRequestLabel = useAtomSet(addPullRequestLabelAtom, { mode: "promise" })
	const removePullRequestLabel = useAtomSet(removePullRequestLabelAtom, { mode: "promise" })
	const addIssueLabel = useAtomSet(addIssueLabelAtom, { mode: "promise" })
	const removeIssueLabel = useAtomSet(removeIssueLabelAtom, { mode: "promise" })
	const toggleDraftStatus = useAtomSet(toggleDraftAtom, { mode: "promise" })
	const listPullRequestComments = useAtomSet(listPullRequestCommentsAtom, { mode: "promise" })
	const listIssueComments = useAtomSet(listIssueCommentsAtom, { mode: "promise" })
	const readWorkspacePreferences = useAtomSet(readWorkspacePreferencesAtom, { mode: "promise" })
	const writeWorkspacePreferences = useAtomSet(writeWorkspacePreferencesAtom, { mode: "promise" })
	const pruneCache = useAtomSet(pruneCacheAtom, { mode: "promise" })
	const prewarmRepositoryDetails = useAtomSet(prewarmRepositoryDetailsAtom, { mode: "promise" })
	const closePullRequest = useAtomSet(closePullRequestAtom, { mode: "promise" })
	const closeIssue = useAtomSet(closeIssueAtom, { mode: "promise" })
	const registry = useContext(RegistryContext)
	const refreshIssues = useCallback(() => registry.refresh(issuesAtom), [registry])
	const submitPullRequestReview = useAtomSet(submitPullRequestReviewAtom, { mode: "promise" })
	const openUrl = useAtomSet(openUrlAtom, { mode: "promise" })
	const readRepoRollup = useAtomSet(readRepoRollupAtom, { mode: "promise" })
	return {
		addPullRequestLabel,
		removePullRequestLabel,
		addIssueLabel,
		removeIssueLabel,
		toggleDraftStatus,
		listPullRequestComments,
		listIssueComments,
		readWorkspacePreferences,
		writeWorkspacePreferences,
		pruneCache,
		prewarmRepositoryDetails,
		closePullRequest,
		closeIssue,
		refreshIssues,
		submitPullRequestReview,
		openUrl,
		readRepoRollup,
	}
}
