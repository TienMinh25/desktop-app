# Harness tool ecosystem and user question design

## Objective

Continue the course-led coding harness with course-order guidance, explicit permission boundaries, production-grade protocol/search libraries where selected, and an OpenCode-style user question interaction. Database persistence waits for the schema supplied by the project owner. Build and distribution tooling is explicitly deferred for the owner to decide later.

## Decisions from the owner

- Keep `read`, `write`, `edit`, `glob`, `grep`, `bash`, `apply_patch`, `lsp`, `webfetch`, and `todowrite`; add `question`.
- Use `@vscode/ripgrep` for `glob` and `grep`.
- Use the official `@modelcontextprotocol/client` SDK for MCP.
- Check the complete dependency graph for known CVEs and report the point-in-time result.
- Keep LSP server support configurable; the owner will decide which language servers to provide.
- Do not decide or change the packaging/build approach in this work.
- The `read` tool may read absolute paths outside the selected workspace after permission approval.

## Architecture and behavior

`question` pauses the agent and displays an inline free-form answer form in the current conversation. Optional choices are suggestions; the user can still provide another answer. A typed question response IPC contract and request ID route the answer back to the exact waiting tool call. Expired or stale responses cannot resolve another question. This interaction stays separate from resource permissions; manual permission prompts retain Allow once / Deny.

`glob` and `grep` use the platform binary supplied by `@vscode/ripgrep` and execute it directly without a shell. They operate under the effective workspace root, exclude common generated/dependency folders, and apply bounded output/time limits. Glob reports matching files and non-empty directories derivable from ripgrep's file list. Grep retains sensitive-resource permission checks.

MCP uses the official TypeScript client and stdio transport. Legacy protocol negotiation preserves compatibility with 2025 servers. Namespacing, app-level configuration validation, schema bounds, and per-call approval remain in the app adapter.

`apply_patch` uses the pure JavaScript `diff` package and does not require a Git executable. It supports standard unified diff modification, file creation, and deletion; rename/copy operations are rejected.

The application permission engine is not an OS sandbox. `bash` runs with the desktop user's OS authority. `ExecutionEnvironment` remains the replaceable boundary for future OS-level sandboxing.

LSP support is supplied by user-configured language server executables and file-extension mappings. No language server is bundled or installed. Built-in fallback IDs map TypeScript, TSX, JavaScript, JSX, Python, Rust, and Go; this mapping does not imply a server is available.

## Security and verification

Run `bun audit` against the full lockfile after dependency changes and before release. State the audit date and result, and note that this only covers published advisories available to the scanner at that time.

Required checks for implementation changes: focused tests, full `bun test`, `bun run typecheck`, and `bun run build`. Packaging is not part of the acceptance criteria until the owner chooses it.

## References

- [Course outline](https://github.com/decodingai-magazine/building-a-coding-agent-from-scratch-course#-course-outline)
- [OpenCode v2 permissions](https://opencode.ai/v2/docs/permissions)
- [OpenCode v2 tools and question interaction](https://dev.opencode.ai/v2/docs/tools)
- [Official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [VS Code ripgrep wrapper](https://github.com/microsoft/vscode-ripgrep)
- [jsdiff patch API](https://github.com/kpdecker/jsdiff)
