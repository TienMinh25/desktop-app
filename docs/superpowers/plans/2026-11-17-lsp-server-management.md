# LSP Server Management UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give users an in-app way to detect, enable, configure, and receive setup guidance for local LSP servers.

**Architecture:** A shared app-owned catalog defines supported servers. Electron main owns executable detection and a JSON settings file in `userData`; the renderer accesses it through narrow preload APIs. The main process sends normalized configuration to the harness, whose LSP manager swaps configuration live. Customize gains a Language Servers tab and the workspace empty state gets a deep link to it.

**Tech Stack:** Electron IPC, TypeScript, React, Zod, Node filesystem/process APIs.

**Spec:** `docs/superpowers/specs/2026-11-17-lsp-server-management.md`

## Global Constraints

- Do not download or install executables in-app.
- Keep four LSP operations and the existing per-file permission gate.
- Keep custom server arguments as argv; never pass them through a shell.
- Persist settings in Electron `userData`, not repository files or environment variables.
- Do not register the LSP tool in model definitions when no enabled server can launch.

## Review Focus

- Packaged apps may have a restricted PATH; search the inherited PATH and standard user install folders.
- Missing custom binaries must remain editable and show a recoverable status.
- Settings changes during an active harness lifetime must affect subsequent model turns without leaking old clients.
- A server that is installed but disabled must not be used or advertised.
- Workspace shortcut must not claim LSP is unavailable when Customize is already the source of truth.

---

### Task 1: Define registry, settings contracts, detection, and persistence

**Files:**
- Create: `src/contracts/lsp.ts`
- Create: `src/domain/lsp/lsp-registry.ts`
- Create: `src/desktop/main/lsp-settings-store.ts`
- Modify: `src/desktop/constants/ipcChannels.ts`

**Interfaces:**
- `LspServerProfile` describes built-in/custom profiles and setup guidance.
- `LspSettings` stores enabled profile IDs, optional executable overrides, and custom profile definitions.
- `LspServerStatus` adds detected executable path and status to the public profile.
- `LspSettingsStore.list(): Promise<LspServerStatus[]>`, `save(settings): Promise<LspServerStatus[]>`, and `harnessConfigs(): Promise<LspServerConfig[]>`.

- [x] Add Zod schemas for persisted settings and normalized harness configs; reject malformed/oversized values and unknown built-in IDs.
- [x] Define Go, TypeScript/JavaScript, Python, and Rust catalog entries with command, args, extensions, language ID, install command, and official guide URL.
- [x] Resolve executables from PATH plus common user install directories without launching them; honor explicit executable overrides.
- [x] Read/write `lsp-settings.json` atomically under app `userData`; preserve a missing custom executable as an editable status.
- [x] Add IPC channels for list/rescan/save settings and opening approved external guide URLs.

### Task 2: Connect main, preload, and harness configuration

**Files:**
- Modify: `src/desktop/main/index.ts`
- Modify: `src/desktop/preload/index.ts`
- Modify: `src/contracts/commands.ts`
- Modify: `src/harness-server/index.ts`
- Modify: `src/harness/lsp/lsp-manager.ts`
- Modify: `src/harness/agent/tool-registry.ts`
- Modify: `src/harness/agent/agent-loop.ts`
- Modify: `src/harness/tools/lsp-tool.ts`

**Interfaces:**
- Preload exposes `listLspServers`, `rescanLspServers`, `saveLspSettings`, and `openLspGuide(serverId)`.
- Harness receives a validated `LSP_CONFIGURE` command with normalized `LspServerConfig[]`.
- `LspManager.setConfiguration(configs)` closes cached clients before replacing configuration.
- `HarnessTool.isAvailable?(context)` controls whether a tool is offered; LSP requires at least one enabled server config.

- [x] Load settings before harness startup and post normalized configs after settings saves.
- [x] Handle `LSP_CONFIGURE` in the harness and replace LSP manager config live.
- [x] Preserve current LSP operations while changing manager config from environment JSON to typed settings.
- [x] Filter tool definitions through `isAvailable(context)`; the LSP tool is available only when at least one enabled server resolves.
- [x] Keep tool execution checks and existing file permission checks intact.

### Task 3: Build Language Servers UI and workspace entry point

**Files:**
- Create: `src/desktop/renderer/pages/WorkspacePage/components/CustomizePanel/lsp/LanguageServersTabView.tsx`
- Create: `src/desktop/renderer/pages/WorkspacePage/components/CustomizePanel/lsp/AddCustomLspServerModal.tsx`
- Modify: `src/desktop/renderer/pages/WorkspacePage/components/CustomizePanel/CustomizePanel.tsx`
- Modify: `src/desktop/renderer/pages/WorkspacePage/components/CustomizePanel/CustomizePanel.module.scss`
- Modify: `src/desktop/renderer/pages/WorkspacePage/WorkspacePage.tsx`
- Modify: `src/desktop/renderer/pages/WorkspacePage/WorkspacePage.module.scss`

- [x] Add Language Servers as a top-level Customize tab; keep Yours/Discover controls scoped to Connectors.
- [x] Render detected/disabled, enabled, and missing states with setup command, official guide, executable override, rescan, and actionable errors.
- [x] Add custom profile create/remove controls for name, command, args, extensions, and language ID.
- [x] Add an empty-chat **Set up LSP** link that opens Customize directly on Language Servers.

### Task 4: Update project documentation and perform static checks

**Files:**
- Modify: `docs/tools.md`
- Modify: `docs/harness-design.md`
- Modify: `docs/superpowers/specs/2026-11-16-lsp-tool-design.md`

- [x] Document app-managed LSP setup, supported catalog, runtime availability, and existing four operations; remove end-user `LSP_SERVERS` setup instructions.
- [x] Record this feature as the follow-up that supersedes the prior UI non-goal.
- [x] Run source-only TypeScript checking, production build, and `git diff --check`; inspect changed files and diff for IPC/schema consistency. Automated tests are outside this task's requested verification scope. (`npm run typecheck` also checks repository tests and currently reports stale test typings.)

### Task 5: Expand the built-in language-server catalog

**Files:**
- Modify: `src/domain/lsp/lsp-registry.ts`
- Modify: `src/desktop/main/lsp-settings-store.ts`
- Modify: `src/harness/lsp/lsp-manager.ts`
- Modify: `docs/tools.md`
- Modify: `docs/superpowers/specs/2026-11-17-lsp-server-management.md`

**Interfaces:**
- Reuse the existing static `LspServerProfile` catalog, detection flow, executable override, and official setup guide UI.
- Keep the TypeScript Language Server profile for both TypeScript and JavaScript.
- Use `jdtls` for Java, `csharp-ls` for C#, `clangd` for C/C++, and `intelephense --stdio` for PHP.

- [x] Add profiles for Java, C#, C/C++, and PHP with extensions, language IDs where needed, install hints, and official guides.
- [x] Search common .NET global-tool and Homebrew LLVM binary directories during detection.
- [x] Map the added file extensions to correct LSP language IDs when the profile does not specify one.
- [x] Update supported-language documentation and note that TypeScript Language Server also covers JavaScript.
- [x] Run source-only TypeScript checking, production build, and `git diff --check`.

Final review: fresh reviewer found no Critical/Important issues. Minor deferred: uppercase `.C` source files receive language ID `c`; clangd still identifies the file by path, but this extension is not handled specially by the LSP language-ID fallback.
