import { TextAttributes } from "@opentui/core"
import type { ReleaseAsset, ReleaseSummary } from "../domain.js"
import { formatShortDate } from "../date.js"
import { colors } from "./colors.js"
import type { ReleasesModalState } from "./modals.js"
import { centerCell, fitCell, Filler, HintRow, PlainLine, StandardModal, TextLine, type Token } from "./primitives.js"
import { shortRepoName } from "./pullRequests.js"

interface ReleasesModalProps {
	readonly state: ReleasesModalState
	readonly modalWidth: number
	readonly modalHeight: number
	readonly offsetLeft: number
	readonly offsetTop: number
	readonly loadingIndicator: string
}

const formatReleaseDate = (value: Date | null): string => (value ? formatShortDate(value) : "—")

const releaseStatusTokens = (release: ReleaseSummary, isLatest: boolean): readonly Token[] => {
	const tokens: Token[] = []
	if (release.isDraft) tokens.push({ text: "draft", fg: colors.muted })
	if (release.isPrerelease) tokens.push({ text: "pre-release", fg: colors.status.pending })
	if (isLatest) tokens.push({ text: "latest", fg: colors.status.approved })
	return tokens
}

const wrapBody = (body: string, width: number): readonly string[] => {
	const safeWidth = Math.max(1, width)
	const lines: string[] = []
	for (const rawLine of body.split(/\r?\n/)) {
		if (rawLine.length === 0) {
			lines.push("")
			continue
		}
		let remaining = rawLine
		while (remaining.length > safeWidth) {
			// Prefer breaking on a space within the last 16 chars.
			const slice = remaining.slice(0, safeWidth)
			const breakAt = slice.lastIndexOf(" ", safeWidth - 1)
			const cutoff = breakAt > safeWidth - 16 ? breakAt : safeWidth
			lines.push(remaining.slice(0, cutoff).trimEnd())
			remaining = remaining.slice(cutoff).trimStart()
		}
		lines.push(remaining)
	}
	return lines
}

const formatBytes = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

const ReleaseListRow = ({ release, isSelected, isLatest, rowWidth }: { release: ReleaseSummary; isSelected: boolean; isLatest: boolean; rowWidth: number }) => {
	const dateText = formatReleaseDate(release.publishedAt ?? release.createdAt)
	const author = release.author?.login ?? ""
	const right = `${author ? `@${author}  ` : ""}${dateText}`
	const tokens = releaseStatusTokens(release, isLatest)
	const tagText = release.tagName
	const nameText = release.name && release.name !== release.tagName ? release.name : ""
	const badgesText = tokens.map((t) => t.text).join("  ")

	const tagWidth = Math.min(20, Math.max(8, tagText.length))
	const rightWidth = Math.min(28, right.length + 1)
	const badgesWidth = badgesText.length === 0 ? 0 : Math.min(24, badgesText.length + 2)
	const nameWidth = Math.max(1, rowWidth - tagWidth - rightWidth - badgesWidth - 1)

	return (
		<TextLine width={rowWidth} bg={isSelected ? colors.selectedBg : undefined} fg={isSelected ? colors.selectedText : colors.text}>
			<span fg={isSelected ? colors.selectedText : colors.accent}>{fitCell(tagText, tagWidth)}</span>
			<span> </span>
			<span fg={isSelected ? colors.selectedText : colors.muted}>{fitCell(nameText, nameWidth)}</span>
			{tokens.length > 0 ? (
				<>
					<span> </span>
					{tokens.map((token, idx) => (
						<span key={idx} fg={isSelected ? colors.selectedText : token.fg}>
							{fitCell(token.text, token.text.length + (idx === tokens.length - 1 ? 0 : 2))}
						</span>
					))}
				</>
			) : null}
			<span fg={isSelected ? colors.selectedText : colors.muted}>{fitCell(right, rightWidth, "right")}</span>
		</TextLine>
	)
}

