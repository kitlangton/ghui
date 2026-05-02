import { TextAttributes } from "@opentui/core"
import type React from "react"
import { colors } from "./colors.js"

export const fitCell = (text: string, width: number, align: "left" | "right" = "left") => {
	const trimmed = text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text
	return align === "right" ? trimmed.padStart(width, " ") : trimmed.padEnd(width, " ")
}

export const trimCell = (text: string, width: number) => text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text

export const centerCell = (text: string, width: number) => {
	const trimmed = text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text
	const left = Math.floor((width - trimmed.length) / 2)
	return `${" ".repeat(Math.max(0, left))}${trimmed}`.padEnd(width, " ")
}

export const PlainLine = ({ text, fg = colors.text, bold = false }: { text: string; fg?: string; bold?: boolean }) => (
	<box height={1}>
		{bold ? (
			<text wrapMode="none" truncate fg={fg} attributes={TextAttributes.BOLD}>
				{text}
			</text>
		) : (
			<text wrapMode="none" truncate fg={fg}>
				{text}
			</text>
		)}
	</box>
)

export const TextLine = ({ children, fg = colors.text, bg, width }: { children: React.ReactNode; fg?: string; bg?: string | undefined; width?: number }) => (
	<box height={1} {...(width === undefined ? {} : { width })}>
		{bg ? (
			<text wrapMode="none" truncate fg={fg} bg={bg}>
				{children}
			</text>
		) : (
			<text wrapMode="none" truncate fg={fg}>
				{children}
			</text>
		)}
	</box>
)

export const SectionTitle = ({ title }: { title: string }) => (
	<TextLine>
		<span fg={colors.accent} attributes={TextAttributes.BOLD}>
			{title}
		</span>
	</TextLine>
)

export const Filler = ({ rows, prefix }: { rows: number; prefix: string }) =>
	<>{Array.from({ length: rows }, (_, index) => <box key={`${prefix}-${index}`} height={1} />)}</>

export const PaddedRow = ({ children, backgroundColor }: { children: React.ReactNode; backgroundColor?: string }) => (
	<box height={1} paddingLeft={1} paddingRight={1} {...(backgroundColor ? { backgroundColor } : {})}>{children}</box>
)

export const Divider = ({ width, junctionAt, junctionChar }: { width: number; junctionAt?: number; junctionChar?: string }) => {
	if (junctionAt === undefined || junctionChar === undefined || junctionAt < 0 || junctionAt >= width) {
		return <PlainLine text={"─".repeat(Math.max(1, width))} fg={colors.separator} />
	}

	return <PlainLine text={`${"─".repeat(junctionAt)}${junctionChar}${"─".repeat(Math.max(0, width - junctionAt - 1))}`} fg={colors.separator} />
}

export const SeparatorColumn = ({ height, junctionRows }: { height: number; junctionRows?: readonly number[] }) => {
	const junctions = new Set(junctionRows)
	return (
		<box width={1} height={height} flexDirection="column">
			{Array.from({ length: height }, (_, index) => (
				<PlainLine key={index} text={junctions.has(index) ? "├" : "│"} fg={colors.separator} />
			))}
		</box>
	)
}

export type StandardModalDims = {
	readonly innerWidth: number
	readonly contentWidth: number
	readonly bodyHeight: number
	readonly rowWidth: number
}

export const standardModalDims = (modalWidth: number, modalHeight: number): StandardModalDims => {
	const innerWidth = Math.max(16, modalWidth - 2)
	const contentWidth = Math.max(14, innerWidth - 2)
	const bodyHeight = Math.max(1, modalHeight - 7)
	return { innerWidth, contentWidth, bodyHeight, rowWidth: innerWidth }
}

export type HintItem = {
	readonly key: string
	readonly label: string
	readonly when?: boolean
	readonly keyFg?: string
}

export const HintRow = ({ items }: { items: readonly HintItem[] }) => {
	const visible = items.filter((item) => item.when !== false)
	return (
		<TextLine>
			{visible.flatMap((item, index) => [
				<span key={`k${index}`} fg={item.keyFg ?? colors.count}>{item.key}</span>,
				<span key={`l${index}`} fg={colors.muted}>{` ${item.label}${index < visible.length - 1 ? "  " : ""}`}</span>,
			])}
		</TextLine>
	)
}

export const StandardModal = ({
	left,
	top,
	width,
	height,
	title,
	titleFg = colors.accent,
	headerRight,
	subtitle,
	footer,
	bodyPadding = 0,
	children,
}: {
	left: number
	top: number
	width: number
	height: number
	title: string
	titleFg?: string
	headerRight?: { readonly text: string; readonly pending?: boolean }
	subtitle: React.ReactNode
	footer: React.ReactNode
	bodyPadding?: number
	children: React.ReactNode
}) => {
	const { innerWidth, contentWidth, bodyHeight } = standardModalDims(width, height)
	const rightText = headerRight?.text ?? ""
	const headerGap = Math.max(1, contentWidth - title.length - rightText.length)
	return (
		<ModalFrame left={left} top={top} width={width} height={height} junctionRows={[2, height - 4]}>
			<PaddedRow>
				<TextLine>
					<span fg={titleFg} attributes={TextAttributes.BOLD}>{title}</span>
					{headerRight ? (
						<>
							<span fg={colors.muted}>{" ".repeat(headerGap)}</span>
							<span fg={headerRight.pending ? colors.status.pending : colors.muted}>{headerRight.text}</span>
						</>
					) : null}
				</TextLine>
			</PaddedRow>
			<PaddedRow>{subtitle}</PaddedRow>
			<Divider width={innerWidth} />
			<box height={bodyHeight} flexDirection="column" paddingLeft={bodyPadding} paddingRight={bodyPadding}>{children}</box>
			<Divider width={innerWidth} />
			<PaddedRow>{footer}</PaddedRow>
		</ModalFrame>
	)
}

export const ModalFrame = ({
	children,
	left,
	top,
	width,
	height,
	junctionRows = [],
	backgroundColor = colors.modalBackground,
}: {
	children: React.ReactNode
	left: number
	top: number
	width: number
	height: number
	junctionRows?: readonly number[]
	backgroundColor?: string
}) => {
	const innerWidth = Math.max(1, width - 2)
	const innerHeight = Math.max(1, height - 2)
	const junctions = new Set(junctionRows)

	return (
		<box position="absolute" left={left} top={top} width={width} height={height} flexDirection="column" backgroundColor={backgroundColor}>
			<PlainLine text={`┌${"─".repeat(innerWidth)}┐`} fg={colors.separator} />
			<box height={innerHeight} flexDirection="row">
				<box width={1} height={innerHeight} flexDirection="column">
					{Array.from({ length: innerHeight }, (_, index) => <PlainLine key={index} text={junctions.has(index) ? "├" : "│"} fg={colors.separator} />)}
				</box>
				<box width={innerWidth} height={innerHeight} flexDirection="column">
					{children}
				</box>
				<box width={1} height={innerHeight} flexDirection="column">
					{Array.from({ length: innerHeight }, (_, index) => <PlainLine key={index} text={junctions.has(index) ? "┤" : "│"} fg={colors.separator} />)}
				</box>
			</box>
			<PlainLine text={`└${"─".repeat(innerWidth)}┘`} fg={colors.separator} />
		</box>
	)
}
