import { colors } from "./ui/colors.js"
import { LoadingLogoPane } from "./ui/LoadingLogo.js"
import { centerCell, Divider, TextLine } from "./ui/primitives.js"
import { WorkspaceTabs } from "./ui/WorkspaceTabs.js"
import { WorkspaceContent } from "./surfaces/WorkspaceContent.js"
import { WorkspaceFooter } from "./surfaces/WorkspaceFooter.js"
import { WorkspaceHeader } from "./surfaces/WorkspaceHeader.js"
import { WorkspaceModals } from "./surfaces/WorkspaceModals.js"
import { useAppShell } from "./hooks/useAppShell.js"

interface AppProps {
	readonly systemThemeGeneration?: number
}

/**
 * Top-level render manifest. All state, hooks, derivations, atom
 * subscriptions, keymap wiring, and side-effects live inside
 * `useAppShell`; this component is purely the JSX layout that
 * consumes the shell bundle.
 */
export const App = ({ systemThemeGeneration = 0 }: AppProps) => {
	const shell = useAppShell({ systemThemeGeneration })

	if (shell.terminalTooSmall) {
		const lines = ["Terminal too small", `Need 60x16; current ${shell.terminalWidth}x${shell.terminalHeight}`, "Resize to continue"]
		return (
			<box width={shell.terminalWidth} height={shell.terminalHeight} flexDirection="column" justifyContent="center" backgroundColor={colors.background}>
				{lines.map((line) => (
					<TextLine key={line} width={shell.terminalWidth}>
						{centerCell(line, shell.terminalWidth)}
					</TextLine>
				))}
			</box>
		)
	}

	if (shell.isInitialLoading) {
		return (
			<box width={shell.terminalWidth} height={shell.terminalHeight} flexDirection="column" backgroundColor={colors.background}>
				<LoadingLogoPane content={shell.detailPlaceholderContent} width={shell.contentWidth} height={shell.terminalHeight} frame={shell.loadingFrame} />
			</box>
		)
	}

	return (
		<box width={shell.terminalWidth} height={shell.terminalHeight} flexDirection="column" backgroundColor={colors.background}>
			<box paddingLeft={1} paddingRight={1} flexDirection="column" backgroundColor={colors.background}>
				<box width={shell.headerFooterWidth} height={1} flexDirection="row">
					<WorkspaceHeader {...shell.headerProps} />
					{shell.headerRight ? (
						<TextLine width={shell.headerRight.length}>
							<span fg={colors.muted}>{shell.headerRight}</span>
						</TextLine>
					) : null}
				</box>
			</box>
			<Divider width={shell.contentWidth} junctions={shell.workspaceTopDividerJunctions} />
			{shell.showWorkspaceTabs ? (
				<>
					<box paddingRight={1} backgroundColor={colors.background}>
						<WorkspaceTabs
							activeSurface={shell.activeWorkspaceSurface}
							width={Math.max(24, shell.contentWidth - 1)}
							surfaces={shell.workspaceTabSurfaces}
							counts={shell.workspaceTabCounts}
							onSelect={shell.switchWorkspaceSurface}
						/>
					</box>
					<Divider width={shell.contentWidth} junctions={shell.workspaceBottomDividerJunctions} />
				</>
			) : null}
			<WorkspaceContent {...shell.contentProps} />
			<Divider width={shell.contentWidth} junctions={shell.preFooterDividerJunctions} />
			<WorkspaceFooter {...shell.footerProps} />
			<WorkspaceModals {...shell.modalsProps} />
		</box>
	)
}