const ReleasesListBody = ({ state, rowWidth, bodyHeight, loadingIndicator }: { state: ReleasesModalState; rowWidth: number; bodyHeight: number; loadingIndicator: string }) => {
	const messageTopRows = Math.max(0, Math.floor((bodyHeight - 1) / 2))
	const messageBottomRows = Math.max(0, bodyHeight - messageTopRows - 1)

	if (state.loading && state.releases.length === 0) {
		return (
			<>
				<Filler rows={messageTopRows} prefix="releases-top" />
				<PlainLine text={centerCell(`${loadingIndicator} Loading releases…`, rowWidth)} fg={colors.muted} />
				<Filler rows={messageBottomRows} prefix="releases-bottom" />
			</>
		)
	}

	if (state.error && state.releases.length === 0) {
		return (
			<>
				<Filler rows={messageTopRows} prefix="releases-top" />
				<PlainLine text={centerCell(state.error, rowWidth)} fg={colors.error} />
				<Filler rows={messageBottomRows} prefix="releases-bottom" />
			</>
		)
	}

	if (state.releases.length === 0) {
		return (
			<>
				<Filler rows={messageTopRows} prefix="releases-top" />
				<PlainLine text={centerCell("No releases yet", rowWidth)} fg={colors.muted} />
				<Filler rows={messageBottomRows} prefix="releases-bottom" />
			</>
		)
	}

	const reserveLoadMore = state.loadingMore || state.hasNextPage ? 1 : 0
	const visibleRows = Math.max(1, bodyHeight - reserveLoadMore)
	const selectedIndex = Math.max(0, Math.min(state.listSelectedIndex, state.releases.length - 1))
	const scrollStart = Math.min(Math.max(0, state.releases.length - visibleRows), Math.max(0, selectedIndex - visibleRows + 1))
	const visible = state.releases.slice(scrollStart, scrollStart + visibleRows)

	return (
		<>
			{visible.map((release, idx) => {
				const actualIndex = scrollStart + idx
				return <ReleaseListRow key={release.id} release={release} rowWidth={rowWidth} isSelected={actualIndex === selectedIndex} isLatest={state.latestReleaseId === release.id} />
			})}
			{visible.length < visibleRows ? <Filler rows={visibleRows - visible.length} prefix="releases-pad" /> : null}
			{reserveLoadMore ? (
				<PlainLine
					text={centerCell(state.loadingMore ? `${loadingIndicator} Loading more…` : `↓ ${state.releases.length} loaded — press ] for more`, rowWidth)}
					fg={colors.muted}
				/>
			) : null}
		</>
	)
}

const AssetRow = ({ asset, rowWidth }: { asset: ReleaseAsset; rowWidth: number }) => {
	const right = `${formatBytes(asset.size)}  ${asset.downloadCount}↓`
	const rightWidth = Math.min(20, right.length + 1)
	const nameWidth = Math.max(1, rowWidth - rightWidth - 1)
	return (
		<TextLine width={rowWidth} fg={colors.text}>
			<span fg={colors.muted}>·</span>
			<span> </span>
			<span fg={colors.text}>{fitCell(asset.name, nameWidth)}</span>
			<span fg={colors.muted}>{fitCell(right, rightWidth, "right")}</span>
		</TextLine>
	)
}

