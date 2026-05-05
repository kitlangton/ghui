import type { WorkflowJob, WorkflowJobDependency } from "../domain.js"
import { colors } from "./colors.js"

const PASSING = new Set(["success", "neutral"])

export interface WorkflowGraphSegment {
	readonly text: string
	readonly fg: string
}

export interface WorkflowGraphRow {
	readonly segments: readonly WorkflowGraphSegment[]
}

// --- child (sub-job inside a box) ---
interface GraphChild {
	readonly name: string
	readonly icon: string
	readonly color: string
}

// --- node (plain or box) ---
interface GraphNode {
	readonly id: string
	readonly name: string
	readonly needs: readonly string[]
	readonly icon: string
	readonly color: string
	readonly children: readonly GraphChild[]
	column: number
	/** absolute y position in the grid */
	yStart: number
	/** rows this node occupies: 1 for plain, children.length + 2 for box */
	height: number
}

interface GraphEdge {
	readonly source: GraphNode
	readonly target: GraphNode
}

// ── helpers ──

const normalize = (value: string) => value.trim().toLowerCase()

const statusIcon = (job: WorkflowJob) => {
	if (job.status === "completed") {
		if (job.conclusion === "skipped" || job.conclusion === "cancelled") return "○"
		if (job.conclusion && PASSING.has(job.conclusion)) return "✓"
		if (job.conclusion) return "✗"
		return "·"
	}
	if (job.status === "in_progress") return "●"
	if (job.status === "queued") return "○"
	return "·"
}

const statusColor = (job: WorkflowJob) => {
	if (job.status === "completed") {
		if (job.conclusion === "skipped" || job.conclusion === "cancelled") return colors.muted
		if (job.conclusion && PASSING.has(job.conclusion)) return colors.status.passing
		if (job.conclusion) return colors.status.failing
		return colors.muted
	}
	if (job.status === "in_progress") return colors.status.pending
	if (job.status === "queued") return colors.muted
	return colors.muted
}

const aggregateIcon = (children: readonly GraphChild[]) => {
	if (children.length === 0) return "?"
	const icons = children.map((child) => child.icon)
	if (icons.some((icon) => icon === "✗")) return "✗"
	if (icons.some((icon) => icon === "●")) return "●"
	if (icons.every((icon) => icon === "✓")) return "✓"
	if (icons.every((icon) => icon === "○")) return "○"
	return "○"
}

const aggregateColor = (children: readonly GraphChild[]) => {
	if (children.length === 0) return colors.muted
	const cs = children.map((child) => child.color)
	if (cs.some((color) => color === colors.status.failing)) return colors.status.failing
	if (cs.some((color) => color === colors.status.pending)) return colors.status.pending
	if (cs.every((color) => color === colors.status.passing)) return colors.status.passing
	return colors.muted
}

// ── build nodes ──

const buildNodes = (dependencies: readonly WorkflowJobDependency[], jobs: readonly WorkflowJob[]): GraphNode[] => {
	const jobsByName = new Map<string, WorkflowJob>()
	for (const job of jobs) jobsByName.set(normalize(job.name), job)

	// Build dependency-declared nodes
	const nodeMap = new Map<string, GraphNode>()
	for (const dependency of dependencies) {
		const id = normalize(dependency.id)
		const resolvedJob = jobsByName.get(normalize(dependency.name)) ?? jobsByName.get(id) ?? null
		nodeMap.set(id, {
			id,
			name: dependency.name,
			needs: dependency.needs.map(normalize),
			icon: resolvedJob ? statusIcon(resolvedJob) : "?",
			color: resolvedJob ? statusColor(resolvedJob) : colors.muted,
			children: [],
			column: 0,
			yStart: 0,
			height: 1,
		})
	}

	// Build name lookup from dependency name → id
	const nameToId = new Map<string, string>()
	for (const dependency of dependencies) {
		nameToId.set(normalize(dependency.name), normalize(dependency.id))
	}

	// Group unmatched API jobs as children of their parent dependency node
	const childrenByParent = new Map<string, GraphChild[]>()
	const matchedJobNames = new Set<string>()

	for (const dependency of dependencies) {
		matchedJobNames.add(normalize(dependency.name))
		matchedJobNames.add(normalize(dependency.id))
	}

	for (const job of jobs) {
		const normalizedName = normalize(job.name)
		if (matchedJobNames.has(normalizedName)) continue

		// Try " / " split to find parent
		const slashIndex = job.name.indexOf(" / ")
		if (slashIndex < 0) continue

		const parentName = normalize(job.name.slice(0, slashIndex))
		const parentId = nameToId.get(parentName)
		if (!parentId) continue

		const childName = job.name.slice(slashIndex + 3)
		const existing = childrenByParent.get(parentId)
		const child: GraphChild = {
			name: childName,
			icon: statusIcon(job),
			color: statusColor(job),
		}
		if (existing) existing.push(child)
		else childrenByParent.set(parentId, [child])
	}

	// Merge children into parent nodes; parents with children become box nodes
	for (const [parentId, children] of childrenByParent) {
		const parent = nodeMap.get(parentId)
		if (!parent) continue
		children.sort((a, b) => a.name.localeCompare(b.name))
		const node: GraphNode = {
			...parent,
			icon: aggregateIcon(children),
			color: aggregateColor(children),
			children,
			height: children.length + 2,
		}
		nodeMap.set(parentId, node)
	}

	// If no dependencies, just list all jobs as plain root nodes
	if (dependencies.length === 0) {
		for (const job of jobs) {
			const id = normalize(job.name)
			if (nodeMap.has(id)) continue
			nodeMap.set(id, {
				id,
				name: job.name,
				needs: [],
				icon: statusIcon(job),
				color: statusColor(job),
				children: [],
				column: 0,
				yStart: 0,
				height: 1,
			})
		}
	}

	return [...nodeMap.values()]
}

