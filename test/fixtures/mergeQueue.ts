import { Effect, Layer, Schema } from "effect"
import type { PullRequestItem } from "../../src/domain.ts"
import { CommandError, CommandRunner } from "../../src/services/CommandRunner.ts"

export const mergeQueuePullRequest: PullRequestItem = {
	repository: "example/queue-demo",
	number: 42,
	title: "Fix release validation",
	body: "Deterministic merge queue fixture. GitHub is simulated.",
	author: "demo-user",
	headRefOid: "fixture-head",
	headRefName: "fix/release-validation",
	baseRefName: "main",
	defaultBranchName: "main",
	labels: [],
	additions: 2,
	deletions: 1,
	changedFiles: 1,
	state: "open",
	reviewStatus: "approved",
	checkStatus: "passing",
	checkSummary: "checks 1/1",
	checks: [{ name: "ci", status: "completed", conclusion: "success" }],
	autoMergeEnabled: false,
	detailLoaded: true,
	createdAt: new Date("2026-08-21T12:00:00Z"),
	updatedAt: new Date("2026-08-21T12:00:00Z"),
	closedAt: null,
	url: "https://github.com/example/queue-demo/pull/42",
}

export interface MergeQueueFixtureOptions {
	readonly queueEnabled: boolean
	readonly isDraft?: boolean
	readonly pendingChecks?: boolean
	readonly lookupFailure?: boolean
	readonly mergeResult?: Effect.Effect<void, CommandError>
}

export const mergeQueueCommandLayer = (options: MergeQueueFixtureOptions, calls: string[][]) =>
	Layer.succeed(
		CommandRunner,
		CommandRunner.of({
			run: (command, args) => {
				calls.push([command, ...args])
				if (command !== "gh") return Effect.die(`Unexpected fixture command: ${command}`)
				if (args[0] === "pr" && args[1] === "ready") return Effect.succeed({ stdout: "", stderr: "", exitCode: 0 })
				if (args[0] !== "pr" || args[1] !== "merge") return Effect.die(`Unexpected fixture mutation: ${args.join(" ")}`)
				if (options.queueEnabled && args.includes("--delete-branch")) {
					return Effect.fail(
						new CommandError({
							command,
							args: [...args],
							detail: "Cannot use `-d` or `--delete-branch` when merge queue enabled",
							cause: "gh 2.96.0 merge-queue preflight fixture",
						}),
					)
				}
				return (options.mergeResult ?? Effect.void).pipe(Effect.as({ stdout: "", stderr: "", exitCode: 0 }))
			},
			runSchema: (schema, command, args) => {
				calls.push([command, ...args])
				if (options.lookupFailure && args[0] === "api" && args[1] === "graphql") {
					return Effect.fail(new CommandError({ command, args: [...args], detail: "Fixture queue lookup denied", cause: "fixture" }))
				}
				const response =
					args[0] === "pr" && args[1] === "view"
						? {
								number: 42,
								title: mergeQueuePullRequest.title,
								state: "OPEN",
								isDraft: options.isDraft ?? false,
								mergeable: "MERGEABLE",
								reviewDecision: "APPROVED",
								autoMergeRequest: null,
								statusCheckRollup: [
									{ __typename: "CheckRun", name: "ci", status: options.pendingChecks ? "IN_PROGRESS" : "COMPLETED", conclusion: options.pendingChecks ? null : "SUCCESS" },
								],
							}
						: args[0] === "repo" && args[1] === "view"
							? { squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: true }
							: args[0] === "api" && args[1] === "graphql"
								? { data: { repository: { pullRequest: { viewerCanMergeAsAdmin: true, mergeQueue: options.queueEnabled ? { id: "fixture-queue" } : null } } } }
								: args[0] === "api" && args[1] === "user"
									? { login: "demo-user" }
									: undefined
				if (response === undefined) return Effect.die(`Unexpected fixture query: ${args.join(" ")}`)
				return Schema.decodeUnknownEffect(schema)(response)
			},
		}),
	)
