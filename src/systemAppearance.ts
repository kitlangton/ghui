import type { ThemeTone } from "./ui/colors.js"

export type SystemAppearance = ThemeTone

const detectMacAppearance = async (): Promise<SystemAppearance> => {
	const proc = Bun.spawn(["defaults", "read", "-g", "AppleInterfaceStyle"], {
		stdout: "pipe",
		stderr: "pipe",
	})
	const output = await Bun.readableStreamToText(proc.stdout)
	await proc.exited
	return output.trim() === "Dark" ? "dark" : "light"
}

export const detectSystemAppearance = async (): Promise<SystemAppearance> => {
	try {
		if (process.platform === "darwin") return await detectMacAppearance()
	} catch {
		return "light"
	}

	return "dark"
}
