# Harness permissions, tests, and home root Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-selectable approval modes, make a workspace optional with the user's home as fallback, and establish behavior-focused unit tests across the harness.

**Architecture:** `harness/permissions` owns policy and approval resolution. The chat command carries one typed approval mode; runtime resolves the optional workspace once and passes the resolved root to all execution dependencies. Bun's built-in test runner exercises harness modules at their public boundaries.

**Tech Stack:** TypeScript, Electron IPC contracts, Bun test runner.

**Spec:** `docs/superpowers/specs/2026-11-05-approval-modes-and-home-workspace-design.md`

## Global Constraints

- Keep one repository and Bun project; add no test dependency.
- `manual` is the default approval mode.
- Explicit permission `deny` always blocks.
- Missing or blank workspace resolves to `homedir()`.
- `LocalExecutionEnvironment` is not an OS sandbox.
- Keep conversation persistence in memory until a SQLite schema is supplied.
- Use explicit TypeScript types for cross-module data and behavior inputs.

## Review Focus

- Explicit deny stays effective under full-access — test in Task 1.
- Auto-safe still prompts for policy-ask operations — test in Task 1.
- Manual does not silently approve policy-allow operations — test in Task 1.
- Missing and blank workspace paths both resolve to home — test in Task 2.
- Execution rejects paths escaping the effective root unless a tool permission flow authorizes them — test in Task 2 and tool tests.

---

### Task 1: Centralize permission policy and approval modes

**Files:**
- Create: `src/contracts/permissions.ts`
- Create: `src/harness/permissions/permission-manager.ts`
- Create: `tests/harness/permissions/permission-manager.test.ts`
- Modify: `src/harness/agent/tool-registry.ts`
- Modify: `src/harness/runtime.ts`
- Modify: `src/harness-server/index.ts`
- Modify: `src/desktop/renderer/pages/WorkspacePage/WorkspacePage.tsx`
- Modify: `src/desktop/renderer/pages/WorkspacePage/components/PromptBar.tsx`
- Modify: `src/desktop/renderer/pages/WorkspacePage/components/PromptBar.module.scss`
- Modify: `package.json`
- Remove: `src/harness/agent/permission-manager.ts`

**Interfaces:**
- `ApprovalMode = "manual" | "auto-safe" | "full-access"` in shared contracts.
- `PermissionDecision = "allow" | "ask" | "deny"` remains an internal policy result.
- `PermissionManager.request(request: PermissionRequest, mode: ApprovalMode): Promise<void>` applies policy first, then approval mode.
- `SubmitPromptCommand.approvalMode: ApprovalMode` transports the user's per-turn choice.

- [x] Run the already-added permission mode test and confirm it fails because the target permission module/API is missing.
- [x] Add cases for explicit deny, ordered allow/ask/deny rules, sensitive reads, and outside-workspace reads.
- [x] Move the permission manager, permission requirement type, and rule parser into `harness/permissions/`; retain deny precedence and ordered rules.
- [x] Pass the selected mode through runtime and render a selector labeled “Ask every time”, “Auto-approve safe operations”, and “Full access”, defaulting to manual.
- [x] Add the `bun test` script and verify focused tests, full suite, typecheck, and production build.

### Task 2: Make workspace optional and use home as the implicit root

**Files:**
- Modify: `src/contracts/commands.ts`
- Modify: `src/contracts/guards.ts`
- Modify: `src/harness/runtime.ts`
- Modify: `src/desktop/renderer/pages/WorkspacePage/WorkspacePage.tsx`
- Modify: `src/harness/execution/local-execution-environment.ts`
- Create: `tests/harness/runtime/workspace-resolution.test.ts`
- Create: `tests/harness/execution/local-execution-environment.test.ts`

**Interfaces:**
- `SubmitPromptCommand.workspacePath?: string` permits an omitted path.
- `resolveWorkspacePath(workspacePath: string | undefined, homeDirectory: string): string` uses `homeDirectory` for missing or whitespace-only values.
- `HarnessRuntimeOptions.createExecutionEnvironment(workspacePath: string): ExecutionEnvironment` receives only the normalized absolute path.

- [x] Add a runtime integration test for omitted workspace, assert the home root reaches environment creation and the pre-prompt hook; observed expected failure from the old workspace-required guard.
- [x] Add execution-boundary tests for within/outside root resolution, symlink write rejection, bounded reads, missing parents, and patch traversal.
- [x] Remove the renderer's workspace-required guard and allow prompt submission without a selected folder.
- [x] Normalize the workspace once in runtime with Node `homedir()` and use that value consistently for the environment, prompt hook, and context.
- [x] Run focused tests and typecheck.

### Task 3: Test conversation store, tool registry, and agent loop

**Files:**
- Create: `tests/harness/session/in-memory-conversation-store.test.ts`
- Create: `tests/harness/agent/tool-registry.test.ts`
- Create: `tests/harness/agent/agent-loop.test.ts`
- Modify: `src/harness/session/*` and `src/harness/agent/*` only when tests expose a defect.

**Interfaces:**
- Tests exercise `ConversationStore`, `ToolRegistry.execute`, and `AgentLoop.run` through exported methods and typed harness context.

- [x] Write tests for clone isolation and per-session storage behavior.
- [x] Write tests for malformed/unknown tool calls, permission-before-execution ordering, tool errors, and returned tool messages.
- [x] Write tests for streamed text, fragmented tool calls, round limits, and tool failure reporting.
- [x] Run focused tests and the full harness suite; keep changes green.

### Task 4: Test every built-in tool at its public behavior boundary

**Files:**
- Create: `tests/harness/tools/{read,write,edit,glob,grep,bash,apply-patch,lsp,webfetch,todowrite,skill}-tool.test.ts`
- Modify: `src/harness/tools/*` only when tests expose a defect.

**Interfaces:**
- Tool tests use a real temporary directory and `LocalExecutionEnvironment` where applicable; external network/process edges are replaced only when unavoidable.

- [x] Cover validation, permission metadata, successful result, and relevant limits/errors for each tool.
- [x] Cover workspace escapes, sensitive files, ambiguous edits, bounded search, shell timeout/output, invalid patch paths, HTTP redirect/size/content type, todo update events, and skill file bounds.
- [x] Run every tool test and the full harness test suite.

### Task 5: Test MCP/LSP protocol adapters and complete documentation

**Files:**
- Create: `tests/harness/mcp/mcp-stdio-client.test.ts`
- Create: `tests/harness/mcp/mcp-tool-host.test.ts`
- Create: `tests/harness/lsp/lsp-client.test.ts`
- Create: `tests/harness/lsp/lsp-manager.test.ts`
- Modify: `docs/harness-design.md`
- Modify: `README.md`

**Interfaces:**
- Protocol tests assert framing, request/response correlation, malformed-message handling, tool discovery, diagnostics, and cleanup through the public client/manager API.

- [x] Use controlled child-process fixtures to test stdio behavior without network access or installed language servers.
- [x] Add harness tests for runtime error, storage isolation, cleanup, and request queue behavior.
- [x] Update design docs to state approval mode vs policy decision, home fallback, test command, and execution-vs-sandbox distinction.
- [x] Run `bun test`, `bun run typecheck`, `bun run build`, and `git diff --check`.
