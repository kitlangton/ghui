import type { CheckConclusion, PullRequestItem, PullRequestLabel, ReviewStatus } from "../domain.js"
import { colors } from "./colors.js"

export const shortRepoName = (repository: string) => repository.split("/")[1] ?? repository

export const repoColor = (repository: string) => colors.repos[shortRepoName(repository) as keyof typeof colors.repos] ?? colors.repos.default

const REVIEW_LABEL: Partial<Record<ReviewStatus, string>> = {
	draft: "draft",
	approved: "approved",
	changes: "changes",
	review: "review",
}

export const reviewLabel = (pullRequest: PullRequestItem) => REVIEW_LABEL[pullRequest.reviewStatus] ?? null

export const checkLabel = (pullRequest: PullRequestItem) => pullRequest.checkSummary

const passingCheckConclusions = new Set<CheckConclusion>(["success", "neutral", "skipped"])

export const failingCheckNames = (pullRequest: PullRequestItem) =>
	pullRequest.checks.flatMap((check) => (check.conclusion && !passingCheckConclusions.has(check.conclusion) ? [check.name] : []))

export const pullRequestMetadataText = (pullRequest: PullRequestItem) => {
	const lines = [pullRequest.title, `${pullRequest.repository} #${pullRequest.number}`, pullRequest.url]
	if (pullRequest.headRefName) lines.push(`branch: ${pullRequest.headRefName}`)
	const review = reviewLabel(pullRequest)
	if (review) lines.push(`review: ${review}`)
	if (pullRequest.checkSummary) lines.push(pullRequest.checkSummary)
	const failed = failingCheckNames(pullRequest)
	if (failed.length > 0) lines.push(`failing checks: ${failed.join(", ")}`)
	return lines.join("\n")
}

export const statusColor = (status: PullRequestItem["reviewStatus"] | PullRequestItem["checkStatus"]) => colors.status[status]

const REVIEW_ICON: Record<ReviewStatus, string> = {
	draft: "◌",
	approved: "✓",
	changes: "!",
	review: "◐",
	none: "·",
}

export const reviewIcon = (pullRequest: PullRequestItem) => {
	if (pullRequest.state === "merged") return "✓"
	if (pullRequest.state === "closed") return "×"
	if (pullRequest.autoMergeEnabled) return "↻"
	return REVIEW_ICON[pullRequest.reviewStatus]
}

export interface PullRequestRowDisplay {
	readonly indicatorFg: string
	readonly rowFg: string
	readonly numberFg: string
	readonly checkFg: string
	readonly checkText: string
}

export const pullRequestRowDisplay = (pullRequest: PullRequestItem, selected: boolean): PullRequestRowDisplay => {
	const isMerged = pullRequest.state === "merged"
	const isClosed = pullRequest.state === "closed"
	const isFinal = isMerged || isClosed
	const indicatorFg = isMerged ? colors.status.passing : isClosed ? colors.muted : pullRequest.autoMergeEnabled ? colors.accent : statusColor(pullRequest.reviewStatus)
	const checkFg = isMerged ? colors.status.passing : isClosed ? colors.muted : statusColor(pullRequest.checkStatus)
	const checkText = isMerged ? "merged" : isClosed ? "closed" : (pullRequest.checkSummary?.replace(/^checks\s+/, "") ?? "")
	return {
		indicatorFg,
		rowFg: selected ? colors.selectedText : isFinal ? colors.muted : colors.text,
		numberFg: selected ? colors.accent : isFinal ? colors.muted : colors.count,
		checkFg,
		checkText,
	}
}

const fallbackLabelColor = (name: string) => {
	let hash = 0
	for (const char of name) {
		hash = (hash * 31 + char.charCodeAt(0)) >>> 0
	}
	const hue = hash % 360
	return `hsl(${hue} 55% 35%)`
}

export const labelColor = (label: PullRequestLabel) => label.color ?? fallbackLabelColor(label.name)

export const labelTextColor = (color: string) => {
	if (color.startsWith("#") && color.length === 7) {
		const red = Number.parseInt(color.slice(1, 3), 16)
		const green = Number.parseInt(color.slice(3, 5), 16)
		const blue = Number.parseInt(color.slice(5, 7), 16)
		const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
		return luminance > 0.6 ? "#111111" : "#f8fafc"
	}
	return "#f8fafc"
}

export const groupBy = <T>(items: readonly T[], getKey: (item: T) => string, orderedKeys: readonly string[] = []) => {
	const groups = new Map<string, T[]>()
	for (const item of items) {
		const key = getKey(item)
		const existing = groups.get(key)
		if (existing) {
			existing.push(item)
		} else {
			groups.set(key, [item])
		}
	}

	const order = new Map(orderedKeys.map((key, index) => [key, index]))
	return [...groups.entries()].sort((left, right) => {
		const leftIndex = order.get(left[0])
		const rightIndex = order.get(right[0])
		if (leftIndex !== undefined && rightIndex !== undefined) return leftIndex - rightIndex
		if (leftIndex !== undefined) return -1
		if (rightIndex !== undefined) return 1
		return left[0].localeCompare(right[0])
	})
}
