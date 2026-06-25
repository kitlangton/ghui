import { beforeAll, describe, expect, test } from "bun:test"
import { act } from "react"

// App-side modules select their runtime once per test process. Keep this in
// sync with scrolling.test.tsx so file execution order cannot change either
// suite's fixture shape on CI.
process.env.GHUI_MOCK_PR_COUNT = "80"
process.env.GHUI_MOCK_REPO_COUNT = "4"
process.env.GHUI_MOCK_FIXTURE_PATH = "/var/folders/dd/5fz89drs5p9_r0fk7rwqqnbr0000gn/T/opencode/ghui-test-no-fixture.json"
process.env.GHUI_MOCK_WORKSPACE_PREFERENCES_PATH = "off"
process.env.GHUI_PR_PAGE_SIZE = "100"

const loadApp = async () => {
	const { createTestRenderer } = await import("@opentui/core/testing")
	const { createRoot } = await import("@opentui/react")
	const { RegistryProvider } = await import("@effect/atom-react")
	const { App } = await import("../src/App.tsx")
	return { createTestRenderer, createRoot, RegistryProvider, App }
}

let cached: Awaited<ReturnType<typeof loadApp>>

beforeAll(async () => {
	// @ts-expect-error -- React's act environment flag is intentionally global.
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	cached = await loadApp()
})

const stepFrame = async (renderOnce: () => Promise<void>, delay = 1) => {
	await act(async () => {
		await renderOnce()
		await new Promise<void>((resolve) => setTimeout(resolve, delay))
	})
}

const settle = async (renderOnce: () => Promise<void>, predicate: () => boolean, attempts = 80) => {
	for (let i = 0; i < attempts; i++) {
		await stepFrame(renderOnce)
		if (predicate()) return true
	}
	return false
}

const setupApp = async (width: number, height: number) => {
	const setup = await cached.createTestRenderer({ width, height })
	const root = cached.createRoot(setup.renderer)
	act(() => {
		root.render(
			<cached.RegistryProvider>
				<cached.App />
			</cached.RegistryProvider>,
		)
	})
	await stepFrame(setup.renderOnce)
	return { ...setup, root }
}

const cleanup = (setup: Awaited<ReturnType<typeof setupApp>>) => {
	act(() => setup.root.unmount())
	setup.renderer.destroy()
}

describe("small terminal fallback", () => {
	test("captures only the fitted fallback at 59x16", async () => {
		const setup = await setupApp(59, 16)
		const frame = setup.captureCharFrame()
		expect(frame).toContain("Terminal too small")
		expect(frame).toContain("Need 60x16; current 59x16")
		expect(frame).toContain("Resize to continue")
		expect(frame).not.toContain("PULL REQUESTS")
		expect(setup.captureSpans()).toMatchObject({ cols: 59, rows: 16 })
		cleanup(setup)
	})

	test("fits without crashing in a pathological 4x2 frame", async () => {
		const setup = await setupApp(4, 2)
		expect(setup.captureSpans()).toMatchObject({ cols: 4, rows: 2 })
		cleanup(setup)
	})

	test("freezes modal input and restores mounted state after an async resize round trip", async () => {
		const setup = await setupApp(100, 20)
		const loaded = await settle(setup.renderOnce, () => setup.captureCharFrame().includes("PULL REQUESTS"))
		expect(loaded, setup.captureCharFrame()).toBe(true)

		act(() => setup.mockInput.pressKey("p", { ctrl: true }))
		const modalOpen = await settle(setup.renderOnce, () => setup.captureCharFrame().includes("Commands"))
		expect(modalOpen, setup.captureCharFrame()).toBe(true)
		expect(setup.captureCharFrame()).toContain("22 commands")

		act(() => setup.resize(59, 15))
		const fallbackVisible = await settle(setup.renderOnce, () => setup.captureCharFrame().includes("Terminal too small"))
		expect(fallbackVisible, setup.captureCharFrame()).toBe(true)

		act(() => {
			setup.mockInput.pressEscape()
			setup.mockInput.pressKey("x")
		})
		await stepFrame(setup.renderOnce)

		act(() => setup.resize(100, 20))
		const modalRestored = await settle(setup.renderOnce, () => setup.captureCharFrame().includes("Commands"))
		expect(modalRestored, setup.captureCharFrame()).toBe(true)
		expect(setup.captureCharFrame()).toContain("22 commands")
		cleanup(setup)
	})
})
