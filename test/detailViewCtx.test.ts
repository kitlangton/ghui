import { describe, expect, test } from "bun:test"
import { buildDetailViewCtx } from "../src/keymap/contexts/detailViewCtx.ts"

const detailCtx = (activeSurface: "issues" | "pullRequests") => {
	const called: string[] = []
	return {
		called,
		ctx: buildDetailViewCtx({
			halfPage: 4,
			activeSurface,
			scrollDetailFullViewBy: () => {},
			scrollDetailFullViewTo: () => {},
			runCommandById: (id) => called.push(id),
		}),
	}
}

describe("buildDetailViewCtx", () => {
	test("routes issue detail refresh and metadata actions to issue commands", () => {
		const { ctx, called } = detailCtx("issues")

		ctx.refresh()
		ctx.copyMetadata()
		ctx.openInBrowser()

		expect(called).toEqual(["issue.refresh", "issue.copy-metadata", "issue.open-browser"])
	})
})
