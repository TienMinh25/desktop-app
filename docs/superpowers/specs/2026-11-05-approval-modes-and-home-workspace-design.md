# Approval modes and implicit home workspace

## Intent

Give users a clear choice between approving every operation, automatically approving policy-safe operations, and automatically approving all operations allowed by policy. Keep those user-facing approval modes separate from the internal `allow` / `ask` / `deny` permission policy. Let a prompt run without a picked workspace by using the user's home directory as its execution root.

## Goals

- Add typed approval modes: `manual`, `auto-safe`, and `full-access`.
- Keep permission evaluation in `src/harness/permissions/` and make it the sole place that combines internal policy with the user-selected approval mode.
- Keep explicit policy `deny` effective in every mode.
- Make `manual` ask the user for every non-denied operation; make `auto-safe` automatically accept only policy `allow`; make `full-access` automatically accept policy `allow` and `ask`.
- Make workspace selection optional. Resolve a missing or blank path to Node's `homedir()` consistently for execution, tool context, and prompt hooks.
- Add automated unit tests for harness behavior, especially permissions, execution boundary, tool registry, tools, runtime, storage, and MCP/LSP adapters.
- Preserve explicit TypeScript contracts and document the names in plain language.

## Non-goals

- This work does not create OS-level isolation. The local execution adapter still runs under the desktop user's OS account.
- It does not add database persistence; conversation storage remains in memory until the SQLite schema is supplied.
- It does not add approval grants that persist beyond a single tool call.

## Approaches considered

1. **Central approval-mode layer (chosen):** preserve ordered permission rules and their `allow` / `ask` / `deny` result, then apply the user's approval mode centrally. This keeps tool implementations independent of UI behavior and keeps `deny` authoritative.
2. **Teach each tool about approval modes:** rejected because every tool would need duplicated policy branching and new tools could silently diverge.
3. **Replace rules with three global modes:** rejected because users lose fine-grained internal `allow` / `ask` / `deny` controls and ordered exceptions.

## Behavior

`manual` is the default. Policy `deny` rejects in all modes. For a non-denied policy result, `manual` requests user approval, `auto-safe` auto-approves `allow` and asks for `ask`, and `full-access` auto-approves both. The three modes are included in the typed chat-submit command and selected in the prompt UI. Selecting full access remains an explicit user choice for that turn.

When `workspacePath` is absent or blank, runtime uses `homedir()` and passes that resolved root consistently to the environment factory, pre-prompt hook, and tool context. An explicitly selected workspace continues to be used as-is after environment validation.

## Testing and implementation choices

- Use Bun's built-in test runner; no new test dependency is needed.
- Write behavior tests first and observe the expected failure before production changes.
- Keep tests under `tests/harness/`, mirroring core harness modules.
- Move permission types and manager out of `harness/agent/` into `harness/permissions/`; `agent` describes model/tool orchestration, while `permissions` describes authorization policy and approvals.
- Keep `harness/execution/` as the OS-operation boundary, named for execution backends (local now, sandboxed/remote later), not as a claim that the current adapter is a sandbox.
- Use explicit named TypeScript types for approval mode, permission policy inputs, and workspace resolution.

## Review focus

- An explicit deny rule must remain denied in full-access mode.
- Auto-safe must still ask for sensitive or out-of-workspace operations when their final policy is `ask`.
- Manual mode must not silently pass policy-allowed reads.
- Missing and whitespace-only workspace paths must resolve to the same home root.
- A tool must not access a path outside its effective workspace without the appropriate permission request.

## User-facing naming

UI labels should state the user action directly: **Ask every time**, **Auto-approve safe operations**, and **Full access**. Internal names are `manual`, `auto-safe`, and `full-access`. “Mode” describes the user's approval behavior; “decision” describes the permission engine's per-operation result.