// ── layout ──

const assignColumns = (nodes: GraphNode[]) => {
	const byId = new Map(nodes.map((node) => [node.id, node] as const))
	const memo = new Map<string, number>()

	const depth = (id: string, stack: Set<string>): number => {
		if (memo.has(id)) return memo.get(id) ?? 0
		const node = byId.get(id)
		if (!node) return 0
		if (stack.has(id)) return 0
		if (node.needs.length === 0) {
			memo.set(id, 0)
			return 0
		}
		stack.add(id)
		const value = Math.max(...node.needs.map((need) => depth(need, stack))) + 1
		stack.delete(id)
		memo.set(id, value)
		return value
	}

	for (const node of nodes) node.column = depth(node.id, new Set())
}

const assignYPositions = (nodes: GraphNode[]) => {
	const byColumn = new Map<number, GraphNode[]>()
	for (const node of nodes) {
		const column = byColumn.get(node.column)
		if (column) column.push(node)
		else byColumn.set(node.column, [node])
	}

	let totalHeight = 0
	for (const [, columnNodes] of byColumn) {
		columnNodes.sort((a, b) => a.name.localeCompare(b.name))
		let y = 0
		for (const node of columnNodes) {
			node.yStart = y
			y += node.height
		}
		if (y > totalHeight) totalHeight = y
	}

	return totalHeight
}

const buildEdges = (nodes: readonly GraphNode[]) => {
	const byId = new Map(nodes.map((node) => [node.id, node] as const))
	const edges: GraphEdge[] = []
	for (const target of nodes) {
		for (const need of target.needs) {
			const source = byId.get(need)
			if (!source || source.id === target.id) continue
			edges.push({ source, target })
		}
	}
	return edges
}

/** Remove edges where the target is reachable from the source via other edges. */
const reduceEdges = (edges: readonly GraphEdge[]): GraphEdge[] => {
	const adj = new Map<string, Set<string>>()
	for (const edge of edges) {
		let set = adj.get(edge.source.id)
		if (!set) {
			set = new Set()
			adj.set(edge.source.id, set)
		}
		set.add(edge.target.id)
	}

	return edges.filter((edge) => {
		const neighbors = adj.get(edge.source.id)
		if (!neighbors) return true
		neighbors.delete(edge.target.id)

		const visited = new Set<string>([edge.source.id])
		const queue = [edge.source.id]
		let reachable = false
		while (queue.length > 0) {
			const current = queue.shift()!
			for (const neighbor of adj.get(current) ?? []) {
				if (neighbor === edge.target.id) {
					reachable = true
					break
				}
				if (!visited.has(neighbor)) {
					visited.add(neighbor)
					queue.push(neighbor)
				}
			}
			if (reachable) break
		}

		neighbors.add(edge.target.id)
		return !reachable
	})
}

const computeColumnWidths = (nodes: readonly GraphNode[], maxColumn: number) => {
	const widths: number[] = Array.from({ length: maxColumn + 1 }, () => 10)
	for (const node of nodes) {
		if (node.children.length > 0) {
			// Box node: title is "┌ I name ─…─┐", children are "│ I name   │"
			// Column width needs to fit the widest line
			const titleContent = `${node.icon} ${node.name}`
			let maxInner = titleContent.length
			for (const child of node.children) {
				const childContent = `${child.icon} ${child.name}`
				if (childContent.length > maxInner) maxInner = childContent.length
			}
			// Box adds "┌ " prefix (2) and " ─┐" suffix (2) → +4, but we treat the
			// box border chars as part of the column width
			const boxWidth = maxInner + 4
			if (boxWidth > widths[node.column]!) widths[node.column] = boxWidth
		} else {
			const labelWidth = `${node.icon} ${node.name}`.length
			if (labelWidth > widths[node.column]!) widths[node.column] = labelWidth
		}
	}
	return widths
}

