# Actions View

- **Why**
  - ghui already shows check rollups, but there is no way to inspect workflow runs, job status, or logs without leaving the TUI.
  - PR review flow needs quick insight into failing checks and in-progress pipelines.

- **What we'd ship**
  - A full-screen Actions view opened from PR detail with `a`.
  - Workflow run list for the PR head SHA.
  - Drill-down to workflow jobs, with an ASCII dependency overview derived from workflow YAML `needs`.
  - Drill-down to job logs (scrollable, job-level logs).
  - Live refresh while any run is still queued/in-progress.

- **API / architecture mapping**
  - `src/services/GitHubService.ts`
    - Extend check GraphQL fragment with `databaseId`, `detailsUrl`, workflow run metadata.
    - Add Actions REST calls:
      - `listWorkflowRunsForPullRequest(repository, headSha)`
      - `getWorkflowRunJobs(repository, runId)`
      - `getWorkflowJobLog(repository, jobId)`
      - `getWorkflowRunDependencies(repository, runId, headSha)`
  - `src/domain.ts`
    - Add `WorkflowRun`, `WorkflowJob`, `WorkflowStep`, `WorkflowJobDependency`.
    - Extend `CheckItem` with optional workflow linkage metadata.
  - `src/App.tsx`
    - Add actions-view atoms/state and navigation stack (`runs` -> `jobs` -> `logs`).
    - Add live-refresh polling interval for in-flight runs.
  - `src/ui/ActionsPane.tsx`
    - New full-screen actions UI.
  - `src/ui/workflowGraph.ts`
    - Render ASCII dependency rows from parsed workflow dependencies.
  - `src/keymap/actionsView.ts`
    - Key bindings for navigation, open, refresh, back.

- **Open questions**
  - Should we support per-step log filtering (failed-only) in v2?
  - Should we open selected job URL directly (if available) instead of run/PR URL fallback?

- **Out of scope (for v1)**
  - Re-run/cancel workflow actions.
  - Step-level log folding UI.
  - True graph-layout engine beyond the compact ASCII dependency rows.

- **Status**
  - In progress.
