import { Effect } from "effect"
import * as Atom from "effect/unstable/reactivity/Atom"
import { BrowserOpener } from "../services/BrowserOpener.js"
import { Clipboard } from "../services/Clipboard.js"
import { GitHubService } from "../services/GitHubService.js"
import { saveStoredDiffWhitespaceMode } from "../themeStore.js"
import { commentsViewActiveAtom, selectedCommentKeyAtom } from "../ui/comments/atoms.js"
import { detailFullViewAtom, detailScrollOffsetAtom } from "../ui/detail/atoms.js"
import { diffCommentRangeStartIndexAtom, diffFullViewAtom, diffRenderViewAtom, diffWhitespaceModeAtom, diffWrapModeAtom } from "../ui/diff/atoms.js"
import { filterDraftAtom, filterModeAtom, filterQueryAtom } from "../ui/filter/atoms.js"
import { selectedIssueAtom } from "../ui/issues/atoms.js"
import { activeModalAtom } from "../ui/modals/atoms.js"
import { submitReviewOptions } from "../ui/modals/shared.js"
import { initialCommandPaletteState, initialCommentModalState, initialOpenRepositoryModalState, Modal } from "../ui/modals/types.js"
import { noticeAtom } from "../ui/notice/atoms.js"
import type { PullRequestUserQueueMode } from "../domain.js"
import { pullRequestQueueModes } from "../domain.js"
import { labelCacheAtom, selectedPullRequestAtom } from "../ui/pullRequests/atoms.js"
import { selectedRepositoryAtom, workspaceSurfaceAtom, workspaceTabSurfacesAtom } from "../workspace/atoms.js"
import { type WorkspaceSurface, workspaceSurfaceLabels, workspaceSurfaces } from "../workspaceSurfaces.js"
import {
	changedFilesReasonAtom,
	changedFilesSubtitleAtom,
	detailCloseDisabledReasonAtom,
	diffCloseDisabledReasonAtom,
	diffCommentAnchorSubtitleAtom,
	diffFileSubtitleAtom,
	diffOpenCommentTargetTitleAtom,
	diffOpenRequiredReasonAtom,
	diffReloadDisabledReasonAtom,
	diffThreadReasonAtom,
	diffThreadSubtitleAtom,
	diffToggleRangeTitleAtom,
	filterClearDisabledReasonAtom,
	filterTitleAtom,
	issueSelectedReasonAtom,
	loadMoreDisabledReasonAtom,
	loadMoreSubtitleAtom,
	noOpenPullRequestReasonAtom,
	noPullRequestReasonAtom,
	noSelectedItemReasonAtom,
	ownCommentReasonAtom,
	pullRequestRefreshTitleAtom,
	pullRequestSurfaceReasonAtom,
	repositoryOpenSubtitleAtom,
	selectedCommentReasonAtom,
	selectedCommentSubjectAtom,
	selectedDiffLineReasonAtom,
	selectedIssueLabelAtom,
	selectedItemLabelAtom,
	selectedPullRequestLabelAtom,
	queueViewAlreadyActiveReasonAtom,
	queueViewSubtitleAtom,
	queueViewTitleFor,
	repositoryViewAlreadyActiveReasonAtom,
	repositoryViewAvailableAtom,
	repositoryViewSubtitleAtom,
	repositoryViewTitleAtom,
	workspaceSurfaceAlreadyActiveReasonAtom,
	workspaceSurfaceSubtitleAtom,
} from "./derivations.js"
import { invokeHandoff } from "./handoffs.js"
import { defineCommand, type CommandDefinition } from "./registry.js"

// Most commands fall into one of three shapes:
//   1. "Open this modal": yield* Atom.set(activeModalAtom, Modal.X(...))
//   2. "Toggle this atom": yield* Atom.update(atom, …)
//   3. "Read selection, do thing with service": Effect.gen reading selection
//      via Atom.get and calling Clipboard.use / BrowserOpener.use / ...
//
// Everything is dispatchable by id and depends only on atoms — no closures
// over component-local state.

const queueModeHandoffKey = (mode: PullRequestUserQueueMode) =>
	mode === "authored" ? ("viewAuthored" as const) : mode === "review" ? ("viewReview" as const) : mode === "assigned" ? ("viewAssigned" as const) : ("viewMentioned" as const)