const ReleaseDetailsBody = ({ state, rowWidth, bodyHeight, loadingIndicator }: { state: ReleasesModalState; rowWidth: number; bodyHeight: number; loadingIndicator: string }) => {
	const messageTopRows = Math.max(0, Math.floor((bodyHeight - 1) / 2))
	const messageBottomRows = Math.max(0, bodyHeight - messageTopRows - 1)

	if (state.detailsLoading && !state.detailsRelease) {
		return (
			<>
				<Filler rows={messageTopRows} prefix="rel-detail-top" />
				<PlainLine text={centerCell(`${loadingIndicator} Loading release…`, rowWidth)} fg={colors.muted} />
				<Filler rows={messageBottomRows} prefix="rel-detail-bottom" />
			</>
		)
	}

	if (state.detailsError && !state.detailsRelease) {
		return (
			<>
				<Filler rows={messageTopRows} prefix="rel-detail-top" />
				<PlainLine text={centerCell(state.detailsError, rowWidth)} fg={colors.error} />
				<Filler rows={messageBottomRows} prefix="rel-detail-bottom" />
			</>
		)
	}

	const release = state.detailsRelease
	if (!release) {
		return (
			<>
				<Filler rows={messageTopRows} prefix="rel-detail-top" />
				<PlainLine text={centerCell("No release selected", rowWidth)} fg={colors.muted} />
				<Filler rows={messageBottomRows} prefix="rel-detail-bottom" />
			</>
		)
	}

	// Build the body: header lines + body wrapped + asset list.
	const isLatest = state.latestReleaseId === release.id
	const tokens = releaseStatusTokens(release, isLatest)

	const headerLines: React.ReactNode[] = []
	headerLines.push(
		<TextLine key="title" width={rowWidth}>
			<span fg={colors.accent} attributes={TextAttributes.BOLD}>
				{fitCell(release.name && release.name.length > 0 ? release.name : release.tagName, rowWidth)}
			</span>
		</TextLine>,
	)
	headerLines.push(
		<TextLine key="meta" width={rowWidth}>
			<span
				fg={colors.muted}
			>{`${release.tagName}  ·  ${formatReleaseDate(release.publishedAt ?? release.createdAt)}${release.author ? `  ·  @${release.author.login}` : ""}  ·  → ${release.targetCommitish}`}</span>
		</TextLine>,
	)
	if (tokens.length > 0) {
		headerLines.push(
			<TextLine key="badges" width={rowWidth}>
				{tokens.flatMap((token, idx) => [
					<span key={`tok-${idx}`} fg={token.fg}>
						{token.text}
					</span>,
					...(idx < tokens.length - 1 ? [<span key={`sep-${idx}`}>{"  "}</span>] : []),
				])}
			</TextLine>,
		)
	}
	headerLines.push(<PlainLine key="spacer" text="" />)

	const wrapped = wrapBody(release.body || "_(no description)_", rowWidth)
	const bodyAvailable = Math.max(1, bodyHeight - headerLines.length - (release.assets.length > 0 ? release.assets.length + 2 : 0))
	const totalLines = wrapped.length
	const maxScroll = Math.max(0, totalLines - bodyAvailable)
	const scrollOffset = Math.max(0, Math.min(state.detailsScrollOffset, maxScroll))
	const visibleBody = wrapped.slice(scrollOffset, scrollOffset + bodyAvailable)

	const bodyLines = visibleBody.map((line, idx) => <PlainLine key={`body-${idx}`} text={fitCell(line, rowWidth)} fg={colors.text} />)
	const padBody = bodyAvailable - visibleBody.length
	if (padBody > 0) {
		bodyLines.push(<Filler key="body-pad" rows={padBody} prefix="rel-body-pad" />)
	}

	const assetLines: React.ReactNode[] =
		release.assets.length > 0
			? [
					<PlainLine key="assets-head" text={fitCell(`Assets (${release.assets.length})`, rowWidth)} fg={colors.muted} bold />,
					...release.assets.map((asset) => <AssetRow key={asset.id} asset={asset} rowWidth={rowWidth} />),
					<PlainLine key="assets-spacer" text="" />,
				]
			: []

	return (
		<>
			{headerLines}
			{bodyLines}
			{assetLines}
		</>
	)
}

export const ReleasesModal = ({ state, modalWidth, modalHeight, offsetLeft, offsetTop, loadingIndicator }: ReleasesModalProps) => {
	const innerWidth = Math.max(16, modalWidth - 2)
	const contentWidth = Math.max(14, innerWidth - 2)
	const bodyHeight = Math.max(2, modalHeight - 6)
	const rowWidth = innerWidth

	const repoText = state.repository ? shortRepoName(state.repository) : "no repository"
	const subtitleText =
		state.panel === "list"
			? `${repoText}  ·  ${state.releases.length} release${state.releases.length === 1 ? "" : "s"}${state.hasNextPage ? "+" : ""}`
			: state.detailsRelease
				? `${repoText}  ·  ${state.detailsRelease.tagName}`
				: repoText

	const showSpinner = (state.panel === "list" && state.loading) || (state.panel === "details" && state.detailsLoading)

	return (
		<StandardModal
			left={offsetLeft}
			top={offsetTop}
			width={modalWidth}
			height={modalHeight}
			title={state.panel === "list" ? "Releases" : "Release"}
			{...(showSpinner ? { headerRight: { text: loadingIndicator, pending: true } } : {})}
			subtitle={
				<TextLine>
					<span fg={colors.muted}>{fitCell(subtitleText, contentWidth)}</span>
				</TextLine>
			}
			footer={
				<HintRow
					items={
						state.panel === "list"
							? [
									{ key: "↑↓", label: "move" },
									{ key: "enter", label: "view" },
									{ key: "o", label: "browser" },
									{ key: "y", label: "copy url" },
									{ key: "]", label: "more" },
									{ key: "r", label: "refresh" },
									{ key: "esc", label: "close" },
								]
							: [
									{ key: "↑↓", label: "scroll" },
									{ key: "o", label: "browser" },
									{ key: "y", label: "copy url" },
									{ key: "esc", label: "back" },
								]
					}
				/>
			}
		>
			{state.panel === "list" ? (
				<ReleasesListBody state={state} rowWidth={rowWidth} bodyHeight={bodyHeight} loadingIndicator={loadingIndicator} />
			) : (
				<ReleaseDetailsBody state={state} rowWidth={rowWidth} bodyHeight={bodyHeight} loadingIndicator={loadingIndicator} />
			)}
		</StandardModal>
	)
}
