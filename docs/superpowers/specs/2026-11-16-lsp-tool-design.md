# LSP tool design

## Intent

Make the existing `lsp` tool dependable and understandable for the model and the user. Its operations remain implemented in the harness; user configuration is now managed in Customize → Language Servers as described in [`2026-11-17-lsp-server-management.md`](2026-11-17-lsp-server-management.md). The harness does not install language servers.

## Goals

- Keep the current `definition`, `references`, `hover`, and `diagnostics` operations.
- Give actionable errors for bad configuration and unavailable servers, and discard failed clients so a later call can retry.
- Avoid returning stale diagnostics after a document change, and distinguish diagnostics that timed out from an empty diagnostic list.
- Keep result output valid JSON when it exceeds the tool output budget.
- Describe every shipped static and dynamic tool's capability, limits, permission behavior, and important caveats in `docs/tools.md`.

## Non-goals

- Adding more LSP operations, automatic server installation, or remote transports.
- Replacing the stdio protocol implementation or changing the general permission system.
- Addressing the broader network/SSRF limitations of `webfetch` in this change.

## Constraints

- LSP servers remain external executables; the app detects and configures them but does not install them.
- Keep the implementation dependency-free and follow the repository's existing TypeScript/Bun patterns.
- Every LSP request continues to require the existing `lsp` permission for the resolved file.
- `docs/tools.md` remains a concise Vietnamese reference and documents current behavior, not planned UI behavior.

## Approaches

1. **Reliability pass on the current operations (chosen).** Fix process cache recovery, diagnostics freshness/timeout signaling, and bounded JSON output while preserving the existing API. This addresses concrete correctness failures without expanding protocol scope.
2. **Adopt a full LSP client library.** It would provide broader protocol coverage but adds dependency and packaging work and does not itself supply language servers.
3. **Expand to a full editor-like LSP surface.** Add completion, symbols, rename, code actions, and workspace edits. This has a wider API and permission surface than the current tool needs; defer until a concrete agent workflow requires it.

## Design decisions

- Keep the four current operations and one-file input contract.
- A failed or exited client is removed from manager cache; the next query may spawn a fresh process.
- Diagnostics cache is invalidated on text changes; callers receive a structured timeout state when the server does not publish within the existing 1.5-second wait.
- Limit serialized results to 30,000 UTF-8 bytes. Truncated results remain valid JSON and state that truncation occurred.
- Enumerate all tools in `docs/tools.md`: static harness tools, configured MCP tools, user-provided files, and planned `@` references, clearly distinguishing shipped from planned behavior.
- Successful diagnostics preserve the existing array result; only a timeout returns `{ "diagnostics": [...], "timedOut": true }`, distinguishing no publication from an empty published list.
- Client health is exposed as a read-only `isRunning` predicate and the manager removes unhealthy clients from its cache.
- Oversize results return `{ "truncated": true, "preview": "<prefix of serialized JSON>" }` within the same byte budget.

## Follow-up state (2026-11-17)

The original design assumed users would set `LSP_SERVERS` manually. The approved app-managed settings flow now supersedes that assumption: users manage local profiles in Customize → Language Servers, while the app still does not install executables. See [`2026-11-17-lsp-server-management.md`](2026-11-17-lsp-server-management.md) for the current setup and runtime contract.

## Review reference

The adjacent OpenCode checkout documents a broader LSP surface and built-in server discovery, but this project's scope stays with its implemented four operations and manual server configuration. OpenCode's current source checkout also contains TODOs for an LSP runtime, so its docs are a design reference rather than proof that all documented features currently execute there.