const queueViewCommands = pullRequestQueueModes.map(
	(mode): CommandDefinition =>
		defineCommand({
			id: `view.${mode}`,
			title: queueViewTitleFor(mode),
			scope: "View",
			subtitle: queueViewSubtitleAtom(mode),
			keywords: [mode, "queue", "view"],
			disabledReason: queueViewAlreadyActiveReasonAtom(mode),
			run: Effect.sync(() => invokeHandoff(queueModeHandoffKey(mode))),
		}),
)

const workspaceSurfaceCommands = workspaceSurfaces.map((surface, index): CommandDefinition => {
	const subtitleAtom = workspaceSurfaceSubtitleAtom(surface)
	const disabledAtom = workspaceSurfaceAlreadyActiveReasonAtom(surface)
	return defineCommand({
		id: `workspace.${surface}`,
		title: `Show ${workspaceSurfaceLabels[surface]}`,
		scope: "View",
		subtitle: subtitleAtom,
		shortcut: `${index + 1}`,
		keywords: [workspaceSurfaceLabels[surface], "workspace", "surface", "tab"],
		disabledReason: disabledAtom,
		run: switchWorkspaceSurfaceEffect(surface),
	})
})

function switchWorkspaceSurfaceEffect(surface: WorkspaceSurface) {
	return Effect.gen(function* () {
		const allowed = yield* Atom.get(workspaceTabSurfacesAtom)
		if (!allowed.includes(surface)) return
		const current = yield* Atom.get(workspaceSurfaceAtom)
		if (current === surface) return
		yield* Atom.set(workspaceSurfaceAtom, surface)
		yield* Atom.set(detailFullViewAtom, false)
		yield* Atom.set(diffFullViewAtom, false)
		yield* Atom.set(commentsViewActiveAtom, false)
		yield* Atom.set(diffCommentRangeStartIndexAtom, null)
		yield* Atom.set(filterModeAtom, false)
		const query = yield* Atom.get(filterQueryAtom)
		yield* Atom.set(filterDraftAtom, query)
		yield* Atom.set(noticeAtom, null)
	})
}

const flashErrorEffect = (error: unknown) =>
	Effect.gen(function* () {
		const message = error instanceof Error ? error.message : String(error)
		yield* Atom.set(noticeAtom, message)
	})

