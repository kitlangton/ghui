import { context, type Scrollable, scrollCommands } from "@ghui/keymap"

export interface ActionsViewCtx extends Scrollable {
	readonly closeOrBack: () => void
	readonly confirmSelection: () => void
	readonly refresh: () => void
	readonly openInBrowser: () => void
	readonly stepBy: (delta: number) => void
}

const Actions = context<ActionsViewCtx>()

export const actionsViewKeymap = Actions(
	scrollCommands<ActionsViewCtx>(),
	{ id: "actions.previous-step", title: "Previous log step", keys: ["left", "h"], run: (s) => s.stepBy(-1) },
	{ id: "actions.next-step", title: "Next log step", keys: ["right", "l"], run: (s) => s.stepBy(1) },
	{ id: "actions.close", title: "Back / close actions", keys: ["escape", "a"], run: (s) => s.closeOrBack() },
	{ id: "actions.confirm", title: "Open selected action", keys: ["return"], run: (s) => s.confirmSelection() },
	{ id: "actions.refresh", title: "Refresh actions", keys: ["r"], run: (s) => s.refresh() },
	{ id: "actions.open-browser", title: "Open in browser", keys: ["o"], run: (s) => s.openInBrowser() },
)
