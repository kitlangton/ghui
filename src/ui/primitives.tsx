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