export const globalCommands: readonly CommandDefinition[] = [
	defineCommand({
		id: "command.open",
		title: "Open command palette",
		scope: "Global",
		subtitle: "Search every available route through ghui",
		shortcut: "ctrl-p/cmd-k/?",
		keywords: ["palette", "commands", "deck", "help", "keys", "keyboard", "shortcuts"],
		run: Atom.set(activeModalAtom, Modal.CommandPalette(initialCommandPaletteState)),
	}),
	defineCommand({
		id: "filter.open",
		title: filterTitleAtom,
		scope: "Global",
		subtitle: "Search the visible surface",
		shortcut: "/",
		keywords: ["search"],
		run: Effect.gen(function* () {
			const query = yield* Atom.get(filterQueryAtom)
			yield* Atom.set(filterDraftAtom, query)
			yield* Atom.set(filterModeAtom, true)
		}),
	}),
	defineCommand({
		id: "filter.clear",
		title: "Clear filter",
		scope: "Global",
		subtitle: "Show every item in the current surface",
		shortcut: "esc",
		disabledReason: filterClearDisabledReasonAtom,
		run: Effect.gen(function* () {
			yield* Atom.set(filterQueryAtom, "")
			yield* Atom.set(filterDraftAtom, "")
			yield* Atom.set(filterModeAtom, false)
		}),
	}),

	// === Workspace surface switches ===
	...workspaceSurfaceCommands,

	// === Detail / diff toggles ===
	defineCommand({
		id: "detail.open",
		title: "Open details",
		scope: "View",
		subtitle: selectedItemLabelAtom,
		shortcut: "enter",
		disabledReason: noSelectedItemReasonAtom,
		run: Effect.gen(function* () {
			yield* Atom.set(detailFullViewAtom, true)
			yield* Atom.set(detailScrollOffsetAtom, 0)
		}),
	}),
	defineCommand({
		id: "detail.close",
		title: "Close details view",
		scope: "Pull request",
		subtitle: "Return to the queue",
		shortcut: "esc",
		disabledReason: detailCloseDisabledReasonAtom,
		run: Effect.gen(function* () {
			yield* Atom.set(detailFullViewAtom, false)
			yield* Atom.set(detailScrollOffsetAtom, 0)
		}),
	}),
	// === Diff render-mode toggles ===
	// These three preserve the user's scroll position across the re-render
	// they trigger by calling the "preserveDiffLocation" handoff *synchronously*
	// before the atom write. The diff-location-preservation hook captured
	// the pre-mutation anchor + screenOffset at that moment.
	defineCommand({
		id: "diff.toggle-view",
		title: "Toggle diff split/unified view",
		scope: "Diff",
		subtitle: Atom.make((get) => (get(diffRenderViewAtom) === "split" ? "Switch to unified view" : "Switch to split view")),
		shortcut: "shift-v",
		disabledReason: diffOpenRequiredReasonAtom,
		run: Effect.gen(function* () {
			yield* Effect.sync(() => invokeHandoff("preserveDiffLocation"))
			yield* Atom.update(diffRenderViewAtom, (current) => (current === "split" ? "unified" : "split"))
		}),
	}),
	defineCommand({
		id: "diff.toggle-wrap",
		title: "Toggle diff word wrap",
		scope: "Diff",
		subtitle: Atom.make((get) => (get(diffWrapModeAtom) === "none" ? "Wrap long diff lines" : "Keep diff lines unwrapped")),
		shortcut: "w",
		disabledReason: diffOpenRequiredReasonAtom,
		run: Effect.gen(function* () {
			yield* Effect.sync(() => invokeHandoff("preserveDiffLocation"))
			yield* Atom.update(diffWrapModeAtom, (current) => (current === "none" ? "word" : "none"))
		}),
	}),
	defineCommand({
		id: "diff.toggle-whitespace",
		title: Atom.make((get) => (get(diffWhitespaceModeAtom) === "ignore" ? "Show whitespace changes" : "Ignore whitespace changes")),
		scope: "Diff",
		subtitle: Atom.make((get) => (get(diffWhitespaceModeAtom) === "ignore" ? "Display the original GitHub patch" : "Hide whitespace-only line changes")),
		disabledReason: diffOpenRequiredReasonAtom,
		keywords: ["whitespace", "spacing", "ignore", "show"],
		run: Effect.gen(function* () {
			yield* Effect.sync(() => invokeHandoff("preserveDiffLocation"))
			const current = yield* Atom.get(diffWhitespaceModeAtom)
			const next = current === "ignore" ? "show" : "ignore"
			yield* Atom.set(diffWhitespaceModeAtom, next)
			yield* saveStoredDiffWhitespaceMode(next)
		}),
	}),

	defineCommand({
		id: "diff.close",
		title: "Close diff view",
		scope: "Diff",
		subtitle: "Return to the queue or detail view",
		shortcut: "esc",
		disabledReason: diffCloseDisabledReasonAtom,
		run: Effect.gen(function* () {
			yield* Atom.set(diffFullViewAtom, false)
			yield* Atom.set(diffCommentRangeStartIndexAtom, null)
		}),
	}),
	// === Modal openers (selection-seeded) ===
	defineCommand({
		id: "repository.open",
		title: "Open repository...",
		scope: "View",
		subtitle: repositoryOpenSubtitleAtom,
		keywords: ["repo", "repository", "owner", "github"],
		run: Effect.gen(function* () {
			const repository = yield* Atom.get(selectedRepositoryAtom)
			yield* Atom.set(activeModalAtom, Modal.OpenRepository({ ...initialOpenRepositoryModalState, query: repository ?? "" }))
		}),
	}),
	defineCommand({
		id: "pull.close",
		title: "Close pull request",
		scope: "Pull request",
		subtitle: selectedPullRequestLabelAtom,
		shortcut: "x",
		disabledReason: noOpenPullRequestReasonAtom,
		run: Effect.gen(function* () {
			const pr = yield* Atom.get(selectedPullRequestAtom)
			if (!pr || pr.state !== "open") return
			yield* Atom.set(
				activeModalAtom,
				Modal.Close({
					kind: "pullRequest",
					repository: pr.repository,
					number: pr.number,
					title: pr.title,
					url: pr.url,
					running: false,
					error: null,
				}),
			)
		}),
	}),
	defineCommand({
		id: "issue.close",
		title: "Close issue",
		scope: "Issue",
		subtitle: selectedIssueLabelAtom,
		shortcut: "x",
		keywords: ["close", "resolve"],
		disabledReason: issueSelectedReasonAtom,
		run: Effect.gen(function* () {
			const issue = yield* Atom.get(selectedIssueAtom)
			if (!issue) return
			yield* Atom.set(
				activeModalAtom,
				Modal.Close({
					kind: "issue",
					repository: issue.repository,
					number: issue.number,
					title: issue.title,
					url: issue.url,
					running: false,
					error: null,
				}),
			)
		}),
	}),

	// === Pull request state / review modals ===
	defineCommand({
		id: "pull.toggle-draft",
		title: Atom.make((get) => (get(selectedPullRequestAtom)?.reviewStatus === "draft" ? "Mark ready for review" : "Convert to draft")),
		scope: "Pull request",
		subtitle: selectedPullRequestLabelAtom,
		shortcut: "s",
		disabledReason: noOpenPullRequestReasonAtom,
		keywords: ["state", "ready"],
		run: Effect.gen(function* () {
			const pr = yield* Atom.get(selectedPullRequestAtom)
			if (!pr || pr.state !== "open") return
			const isDraft = pr.reviewStatus === "draft"
			yield* Atom.set(
				activeModalAtom,
				Modal.PullRequestState({
					repository: pr.repository,
					number: pr.number,
					title: pr.title,
					url: pr.url,
					isDraft,
					selectedIsDraft: !isDraft,
					running: false,
					error: null,
				}),
			)
		}),
	}),
	defineCommand({
		id: "pull.submit-review",
		title: "Review pull request",
		scope: "Pull request",
		subtitle: selectedPullRequestLabelAtom,
		shortcut: "shift-r",
		disabledReason: noOpenPullRequestReasonAtom,
		keywords: ["review", "approve", "request changes", "comment"],
		run: Effect.gen(function* () {
			const pr = yield* Atom.get(selectedPullRequestAtom)
			if (!pr || pr.state !== "open") return
			const selectedIndex = Math.max(
				0,
				submitReviewOptions.findIndex((option) => option.event === "APPROVE"),
			)
			yield* Atom.set(
				activeModalAtom,
				Modal.SubmitReview({
					repository: pr.repository,
					number: pr.number,
					focus: "action",
					selectedIndex,
					body: "",
					cursor: 0,
					running: false,
					error: null,
				}),
			)
		}),
	}),
	defineCommand({
		id: "comments.new",
		title: "New comment",
		scope: "Comments",
		subtitle: selectedItemLabelAtom,
		shortcut: "a",
		keywords: ["add", "post", "issue comment"],
		disabledReason: noSelectedItemReasonAtom,
		run: Effect.gen(function* () {
			const subject = yield* Atom.get(selectedCommentSubjectAtom)
			const key = yield* Atom.get(selectedCommentKeyAtom)
			if (!subject || !key) return
			const surface = yield* Atom.get(workspaceSurfaceAtom)
			yield* Atom.set(
				activeModalAtom,
				Modal.Comment({
					...initialCommentModalState,
					target: { kind: "issue", subject: { repository: subject.repository, number: subject.number, key, issueUrl: surface === "issues" ? subject.url : null } },
				}),
			)
		}),
	}),
	defineCommand({
		id: "pull.labels",
		title: "Manage labels",
		scope: "Labels",
		subtitle: selectedItemLabelAtom,
		shortcut: "l",
		disabledReason: noSelectedItemReasonAtom,
		run: Effect.gen(function* () {
			const subject = yield* Atom.get(selectedCommentSubjectAtom)
			if (!subject) return
			const repository = subject.repository
			const surface = yield* Atom.get(workspaceSurfaceAtom)
			const target = { kind: surface === "issues" ? ("issue" as const) : ("pullRequest" as const), repository, number: subject.number, url: subject.url, labels: subject.labels }
			const cache = yield* Atom.get(labelCacheAtom)
			const cached = cache[repository]
			if (cached) {
				yield* Atom.set(activeModalAtom, Modal.Label({ repository, target, query: "", selectedIndex: 0, availableLabels: cached, loading: false }))
				return
			}
			yield* Atom.set(activeModalAtom, Modal.Label({ repository, target, query: "", selectedIndex: 0, availableLabels: [], loading: true }))
			yield* GitHubService.use((github) => github.listRepoLabels(repository)).pipe(
				Effect.flatMap((labels) =>
					Effect.gen(function* () {
						const normalized = labels.map((label) => ({ name: label.name, color: label.color ?? null }))
						yield* Atom.update(labelCacheAtom, (current) => ({ ...current, [repository]: normalized }))
						yield* Atom.update(activeModalAtom, (current) =>
							Modal.$is("Label")(current) && current.repository === repository ? Modal.Label({ ...current, availableLabels: normalized, loading: false }) : current,
						)
					}),
				),
				Effect.catch((error) =>
					Effect.gen(function* () {
						yield* Atom.update(activeModalAtom, (current) =>
							Modal.$is("Label")(current) && current.repository === repository ? Modal.Label({ ...current, loading: false }) : current,
						)
						yield* flashErrorEffect(error)
					}),
				),
			)
		}),
	}),

	// === System / system-service commands ===
	defineCommand({
		id: "pull.open-browser",
		title: "Open pull request in browser",
		scope: "Pull request",
		subtitle: selectedPullRequestLabelAtom,
		shortcut: "o",
		keywords: ["github", "web"],
		disabledReason: noPullRequestReasonAtom,
		run: Effect.gen(function* () {
			const pr = yield* Atom.get(selectedPullRequestAtom)
			if (!pr) return
			yield* BrowserOpener.use((opener) => opener.openPullRequest(pr)).pipe(Effect.catch(flashErrorEffect))
		}),
	}),
	defineCommand({
		id: "pull.copy-metadata",
		title: "Copy pull request metadata",
		scope: "Pull request",
		subtitle: selectedPullRequestLabelAtom,
		shortcut: "y",
		keywords: ["clipboard", "url", "title"],
		disabledReason: noPullRequestReasonAtom,
		run: Effect.gen(function* () {
			const pr = yield* Atom.get(selectedPullRequestAtom)
			if (!pr) return
			const text = `${pr.repository}#${pr.number} ${pr.title}\n${pr.url}`
			yield* Clipboard.use((clipboard) => clipboard.copy(text)).pipe(
				Effect.tap(() => Atom.set(noticeAtom, "Pull request metadata copied")),
				Effect.catch(flashErrorEffect),
			)
		}),
	}),
	defineCommand({
		id: "issue.copy-metadata",
		title: "Copy issue metadata",
		scope: "Comments",
		subtitle: selectedIssueLabelAtom,
		shortcut: "y",
		keywords: ["clipboard", "url", "title"],
		disabledReason: issueSelectedReasonAtom,
		run: Effect.gen(function* () {
			const issue = yield* Atom.get(selectedIssueAtom)
			if (!issue) return
			const text = `${issue.repository}#${issue.number} ${issue.title}\n${issue.url}`
			yield* Clipboard.use((clipboard) => clipboard.copy(text)).pipe(
				Effect.tap(() => Atom.set(noticeAtom, "Issue metadata copied")),
				Effect.catch(flashErrorEffect),
			)
		}),
	}),
	defineCommand({
		id: "issue.open-browser",
		title: "Open issue in browser",
		scope: "Issue",
		subtitle: selectedIssueLabelAtom,
		shortcut: "o",
		keywords: ["github", "web"],
		disabledReason: issueSelectedReasonAtom,
		run: Effect.gen(function* () {
			const issue = yield* Atom.get(selectedIssueAtom)
			if (!issue) return
			yield* BrowserOpener.use((opener) => opener.openUrl(issue.url)).pipe(Effect.catch(flashErrorEffect))
		}),
	}),

	// === Pull-request lifecycle (hook-bound via handoff) ===
	defineCommand({
		id: "pull.refresh",
		title: pullRequestRefreshTitleAtom,
		scope: "Global",
		subtitle: "Fetch the latest queue from GitHub",
		shortcut: "r",
		disabledReason: pullRequestSurfaceReasonAtom,
		keywords: ["reload", "sync"],
		run: Effect.sync(() => invokeHandoff("refreshPullRequests")),
	}),
	defineCommand({
		id: "issue.refresh",
		title: "Refresh issues",
		scope: "Global",
		subtitle: "Fetch the latest issue queue from GitHub",
		shortcut: "r",
		keywords: ["reload", "sync"],
		run: Effect.sync(() => invokeHandoff("refreshIssues")),
	}),
	defineCommand({
		id: "pull.load-more",
		title: "Load more pull requests",
		scope: "Navigation",
		subtitle: loadMoreSubtitleAtom,
		disabledReason: loadMoreDisabledReasonAtom,
		keywords: ["next page", "pagination", "more"],
		run: Effect.sync(() => invokeHandoff("loadMorePullRequests")),
	}),
	defineCommand({
		id: "pull.merge",
		title: "Merge pull request",
		scope: "Pull request",
		subtitle: selectedPullRequestLabelAtom,
		shortcut: "m",
		disabledReason: noPullRequestReasonAtom,
		keywords: ["auto merge", "squash"],
		run: Effect.sync(() => invokeHandoff("openMergeModal")),
	}),

	// === Theme / repository pickers ===
	defineCommand({
		id: "theme.open",
		title: "Choose theme",
		scope: "Global",
		subtitle: "Preview and persist a terminal color theme",
		shortcut: "t",
		keywords: ["colors", "appearance"],
		run: Effect.sync(() => invokeHandoff("openThemeModal")),
	}),

	// === Comments / diff entry points (hook-bound) ===
	defineCommand({
		id: "comments.open",
		title: "Open comments",
		scope: "Comments",
		subtitle: selectedItemLabelAtom,
		shortcut: "c",
		keywords: ["conversation", "discussion", "review"],
		disabledReason: noSelectedItemReasonAtom,
		run: Effect.sync(() => invokeHandoff("openCommentsView")),
	}),
	defineCommand({
		id: "diff.open",
		title: "Open diff",
		scope: "Diff",
		subtitle: selectedPullRequestLabelAtom,
		shortcut: "d",
		disabledReason: noPullRequestReasonAtom,
		keywords: ["files", "patch"],
		run: Effect.sync(() => invokeHandoff("openDiffView")),
	}),

	// === View switches ===
	defineCommand({
		id: "view.repository",
		title: repositoryViewTitleAtom,
		scope: "View",
		subtitle: repositoryViewSubtitleAtom,
		keywords: ["repository", "queue", "view"],
		when: repositoryViewAvailableAtom,
		disabledReason: repositoryViewAlreadyActiveReasonAtom,
		run: Effect.sync(() => invokeHandoff("viewRepository")),
	}),
	...queueViewCommands,

	// === Diff cluster ===
	defineCommand({
		id: "diff.reload",
		title: "Reload diff",
		scope: "Diff",
		subtitle: selectedPullRequestLabelAtom,
		shortcut: "r",
		disabledReason: diffReloadDisabledReasonAtom,
		keywords: ["refresh", "comments"],
		run: Effect.sync(() => invokeHandoff("reloadDiff")),
	}),
	defineCommand({
		id: "diff.changed-files",
		title: "Open changed files navigator",
		scope: "Diff",
		subtitle: changedFilesSubtitleAtom,
		shortcut: "f",
		disabledReason: changedFilesReasonAtom,
		keywords: ["files", "navigator", "search"],
		run: Effect.sync(() => invokeHandoff("openChangedFilesModal")),
	}),
	defineCommand({
		id: "diff.toggle-file-panel",
		title: "Toggle file panel",
		scope: "Diff",
		shortcut: "shift+f",
		keywords: ["files", "panel", "sidebar", "toggle"],
		run: Effect.sync(() => invokeHandoff("toggleDiffFilePanel")),
	}),
	defineCommand({
		id: "diff.next-file",
		title: "Next diff file",
		scope: "Diff",
		subtitle: diffFileSubtitleAtom,
		shortcut: "]",
		disabledReason: changedFilesReasonAtom,
		run: Effect.sync(() => invokeHandoff("jumpDiffFileNext")),
	}),
	defineCommand({
		id: "diff.previous-file",
		title: "Previous diff file",
		scope: "Diff",
		subtitle: diffFileSubtitleAtom,
		shortcut: "[",
		disabledReason: changedFilesReasonAtom,
		run: Effect.sync(() => invokeHandoff("jumpDiffFilePrevious")),
	}),
	defineCommand({
		id: "diff.open-comment-target",
		title: diffOpenCommentTargetTitleAtom,
		scope: "Diff",
		subtitle: diffCommentAnchorSubtitleAtom,
		shortcut: "enter",
		disabledReason: selectedDiffLineReasonAtom,
		keywords: ["review", "comment", "thread", "line"],
		run: Effect.sync(() => invokeHandoff("openSelectedDiffComment")),
	}),
	defineCommand({
		id: "diff.toggle-range",
		title: diffToggleRangeTitleAtom,
		scope: "Diff",
		subtitle: diffCommentAnchorSubtitleAtom,
		shortcut: "v",
		disabledReason: selectedDiffLineReasonAtom,
		keywords: ["review", "comment", "range", "visual"],
		run: Effect.sync(() => invokeHandoff("toggleDiffCommentRange")),
	}),
	defineCommand({
		id: "diff.next-thread",
		title: "Next diff thread",
		scope: "Diff",
		subtitle: diffThreadSubtitleAtom,
		shortcut: "n",
		disabledReason: diffThreadReasonAtom,
		keywords: ["review", "comment", "thread"],
		run: Effect.sync(() => invokeHandoff("moveDiffCommentThreadNext")),
	}),
	defineCommand({
		id: "diff.previous-thread",
		title: "Previous diff thread",
		scope: "Diff",
		subtitle: diffThreadSubtitleAtom,
		shortcut: "p",
		disabledReason: diffThreadReasonAtom,
		keywords: ["review", "comment", "thread"],
		run: Effect.sync(() => invokeHandoff("moveDiffCommentThreadPrevious")),
	}),
	defineCommand({
		id: "diff.add-comment",
		title: "Add comment on selected diff line",
		scope: "Diff",
		subtitle: diffCommentAnchorSubtitleAtom,
		disabledReason: selectedDiffLineReasonAtom,
		keywords: ["review", "reply"],
		run: Effect.sync(() => invokeHandoff("openDiffCommentModal")),
	}),

	// === Comment mutations ===
	defineCommand({
		id: "comments.reply",
		title: "Reply to comment",
		scope: "Comments",
		subtitle: selectedItemLabelAtom,
		shortcut: "shift-r",
		disabledReason: selectedCommentReasonAtom,
		keywords: ["respond", "thread"],
		run: Effect.sync(() => invokeHandoff("openReplyToSelectedComment")),
	}),
	defineCommand({
		id: "comments.edit",
		title: "Edit comment",
		scope: "Comments",
		subtitle: selectedItemLabelAtom,
		shortcut: "e",
		disabledReason: ownCommentReasonAtom,
		keywords: ["update", "modify", "rewrite"],
		run: Effect.sync(() => invokeHandoff("openEditSelectedComment")),
	}),
	defineCommand({
		id: "comments.delete",
		title: "Delete comment",
		scope: "Comments",
		subtitle: selectedItemLabelAtom,
		shortcut: "x",
		disabledReason: ownCommentReasonAtom,
		keywords: ["remove", "destroy"],
		run: Effect.sync(() => invokeHandoff("openDeleteSelectedComment")),
	}),

	defineCommand({
		id: "app.quit",
		title: "Quit ghui",
		scope: "System",
		subtitle: "Leave the terminal UI",
		shortcut: "q",
		keywords: ["exit"],
		run: Effect.sync(() => invokeHandoff("quit")),
	}),
]
