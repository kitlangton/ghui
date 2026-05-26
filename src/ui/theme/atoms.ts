import { Effect } from "effect"
import * as Atom from "effect/unstable/reactivity/Atom"
import { detectSystemAppearance } from "../../systemAppearance.js"
import { resolveThemeId, type ThemeConfig } from "../../themeConfig.js"
import { loadStoredShowScrollbars, loadStoredThemeConfig } from "../../themeStore.js"
import { setActiveTheme, type ThemeId, type ThemeTone } from "../colors.js"

const [initialConfig, initialAppearance, initialShowScrollbars] = await Promise.all([
	Effect.runPromise(loadStoredThemeConfig),
	detectSystemAppearance(),
	Effect.runPromise(loadStoredShowScrollbars),
])
const initialId = resolveThemeId(initialConfig, initialAppearance)

// Mutates the shared theme registry so any module that reads colors.* during
// startup sees the resolved theme. Must run before any UI module loads.
setActiveTheme(initialId)

export const initialThemeConfig: ThemeConfig = initialConfig
export const initialSystemAppearance: ThemeTone = initialAppearance
export const initialThemeId: ThemeId = initialId

export const themeConfigAtom = Atom.make<ThemeConfig>(initialConfig).pipe(Atom.keepAlive)
export const systemAppearanceAtom = Atom.make<ThemeTone>(initialAppearance).pipe(Atom.keepAlive)
export const themeIdAtom = Atom.make<ThemeId>(initialId).pipe(Atom.keepAlive)
export const showScrollbarsAtom = Atom.make(initialShowScrollbars).pipe(Atom.keepAlive)
