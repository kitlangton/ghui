import type { IssueItem } from "./domain.js"
import type { ItemPage } from "./item.js"
import { freshItemLoad, nextItemLoadAfterPage } from "./item/load.js"
import type { IssueLoad } from "./issueLoad.js"
import type { IssueView } from "./issueViews.js"

export const freshIssueLoad = (view: IssueView, page: ItemPage<IssueItem>, itemLimit: number, fetchedAt: Date = new Date()): IssueLoad =>
	freshItemLoad(view, page, (items) => items, itemLimit, fetchedAt)

export const nextIssueLoadAfterPage = (current: IssueLoad, page: ItemPage<IssueItem>, prFetchLimit: number, fetchedAt: Date = new Date()): IssueLoad => {
	return nextItemLoadAfterPage(
		current,
		page,
		prFetchLimit,
		(issue) => issue.url,
		(items) => items,
		fetchedAt,
	)
}
