import type { IssueItem, PullRequestItem } from "../../domain.js"
import type { RepositoryListItem } from "../RepoList.js"

// Lower scores rank earlier in the result list. `null` means the item didn't
// match at all and should be filtered out. The score blends a field-priority
// component (index * 1000) with the in-field match offset (lower = earlier
// match), so an earlier match in a higher-priority field always wins.

export const repositoryFilterScore = (repository: RepositoryListItem, query: string): number | null => {
	const normalized = query.trim().toLowerCase()
	if (normalized.length === 0) return 0
	const fields = [
		repository.repository.toLowerCase(),
		repository.description?.toLowerCase() ?? "",
		repository.current ? "current" : "",
		repository.favorite ? "favorite" : "",
		repository.recent ? "recent" : "",
	]
	const scores = fields.flatMap((field, index) => {
		const matchIndex = field.indexOf(normalized)
		return matchIndex >= 0 ? [index * 1000 + matchIndex] : []
	})
	return scores.length > 0 ? Math.min(...scores) : null
}

export const issueFilterScore = (issue: IssueItem, query: string): number | null => {
	const normalized = query.trim().toLowerCase()
	if (normalized.length === 0) return 0
	const fields = [
		issue.title.toLowerCase(),
		issue.repository.toLowerCase(),
		String(issue.number),
		issue.author.toLowerCase(),
		issue.labels
			.map((label) => label.name)
			.join(" ")
			.toLowerCase(),
		issue.body.toLowerCase(),
	]
	const scores = fields.flatMap((field, index) => {
		const matchIndex = field.indexOf(normalized)
		return matchIndex >= 0 ? [index * 1000 + matchIndex] : []
	})
	return scores.length > 0 ? Math.min(...scores) : null
}

export const pullRequestFilterScore = (pullRequest: PullRequestItem, query: string): number | null => {
	const normalized = query.trim().toLowerCase()
	if (normalized.length === 0) return 0
	const fields = [pullRequest.title, pullRequest.repository, pullRequest.author, pullRequest.headRefName, String(pullRequest.number)]
	const scores = fields.flatMap((field, index) => {
		const matchIndex = field.toLowerCase().indexOf(normalized)
		return matchIndex >= 0 ? [index * 1000 + matchIndex] : []
	})
	return scores.length > 0 ? Math.min(...scores) : null
}

export const filterByScore = <Item>(
	items: readonly Item[],
	query: string,
	scoreItem: (item: Item, query: string) => number | null,
	getTime: (item: Item) => number,
): readonly Item[] => {
	const normalized = query.trim().toLowerCase()
	if (normalized.length === 0) return items
	return items
		.flatMap((item) => {
			const score = scoreItem(item, normalized)
			return score === null ? [] : [{ item, score }]
		})
		.sort((left, right) => left.score - right.score || getTime(right.item) - getTime(left.item))
		.map(({ item }) => item)
}
