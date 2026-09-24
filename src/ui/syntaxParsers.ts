import type { FiletypeParserOptions } from "@opentui/core"

const treeSitterGrammar = (filetype: string, repository: string, version: string): FiletypeParserOptions => {
	const name = repository.split("/").at(-1)
	return {
		filetype,
		wasm: `https://github.com/${repository}/releases/download/${version}/${name}.wasm`,
		queries: {
			highlights: [`https://raw.githubusercontent.com/${repository}/${version}/queries/highlights.scm`],
		},
	}
}

// Grammars on top of the ones OpenTUI bundles (JavaScript, TypeScript, Markdown, Zig).
// OpenTUI downloads each on first use and caches it on disk.
export const syntaxParsers: FiletypeParserOptions[] = [
	{ ...treeSitterGrammar("bash", "tree-sitter/tree-sitter-bash", "v0.25.1"), aliases: ["sh", "shell", "zsh", "ksh"] },
	treeSitterGrammar("go", "tree-sitter/tree-sitter-go", "v0.25.0"),
	treeSitterGrammar("python", "tree-sitter/tree-sitter-python", "v0.25.0"),
	treeSitterGrammar("json", "tree-sitter/tree-sitter-json", "v0.24.8"),
	treeSitterGrammar("yaml", "tree-sitter-grammars/tree-sitter-yaml", "v0.7.2"),
	treeSitterGrammar("toml", "tree-sitter-grammars/tree-sitter-toml", "v0.7.0"),
]
