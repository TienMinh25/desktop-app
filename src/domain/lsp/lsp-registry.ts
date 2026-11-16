import type { LspServerProfile } from "../../contracts/lsp"

export const LSP_SERVER_CATALOG: LspServerProfile[] = [
  {
    id: "go",
    name: "gopls",
    language: "Go",
    description: "Code navigation and diagnostics for Go files.",
    extensions: [".go"],
    command: "gopls",
    args: [],
    languageId: "go",
    installCommand: "go install golang.org/x/tools/gopls@latest",
    guideUrl: "https://go.dev/gopls/",
  },
  {
    id: "typescript",
    name: "TypeScript Language Server",
    language: "TypeScript / JavaScript",
    description: "Code navigation and diagnostics for TypeScript and JavaScript.",
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    command: "typescript-language-server",
    args: ["--stdio"],
    installCommand: "npm install -g typescript-language-server typescript",
    guideUrl: "https://github.com/typescript-language-server/typescript-language-server",
  },
  {
    id: "python",
    name: "Pyright",
    language: "Python",
    description: "Code navigation and diagnostics for Python files.",
    extensions: [".py", ".pyi"],
    command: "pyright-langserver",
    args: ["--stdio"],
    languageId: "python",
    installCommand: "npm install -g pyright",
    guideUrl: "https://github.com/microsoft/pyright/blob/main/docs/installation.md",
  },
  {
    id: "rust",
    name: "rust-analyzer",
    language: "Rust",
    description: "Code navigation and diagnostics for Rust files.",
    extensions: [".rs"],
    command: "rust-analyzer",
    args: [],
    languageId: "rust",
    installCommand: "rustup component add rust-analyzer",
    guideUrl: "https://rust-analyzer.github.io/book/installation.html",
  },
]

export const LSP_SERVER_PROFILE_IDS = new Set(LSP_SERVER_CATALOG.map((profile) => profile.id))
