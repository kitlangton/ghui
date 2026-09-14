import type { RunConclusion, RunStatus, WorkflowRun, WorkflowRunDetails } from "../domain.js"

// Deterministic workflow-run fixtures for mock mode, keyed off a PR's head SHA so
// the runs view is fully demoable without GitHub. Produces a realistic spread:
// a failing CI run, a passing lint run, and an in-progress release run.

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000)

interface StepSpec {
	readonly name: string
	readonly status: RunStatus
	readonly conclusion: RunConclusion
	readonly durationSeconds: number
}

interface RunSpec {
	readonly workflowName: string
	readonly status: RunStatus
	readonly conclusion: RunConclusion
	readonly event: string
	readonly createdMinutesAgo: number
	readonly durationSeconds: number
	readonly jobs: readonly { readonly name: string; readonly status: RunStatus; readonly conclusion: RunConclusion; readonly steps: readonly StepSpec[] }[]
}

const runSpecs: readonly RunSpec[] = [
	{
		workflowName: "CI",
		status: "completed",
		conclusion: "failure",
		event: "pull_request",
		createdMinutesAgo: 6,
		durationSeconds: 134,
		jobs: [
			{
				name: "lint",
				status: "completed",
				conclusion: "success",
				steps: [
					{ name: "Set up job", status: "completed", conclusion: "success", durationSeconds: 1 },
					{ name: "Checkout", status: "completed", conclusion: "success", durationSeconds: 3 },
					{ name: "bun run lint", status: "completed", conclusion: "success", durationSeconds: 8 },
				],
			},
			{
				name: "test (bun)",
				status: "completed",
				conclusion: "failure",
				steps: [
					{ name: "Set up job", status: "completed", conclusion: "success", durationSeconds: 1 },
					{ name: "Checkout", status: "completed", conclusion: "success", durationSeconds: 3 },
					{ name: "bun install", status: "completed", conclusion: "success", durationSeconds: 22 },
					{ name: "bun run test", status: "completed", conclusion: "failure", durationSeconds: 72 },
					{ name: "Upload coverage", status: "completed", conclusion: "skipped", durationSeconds: 0 },
				],
			},
		],
	},
	{
		workflowName: "Lint",
		status: "completed",
		conclusion: "success",
		event: "pull_request",
		createdMinutesAgo: 6,
		durationSeconds: 48,
		jobs: [
			{
				name: "oxlint",
				status: "completed",
				conclusion: "success",
				steps: [
					{ name: "Set up job", status: "completed", conclusion: "success", durationSeconds: 1 },
					{ name: "Checkout", status: "completed", conclusion: "success", durationSeconds: 3 },
					{ name: "bun run lint", status: "completed", conclusion: "success", durationSeconds: 41 },
				],
			},
		],
	},
	{
		workflowName: "Release",
		status: "in_progress",
		conclusion: null,
		event: "push",
		createdMinutesAgo: 1,
		durationSeconds: 62,
		jobs: [
			{
				name: "build",
				status: "in_progress",
				conclusion: null,
				steps: [
					{ name: "Set up job", status: "completed", conclusion: "success", durationSeconds: 1 },
					{ name: "Checkout", status: "completed", conclusion: "success", durationSeconds: 3 },
					{ name: "Build standalone", status: "in_progress", conclusion: null, durationSeconds: 0 },
					{ name: "Publish", status: "queued", conclusion: null, durationSeconds: 0 },
				],
			},
		],
	},
]

const runId = (headSha: string, index: number): number => {
	let hash = 0
	for (const char of headSha) hash = (hash * 31 + char.charCodeAt(0)) % 1_000_000
	return 1_000_000 + hash * 10 + index
}

const buildRun = (repository: string, headSha: string, spec: RunSpec, index: number): WorkflowRunDetails => {
	const id = runId(headSha, index)
	const created = minutesAgo(spec.createdMinutesAgo)
	const started = created
	const updated = spec.status === "completed" ? new Date(started.getTime() + spec.durationSeconds * 1000) : null
	let cursor = started.getTime()
	const jobs = spec.jobs.map((job, jobIndex) => {
		const jobStart = new Date(cursor)
		const steps = job.steps
			.map((step) => {
				const stepStart = new Date(cursor)
				const completed = step.status === "completed" ? new Date(cursor + step.durationSeconds * 1000) : null
				if (completed) cursor = completed.getTime()
				return {
					number: 0,
					name: step.name,
					status: step.status,
					conclusion: step.conclusion,
					startedAt: step.status === "queued" ? null : stepStart,
					completedAt: completed,
				}
			})
			.map((step, stepIndex) => ({ ...step, number: stepIndex + 1 }))
		const jobCompleted = job.status === "completed" ? new Date(cursor) : null
		return {
			id: id * 100 + jobIndex,
			name: job.name,
			status: job.status,
			conclusion: job.conclusion,
			startedAt: jobStart,
			completedAt: jobCompleted,
			url: `https://github.com/${repository}/actions/runs/${id}/job/${id * 100 + jobIndex}`,
			steps,
		}
	})
	return {
		id,
		number: 40 - index,
		attempt: 1,
		workflowName: spec.workflowName,
		displayTitle: "feat(diff): viewport windowing",
		event: spec.event,
		headBranch: "feat/diff-windowing",
		headSha,
		status: spec.status,
		conclusion: spec.conclusion,
		url: `https://github.com/${repository}/actions/runs/${id}`,
		createdAt: created,
		startedAt: started,
		updatedAt: updated,
		jobs,
	}
}

const cache = new Map<string, readonly WorkflowRunDetails[]>()

const runsForCommit = (repository: string, headSha: string): readonly WorkflowRunDetails[] => {
	const key = `${repository}@${headSha}`
	const existing = cache.get(key)
	if (existing) return existing
	const built = runSpecs.map((spec, index) => buildRun(repository, headSha, spec, index))
	cache.set(key, built)
	return built
}

export const mockWorkflowRuns = (repository: string, headSha: string): readonly WorkflowRun[] => runsForCommit(repository, headSha).map(({ jobs: _jobs, ...run }) => run)

export const mockWorkflowRunDetails = (repository: string, headSha: string, runIdValue: number): WorkflowRunDetails | null =>
	runsForCommit(repository, headSha).find((run) => run.id === runIdValue) ?? null

const formatSeconds = (step: { startedAt: Date | null; completedAt: Date | null }) =>
	step.startedAt && step.completedAt ? `${Math.round((step.completedAt.getTime() - step.startedAt.getTime()) / 1000)}s` : "?"

// Raw `gh run view --job <id> --log` text for a job built above: `job\tstep\t<ISO> <line>`.
export const mockJobLog = (jobId: number): string => {
	for (const runs of cache.values()) {
		for (const run of runs) {
			const job = run.jobs.find((candidate) => candidate.id === jobId)
			if (!job) continue
			const stamp = (date: Date | null) => (date ?? new Date()).toISOString()
			return job.steps
				.flatMap((step) => {
					const prefix = `${job.name}\t${step.name}\t${stamp(step.startedAt)} `
					const body = [`##[group]Run ${step.name}`, `+ ${step.name.toLowerCase().replace(/\s+/g, "-")}`, "##[endgroup]", `done in ${formatSeconds(step)}`]
					if (step.conclusion === "failure") body.push("##[error]Process completed with exit code 1.")
					return body.map((line) => prefix + line)
				})
				.join("\n")
		}
	}
	return ""
}
