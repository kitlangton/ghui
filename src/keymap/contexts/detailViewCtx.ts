import type { WorkspaceSurface } from "../../workspaceSurfaces.ts"
import type { DetailViewCtx } from "../detailView.ts"

export interface BuildDetailViewCtxInput {
	readonly halfPage: number
	readonly activeSurface: WorkspaceSurface
	readonly scrollDetailFullViewBy: (delta: number) => void
	readonly scrollDetailFullViewTo: (y: number) => void
	readonly runCommandById: (id: string) => void
}

export const buildDetailViewCtx = ({ halfPage, activeSurface, scrollDetailFullViewBy, scrollDetailFullViewTo, runCommandById }: BuildDetailViewCtxInput): DetailViewCtx => ({
	halfPage,
	scrollBy: scrollDetailFullViewBy,
	scrollTo: scrollDetailFullViewTo,
	closeDetail: () => runCommandById("detail.close"),
	openTheme: () => runCommandById("theme.open"),
	openDiff: () => runCommandById("diff.open"),
	openComments: () => runCommandById("comments.open"),
	closeSelectedItem: () => runCommandById(activeSurface === "issues" ? "issue.close" : "pull.close"),
	openLabels: () => runCommandById("pull.labels"),
	openMerge: () => runCommandById("pull.merge"),
	toggleDraft: () => runCommandById("pull.toggle-draft"),
	openReview: () => runCommandById("pull.submit-review"),
	refresh: () => runCommandById(activeSurface === "issues" ? "issue.refresh" : "pull.refresh"),
	openInBrowser: () => runCommandById(activeSurface === "issues" ? "issue.open-browser" : "pull.open-browser"),
	copyMetadata: () => runCommandById(activeSurface === "issues" ? "issue.copy-metadata" : "pull.copy-metadata"),
})
