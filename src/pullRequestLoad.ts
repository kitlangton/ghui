import type { PullRequestItem } from "./domain.js"
import type { ItemLoad } from "./item/load.js"
import type { PullRequestView } from "./pullRequestViews.js"

export type PullRequestLoad = ItemLoad<PullRequestView, PullRequestItem>
