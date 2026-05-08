import { describe, expect, test } from "bun:test"
import {
	buildStackedDiffFiles,
	diffAnchorOnSide,
	getDiffCommentAnchors,
	getStackedDiffCommentAnchors,
	minimizeWhitespaceDiffFiles,
	minimizeWhitespacePatch,
	nearestDiffAnchorForLocation,
	nearestDiffCommentAnchorIndex,
	patchRenderableLineCount,
	scrollTopForVisibleLine,
	splitPatchFiles,
	verticalDiffAnchor,
} from "../src/ui/diff.ts"

const patch = `diff --git a/one.ts b/one.ts
--- a/one.ts
+++ b/one.ts
@@ -1,2 +1,2 @@
 const a = 1
-const b = 2
+const b = 3
diff --git a/two.ts b/two.ts
--- a/two.ts
+++ b/two.ts
@@ -10,2 +10,3 @@
 const c = 4
+const d = 5
 const e = 6`

describe("stacked diff helpers", () => {
	test("computes file offsets with separated headers", () => {
		const files = splitPatchFiles(patch)
		const stacked = buildStackedDiffFiles(files, "unified", "none", 120)
		const firstHeight = patchRenderableLineCount(files[0]!.patch, "unified", "none", 120)

		expect(stacked).toHaveLength(2)
		expect(stacked[0]).toMatchObject({ index: 0, headerLine: 0, diffStartLine: 2, diffHeight: firstHeight })
		expect(stacked[1]).toMatchObject({ index: 1, headerLine: firstHeight + 3, diffStartLine: firstHeight + 5 })
	})

	test("maps local comment anchors into global stacked lines", () => {
		const stacked = buildStackedDiffFiles(splitPatchFiles(patch), "unified", "none", 120)
		const anchors = getStackedDiffCommentAnchors(stacked, "unified")
		const secondFileAnchor = anchors.find((anchor) => anchor.path === "two.ts" && anchor.line === 11)

		expect(secondFileAnchor?.fileIndex).toBe(1)
		expect(secondFileAnchor?.localRenderLine).toBe(1)
		expect(secondFileAnchor?.renderLine).toBe(stacked[1]!.diffStartLine + 1)
	})

	test("keeps separate visual and color lines for wrapped unified diffs", () => {
		const [file] = splitPatchFiles(`diff --git a/wrap.ts b/wrap.ts
--- a/wrap.ts
+++ b/wrap.ts
@@ -1,2 +1,2 @@
 const first = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
 const second = true`)
		const anchors = getDiffCommentAnchors(file!, "unified", "word", 20)

		expect(anchors[0]).toMatchObject({ line: 1, renderLine: 0, colorLine: 0 })
		expect(anchors[1]).toMatchObject({ line: 2, renderLine: 4, colorLine: 1 })
	})

	test("keeps split color lines aligned with the wrapped side renderables", () => {
		const [file] = splitPatchFiles(`diff --git a/wrap.ts b/wrap.ts
--- a/wrap.ts
+++ b/wrap.ts
@@ -1,2 +1,2 @@
-const oldValue = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
+const newValue = true
 const after = true`)
		const anchors = getDiffCommentAnchors(file!, "split", "word", 40)
		const deletion = anchors.find((anchor) => anchor.kind === "deletion")!
		const addition = anchors.find((anchor) => anchor.kind === "addition")!
		const context = anchors.find((anchor) => anchor.kind === "context")!

		expect(deletion).toMatchObject({ side: "LEFT", renderLine: 0, colorLine: 0 })
		expect(addition).toMatchObject({ side: "RIGHT", renderLine: 0, colorLine: 0 })
		expect(context).toMatchObject({ side: "RIGHT", renderLine: 4, colorLine: 3 })
	})

	test("chooses the first anchor at or below the current scroll line", () => {
		const stacked = buildStackedDiffFiles(splitPatchFiles(patch), "unified", "none", 120)
		const anchors = getStackedDiffCommentAnchors(stacked, "unified")

		expect(nearestDiffCommentAnchorIndex(anchors, 0)).toBe(0)
		expect(anchors[nearestDiffCommentAnchorIndex(anchors, stacked[1]!.headerLine)]?.fileIndex).toBe(1)
		expect(nearestDiffCommentAnchorIndex(anchors, Number.MAX_SAFE_INTEGER)).toBe(anchors.length - 1)
	})

	test("restores the nearest visible anchor when whitespace mode removes the exact line", () => {
		const [visible] = splitPatchFiles(`diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 const first = true
 const second = true
 const third = true`)
		const anchors = getDiffCommentAnchors(visible!)
		const target = { ...anchors[1]!, line: 99 }

		expect(nearestDiffAnchorForLocation(anchors, target)).toBe(anchors[2]!)
	})

	test("keeps visible lines stable while scrolling only near viewport edges", () => {
		expect(scrollTopForVisibleLine(40, 20, 47)).toBe(40)
		expect(scrollTopForVisibleLine(40, 20, 41)).toBe(40)
		expect(scrollTopForVisibleLine(40, 20, 40)).toBe(39)
		expect(scrollTopForVisibleLine(40, 20, 59)).toBe(41)
	})

	test("detects shell diffs as bash", () => {
		const [file] = splitPatchFiles(`diff --git a/script.zsh b/script.zsh
--- a/script.zsh
+++ b/script.zsh
@@ -1,2 +1,2 @@
 echo before
-echo old
+echo new`)

		expect(file?.filetype).toBe("bash")
	})
})