// ── connector routing ──

// Each edge is routed:
//   - horizontal at sourceY from source column gap outward
//   - vertical at gap = source.column from sourceY to targetY
//   - horizontal at targetY from gap source.column through gap target.column - 1

const anchorY = (node: GraphNode) => node.yStart + Math.floor(node.height / 2)

interface DirectionFlags {
	left: boolean
	right: boolean
	up: boolean
	down: boolean
}

const connectorChar = (directions: DirectionFlags): string => {
	const { left, right, up, down } = directions
	if (!left && !right && !up && !down) return " "
	if (left && right && up && down) return "╋"
	if (left && right && up) return "┻"
	if (left && right && down) return "┳"
	if (left && up && down) return "┫"
	if (right && up && down) return "┣"
	if (left && right) return "━"
	if (up && down) return "┃"
	if (right && down) return "┏"
	if (right && up) return "┗"
	if (left && down) return "┓"
	if (left && up) return "┛"
	if (left) return "━"
	if (right) return "━"
	if (up) return "┃"
	if (down) return "┃"
	return " "
}

const buildConnectorGrid = (edges: readonly GraphEdge[], maxColumn: number, totalHeight: number) => {
	// For each gap (0..maxColumn-1) × y (0..totalHeight-1), compute direction flags
	const grid: DirectionFlags[][] = Array.from({ length: maxColumn }, () => Array.from({ length: totalHeight }, () => ({ left: false, right: false, up: false, down: false })))

	for (const edge of edges) {
		const sourceCol = edge.source.column
		const targetCol = edge.target.column
		const sourceAnchor = anchorY(edge.source)
		const targetAnchor = anchorY(edge.target)

		if (sourceCol >= targetCol) continue // skip invalid/self edges

		if (sourceAnchor === targetAnchor) {
			// Straight horizontal — no vertical turn needed
			for (let gap = sourceCol; gap < targetCol; gap++) {
				const cell = grid[gap]?.[sourceAnchor]
				if (cell) {
					cell.left = true
					cell.right = true
				}
			}
			continue
		}

		// Adjacent columns: turn at source gap (compact fork/merge next to source).
		// Multi-gap: turn at target gap (horizontal line is traceable, pass-through
		// fills empty column cells so the line stays visually continuous).
		const turnGap = targetCol - sourceCol === 1 ? sourceCol : targetCol - 1

		// 1. Horizontal segment at sourceAnchor from sourceCol to turnGap-1
		for (let gap = sourceCol; gap < turnGap; gap++) {
			const cell = grid[gap]?.[sourceAnchor]
			if (cell) {
				cell.left = true
				cell.right = true
			}
		}

		// 2. At turnGap, sourceAnchor: arrive from left, turn vertically
		const departCell = grid[turnGap]?.[sourceAnchor]
		if (departCell) {
			departCell.left = true
			if (targetAnchor < sourceAnchor) departCell.up = true
			else departCell.down = true
		}

		// 3. Vertical segment at turnGap between sourceAnchor and targetAnchor
		const minY = Math.min(sourceAnchor, targetAnchor)
		const maxY = Math.max(sourceAnchor, targetAnchor)
		for (let y = minY + 1; y < maxY; y++) {
			const vertCell = grid[turnGap]?.[y]
			if (vertCell) {
				vertCell.up = true
				vertCell.down = true
			}
		}

		// 4. At turnGap, targetAnchor: arrive from vertical, exit right to target
		const arriveCell = grid[turnGap]?.[targetAnchor]
		if (arriveCell) {
			if (targetAnchor < sourceAnchor) arriveCell.down = true
			else arriveCell.up = true
			arriveCell.right = true
		}

		// 5. Horizontal segment at targetAnchor from turnGap+1 through targetCol-1
		for (let gap = turnGap + 1; gap < targetCol; gap++) {
			const horizCell = grid[gap]?.[targetAnchor]
			if (horizCell) {
				horizCell.left = true
				horizCell.right = true
			}
		}
	}

	return grid
}

// ── rendering ──

