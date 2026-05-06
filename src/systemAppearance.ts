import type { ThemeTone } from "./ui/colors.js"

export type SystemAppearance = ThemeTone

const runCommand = async (command: readonly [string, ...string[]]) => {
	const [cmd, ...args] = command
	const proc = Bun.spawn([cmd, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	})
	const output = await Bun.readableStreamToText(proc.stdout)
	const exitCode = await proc.exited
	return exitCode === 0 ? output.trim() : ""
}

export const appearanceFromLinuxSetting = (value: string): SystemAppearance | null => {
	const normalized = value.trim().replaceAll("'", "").replaceAll('"', "").toLowerCase()
	if (normalized.includes("dark")) return "dark"
	if (normalized.includes("light") || normalized === "default") return "light"
	return null
}

const detectMacAppearance = async (): Promise<SystemAppearance> => {
	const output = await runCommand(["defaults", "read", "-g", "AppleInterfaceStyle"])
	return output.trim() === "Dark" ? "dark" : "light"
}

const detectLinuxAppearance = async (): Promise<SystemAppearance> => {
	for (const command of [
		["gsettings", "get", "org.gnome.desktop.interface", "color-scheme"],
		["gsettings", "get", "org.gnome.desktop.interface", "gtk-theme"],
	] as const) {
		const appearance = appearanceFromLinuxSetting(await runCommand(command))
		if (appearance) return appearance
	}
	return "dark"
}

export const detectSystemAppearance = async (): Promise<SystemAppearance> => {
	try {
		if (process.platform === "darwin") return await detectMacAppearance()
		if (process.platform === "linux") return await detectLinuxAppearance()
	} catch {
		return "light"
	}

	return "dark"
}
