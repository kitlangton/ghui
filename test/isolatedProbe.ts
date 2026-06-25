export const runIsolatedProbe = async (source: string, env: Record<string, string | undefined> = {}): Promise<string> => {
	const process = Bun.spawn(["bun", "--eval", source], {
		cwd: new URL("..", import.meta.url).pathname,
		env: { ...Bun.env, ...env },
		stdout: "pipe",
		stderr: "pipe",
	})
	const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited])
	if (exitCode !== 0) throw new Error(`Isolated probe exited with code ${exitCode}:\n${stderr}`)
	return stdout.trim()
}
