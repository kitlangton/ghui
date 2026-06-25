import type { IssueItem } from "./domain.js"
import type { ItemLoad } from "./item/load.js"
import type { IssueView } from "./issueViews.js"

export type IssueLoad = ItemLoad<IssueView, IssueItem>