const clip = (value: string, offset: number, width: number) => {
	if (width <= 0) return ""
	const start = Math.max(0, offset)
	const end = start + width
	return value.slice(start, end).padEnd(width, " ")
}

const compactSegments = (segments: WorkflowGraphSegment[]): WorkflowGraphSegment[] => {
	if (segments.length <= 1) return segments
	const output: WorkflowGraphSegment[] = []
	for (const segment of segments) {
		const previous = output[output.length - 1]
		if (previous && previous.fg === segment.fg) {
			output[output.length - 1] = { text: `${previous.text}${segment.text}`, fg: previous.fg }
		} else {
			output.push(segment)
		}
	}
	return output
}

type NodeRowKind = "top" | "child" | "bottom" | "plain" | "empty"

interface NodeRowInfo {
	readonly kind: NodeRowKind
	readonly node: GraphNode
	readonly childIndex?: number
}

const getNodeRowInfo = (node: GraphNode, y: number): NodeRowInfo | null => {
	if (y < node.yStart || y >= node.yStart + node.height) return null
	if (node.children.length === 0) {
		return y === node.yStart ? { kind: "plain", node } : null
	}
	const offset = y - node.yStart
	if (offset === 0) return { kind: "top", node }
	if (offset === node.height - 1) return { kind: "bottom", node }
	return { kind: "child", node, childIndex: offset - 1 }
}

const renderNodeCell = (info: NodeRowInfo, columnWidth: number, trailingFill = " "): WorkflowGraphSegment[] => {
	const { kind, node } = info
	switch (kind) {
		case "plain": {
			const label = `${node.icon} ${node.name}`
			const pad = Math.max(0, columnWidth - label.length)
			return [
				{ text: label, fg: node.color },
				{ text: trailingFill.repeat(pad), fg: colors.muted },
			]
		}
		case "top": {
			const titleContent = `${node.icon} ${node.name}`
			const innerWidth = columnWidth - 4
			const padded = titleContent.length >= innerWidth ? titleContent.slice(0, innerWidth) : titleContent
			const fill = "─".repeat(Math.max(0, innerWidth - padded.length))
			const text = `┌ ${padded} ${fill}┐`
			return [{ text, fg: node.color }]
		}
		case "child": {
			const child = node.children[info.childIndex ?? 0]
			if (!child) return [{ text: " ".repeat(columnWidth), fg: colors.muted }]
			const innerWidth = columnWidth - 4
			const content = `${child.icon} ${child.name}`
			const padded = content.length >= innerWidth ? content.slice(0, innerWidth) : content.padEnd(innerWidth, " ")
			return [
				{ text: "│ ", fg: node.color },
				{ text: padded, fg: child.color },
				{ text: " │", fg: node.color },
			]
		}
		case "bottom": {
			const innerWidth = columnWidth - 4
			const fill = "─".repeat(Math.max(0, innerWidth + 2))
			const text = `└${fill}┘`
			return [{ text, fg: node.color }]
		}
		case "empty":
			return [{ text: " ".repeat(columnWidth), fg: colors.muted }]
	}
}

const renderGapCell = (char: string, gapWidth: number, directions: DirectionFlags): WorkflowGraphSegment => {
	if (char === " ") return { text: " ".repeat(gapWidth), fg: colors.muted }

	// Vertical-only: center the character with spaces
	const isVerticalOnly = char === "┃"
	if (isVerticalOnly) {
		const pad = Math.floor((gapWidth - 1) / 2)
		const rest = gapWidth - 1 - pad
		return { text: `${" ".repeat(pad)}${char}${" ".repeat(rest)}`, fg: colors.muted }
	}

	if (gapWidth === 1) return { text: char, fg: colors.muted }

	// Fill left/right sides based on whether the character has horizontal lines
	// on that side. ━ if there's a line, space if not.
	const leftFill = directions.left ? "━" : " "
	const rightFill = directions.right ? "━" : " "

	if (gapWidth === 2) return { text: `${leftFill}${char}`, fg: colors.muted }

	// gapWidth >= 3
	const before = Math.floor((gapWidth - 1) / 2)
	const after = gapWidth - 1 - before
	return { text: `${leftFill.repeat(before)}${char}${rightFill.repeat(after)}`, fg: colors.muted }
}

// ── main layout ──

const graphLayout = (dependencies: readonly WorkflowJobDependency[], jobs: readonly WorkflowJob[]) => {
	const nodes = buildNodes(dependencies, jobs)
	if (nodes.length === 0) return null
	assignColumns(nodes)
	const totalHeight = Math.max(1, assignYPositions(nodes))
	const edges = reduceEdges(buildEdges(nodes))
	const maxColumn = Math.max(...nodes.map((node) => node.column))
	const columnWidths = computeColumnWidths(nodes, maxColumn)
	const gapWidth = 3
	const totalWidth = columnWidths.reduce((sum, w) => sum + w, 0) + Math.max(0, maxColumn) * gapWidth
	return { nodes, edges, totalHeight, maxColumn, columnWidths, gapWidth, totalWidth }
}

