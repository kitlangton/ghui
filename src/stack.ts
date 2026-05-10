import type { PullRequestItem } from "./domain.js"

export interface StackNode {
	readonly pullRequest: PullRequestItem
	readonly children: readonly StackNode[]
	readonly depth: number
}

export interface StackForest {
	readonly repository: string
	readonly roots: readonly StackNode[]
	readonly orphanCount: number
}

interface MutableStackNode {
	readonly pullRequest: PullRequestItem
	readonly children: MutableStackNode[]
	depth: number
}

const setDepth = (node: MutableStackNode, depth: number): void => {
	node.depth = depth
	for (const child of node.children) setDepth(child, depth + 1)
}

const sortByNumber = (left: PullRequestItem, right: PullRequestItem) => left.number - right.number

const buildRepoForest = (repository: string, pullRequests: readonly PullRequestItem[]): StackForest => {
	const sorted = [...pullRequests].sort(sortByNumber)
	const byHead = new Map<string, MutableStackNode>()
	const nodes = sorted.map((pr): MutableStackNode => ({ pullRequest: pr, children: [], depth: 0 }))
	for (const node of nodes) {
		const head = node.pullRequest.headRefName
		if (head) byHead.set(head, node)
	}
	const roots: MutableStackNode[] = []
	for (const node of nodes) {
		const base = node.pullRequest.baseRefName
		const parent = base ? byHead.get(base) : undefined
		if (parent && parent !== node) parent.children.push(node)
		else roots.push(node)
	}
	for (const root of roots) setDepth(root, 0)
	return { repository, roots, orphanCount: roots.length }
}

export const buildStackForests = (pullRequests: readonly PullRequestItem[]): readonly StackForest[] => {
	const byRepo = new Map<string, PullRequestItem[]>()
	for (const pr of pullRequests) {
		const list = byRepo.get(pr.repository)
		if (list) list.push(pr)
		else byRepo.set(pr.repository, [pr])
	}
	const repos = [...byRepo.keys()].sort((a, b) => a.localeCompare(b))
	return repos.map((repository) => buildRepoForest(repository, byRepo.get(repository) ?? []))
}

export const flattenStackForest = (forest: StackForest): readonly StackNode[] => {
	const result: StackNode[] = []
	const walk = (node: StackNode) => {
		result.push(node)
		for (const child of node.children) walk(child)
	}
	for (const root of forest.roots) walk(root)
	return result
}

export const isStacked = (forest: StackForest): boolean => forest.roots.some((root) => root.children.length > 0)

export const stackParentBranch = (pullRequests: readonly PullRequestItem[], pullRequest: PullRequestItem): PullRequestItem | null => {
	const base = pullRequest.baseRefName
	if (!base) return null
	for (const candidate of pullRequests) {
		if (candidate === pullRequest) continue
		if (candidate.repository !== pullRequest.repository) continue
		if (candidate.headRefName === base) return candidate
	}
	return null
}