describe("whitespace-minimized diffs", () => {
	test("drops files that only changed whitespace", () => {
		const files = splitPatchFiles(`diff --git a/format.ts b/format.ts
--- a/format.ts
+++ b/format.ts
@@ -1,3 +1,3 @@
 export const value = {
-  name: "ghui",
+	name: "ghui",
 }
`)

		expect(minimizeWhitespaceDiffFiles(files)).toEqual([])
	})

	test("keeps real changes while collapsing whitespace-only pairs to context", () => {
		const minimized = minimizeWhitespacePatch(`diff --git a/mixed.ts b/mixed.ts
--- a/mixed.ts
+++ b/mixed.ts
@@ -1,4 +1,4 @@
 export const value = {
-  name: "ghui",
-  count: 1,
+	name: "ghui",
+	count: 2,
 }
`)

		expect(minimized).toContain("@@ -1,4 +1,4 @@")
		expect(minimized).toContain(' \tname: "ghui"')
		expect(minimized).not.toContain("-  name")
		expect(minimized).not.toContain("+\tname")
		expect(minimized).toContain("-  count: 1,")
		expect(minimized).toContain("+\tcount: 2,")
	})

	test("matches repeated whitespace-only changes without hiding nearby edits", () => {
		const minimized = minimizeWhitespacePatch(`diff --git a/repeated.ts b/repeated.ts
--- a/repeated.ts
+++ b/repeated.ts
@@ -1,5 +1,5 @@
-const value = call(1)
-const value = call(2)
-const value = call(3)
+const value=call(1)
+const value=call(20)
+const value=call(3)
 const done = true
`)

		expect(minimized).toContain(" const value=call(1)")
		expect(minimized).toContain("-const value = call(2)")
		expect(minimized).toContain("+const value=call(20)")
		expect(minimized).toContain(" const value=call(3)")
	})

	test("uses bounded matching for large whitespace-only change blocks", () => {
		const deletions = Array.from({ length: 250 }, (_, index) => `-  const value${index} = call(${index})`).join("\n")
		const additions = Array.from({ length: 250 }, (_, index) => `+\tconst value${index}=call(${index})`).join("\n")
		const files = splitPatchFiles(`diff --git a/large.ts b/large.ts
--- a/large.ts
+++ b/large.ts
@@ -1,250 +1,250 @@
${deletions}
${additions}`)

		expect(minimizeWhitespaceDiffFiles(files)).toEqual([])
	})

	test("comment anchors are computed from displayed whitespace-minimized patches", () => {
		const [file] = minimizeWhitespaceDiffFiles(
			splitPatchFiles(`diff --git a/comments.ts b/comments.ts
--- a/comments.ts
+++ b/comments.ts
@@ -10,4 +10,4 @@
 export const value = {
-  name: "ghui",
-  count: 1,
+	name: "ghui",
+	count: 2,
 }
`),
		)

		expect(file).toBeDefined()
		const anchors = getDiffCommentAnchors(file!)

		expect(anchors.map((anchor) => `${anchor.kind}:${anchor.side}:${anchor.line}:${anchor.text}`)).toEqual([
			"context:RIGHT:10:export const value = {",
			'context:RIGHT:11:\tname: "ghui",',
			"deletion:LEFT:12:  count: 1,",
			"addition:RIGHT:12:\tcount: 2,",
			"context:RIGHT:13:}",
		])
	})

	test("split navigation preserves a preferred side across right-only context rows", () => {
		const [file] = minimizeWhitespaceDiffFiles(
			splitPatchFiles(`diff --git a/nav.ts b/nav.ts
--- a/nav.ts
+++ b/nav.ts
@@ -1,6 +1,6 @@
 export const before = true
-const oldOne = 1
+const newOne = 1
-  sameName()
+	sameName()
-const oldTwo = 2
+const newTwo = 2
 export const after = true
`),
		)
		const anchors = getDiffCommentAnchors(file!, "split")
		const firstLeft = anchors.find((anchor) => anchor.text === "const oldOne = 1")!
		const context = verticalDiffAnchor(anchors, firstLeft, 1, "LEFT")!
		const secondLeft = verticalDiffAnchor(anchors, context, 1, "LEFT")!

		expect(context).toMatchObject({ kind: "context", side: "RIGHT", text: "\tsameName()" })
		expect(secondLeft).toMatchObject({ kind: "deletion", side: "LEFT", text: "const oldTwo = 2" })
	})

	test("split left/right side selection is explicit when a row has both sides", () => {
		const [file] = splitPatchFiles(`diff --git a/side.ts b/side.ts
--- a/side.ts
+++ b/side.ts
@@ -1,2 +1,2 @@
-const oldValue = 1
+const newValue = 2
 const unchanged = true
`)
		const anchors = getDiffCommentAnchors(file!, "split")
		const right = anchors.find((anchor) => anchor.side === "RIGHT" && anchor.kind === "addition")!
		const left = diffAnchorOnSide(anchors, right, "LEFT")!
		const unchanged = verticalDiffAnchor(anchors, left, 1, "LEFT")!

		expect(left).toMatchObject({ side: "LEFT", kind: "deletion", text: "const oldValue = 1" })
		expect(diffAnchorOnSide(anchors, unchanged, "LEFT")).toBeNull()
	})
})