export const renderWorkflowGraph = ({
	dependencies,
	jobs,
	contentWidth,
	scrollOffset,
}: {
	readonly dependencies: readonly WorkflowJobDependency[]
	readonly jobs: readonly WorkflowJob[]
	readonly contentWidth: number
	readonly scrollOffset: number
}): readonly WorkflowGraphRow[] => {
	const layout = graphLayout(dependencies, jobs)
	if (!layout) return []

	const { nodes, edges, totalHeight, maxColumn, columnWidths, gapWidth } = layout
	const connectorGrid = buildConnectorGrid(edges, maxColumn, totalHeight)

	// Index nodes by column for fast lookup
	const byColumn = new Map<number, GraphNode[]>()
	for (const node of nodes) {
		const column = byColumn.get(node.column)
		if (column) column.push(node)
		else byColumn.set(node.column, [node])
	}

	const output: WorkflowGraphRow[] = []

	for (let y = 0; y < totalHeight; y++) {
		const fullSegments: WorkflowGraphSegment[] = []

		for (let column = 0; column <= maxColumn; column++) {
			const colWidth = columnWidths[column] ?? 10
			const columnNodes = byColumn.get(column)
			let rendered = false

			if (columnNodes) {
				for (const node of columnNodes) {
					const info = getNodeRowInfo(node, y)
					if (info) {
						// Check if a horizontal edge continues to the right of this node
						const rightGap = column < maxColumn ? connectorGrid[column]?.[y] : null
						const trailingFill = rightGap?.left ? "━" : " "
						fullSegments.push(...renderNodeCell(info, colWidth, trailingFill))
						rendered = true
						break
					}
				}
			}

			if (!rendered) {
				// Check if a horizontal edge passes through this empty column cell.
				// This happens when the gap on the left has a rightward segment and
				// the gap on the right has a leftward segment at this y position.
				const leftGap = column > 0 ? connectorGrid[column - 1]?.[y] : null
				const rightGap = column < maxColumn ? connectorGrid[column]?.[y] : null
				const hasPassThrough = leftGap?.right && rightGap?.left
				if (hasPassThrough) {
					fullSegments.push({ text: "━".repeat(colWidth), fg: colors.muted })
				} else {
					fullSegments.push({ text: " ".repeat(colWidth), fg: colors.muted })
				}
			}

			if (column < maxColumn) {
				const directions = connectorGrid[column]?.[y] ?? { left: false, right: false, up: false, down: false }
				const char = connectorChar(directions)
				fullSegments.push(renderGapCell(char, gapWidth, directions))
			}
		}

		// Build full line and color mask
		const fullLine = fullSegments.map((segment) => segment.text).join("")
		const colorMask: string[] = []
		for (const segment of fullSegments) {
			for (let index = 0; index < segment.text.length; index++) colorMask.push(segment.fg)
		}

		const clippedLine = clip(fullLine, scrollOffset, contentWidth)
		const start = Math.max(0, scrollOffset)
		const visibleMask = colorMask.slice(start, start + clippedLine.length)
		while (visibleMask.length < clippedLine.length) visibleMask.push(colors.muted)

		const rowSegments: WorkflowGraphSegment[] = []
		let currentText = ""
		let currentColor = visibleMask[0] ?? colors.muted
		for (let index = 0; index < clippedLine.length; index++) {
			const char = clippedLine[index]!
			const color = visibleMask[index] ?? colors.muted
			if (color !== currentColor) {
				if (currentText.length > 0) rowSegments.push({ text: currentText, fg: currentColor })
				currentText = char
				currentColor = color
			} else {
				currentText += char
			}
		}
		if (currentText.length > 0) rowSegments.push({ text: currentText, fg: currentColor })
		output.push({ segments: compactSegments(rowSegments) })
	}

	return output
}

export const workflowGraphMaxScrollOffset = ({
	dependencies,
	jobs,
	contentWidth,
}: {
	readonly dependencies: readonly WorkflowJobDependency[]
	readonly jobs: readonly WorkflowJob[]
	readonly contentWidth: number
}) => {
	const layout = graphLayout(dependencies, jobs)
	if (!layout) return 0
	return Math.max(0, layout.totalWidth - Math.max(1, contentWidth))
}
