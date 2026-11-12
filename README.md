# Desktop Coding Harness

An Electron desktop coding assistant backed by a local harness process. The desktop UI talks to the harness over a local process boundary. The planned backend integration uses the company's shared chat API with an OpenAI Chat Completions compatible request schema and an app-issued access token in the `Authorization: Bearer <access_token>` header. Login and token handling have not been implemented yet.

The project uses one repository, one root `package.json`, and Bun. The harness is a separate runtime process, but it is not a separate package or workspace.

## Architecture

```text
Desktop renderer
    ↕ Electron preload / IPC
Electron main process
    ↕ local child-process IPC
Harness process
    ├── harness runtime, sessions, tools, permissions, execution
    └── company domain client ──→ company backend
```

The Electron main process owns desktop lifecycle and starts/stops the harness process. It forwards commands and events between the renderer and harness. The harness does not import Electron or UI code. Once auth is connected, chat requests will go from the harness to the company's shared chat API using the OpenAI Chat Completions request schema and a Bearer access token; streamed response events will travel back through the harness to the UI. There is no static API key in the intended app/backend contract.

## Folder Structure

```text
src/
  desktop/
    main/              # Electron app lifecycle, windows, harness process management
    preload/           # Narrow, validated API exposed to the renderer
    renderer/          # Desktop UI
  harness/
    runtime.ts         # Headless prompt/session orchestration and event emission
    session/           # ConversationStore contract and in-memory adapter
    agent/             # Model loop and tool registry
    permissions/       # allow/ask/deny policy and user approval modes
    tools/             # Tool schemas and adapters; no direct host filesystem/process calls
    execution/          # ExecutionEnvironment contract and local host implementation
    lsp/               # Configurable language-server stdio client
    mcp/               # Configurable MCP stdio client and tool adapter
  infrastructure/
    http/               # Shared HTTP transport clients (JSON and streaming)
  harness-server/
    index.ts           # Separate-process entrypoint; starts the harness runtime
  domain/
    auth/               # (planned) Login and credential handling for the company backend
    chat/               # OpenAI Chat Completions compatible client and streaming
  contracts/
    commands.ts         # Commands exchanged between desktop and harness
    events.ts           # Typed events streamed from harness to desktop
package.json
tsconfig.json
```

Folders describe responsibilities; they are not separately published or installed packages. Keep the initial setup simple: a single Bun project and a single TypeScript configuration. Add more configuration only when a concrete need appears.

## Dependency Boundaries

- `renderer` uses the narrow API exposed by `preload`; it does not import Electron main, harness, or Node APIs.
- `desktop/main` manages windows and harness process lifecycle, and transports validated commands/events. It contains no agent loop or tool policy.
- `harness-server` is a process entrypoint and composition root. It starts the runtime and connects its transport.
- `harness` owns sessions, agent execution, tools, permissions, and harness events. It does not depend on Electron or UI.
- `domain` will adapt company authentication and the shared chat API for use by the harness; authentication is planned and not implemented yet.
- `contracts` contains only shared message shapes and types; it contains no runtime behavior.

## Command and Event Flow

The current desktop sends `app.ping`, `chat.submit`, `permission.respond`, and `question.respond`. The harness publishes `app.pong`, `assistant.delta`, tool lifecycle events, permission/question required and expired events, `todo.updated`, and chat completion/failure events. Session create/list and interrupt commands are planned, not wired yet.

Commands request an action. Events report what happened. Long-running work is observed through events rather than keeping a UI request open for the whole model run. The UI can request a session snapshot after startup or reconnecting.

The current local transport uses Electron-managed utility-process IPC. See [`docs/harness-design.md`](docs/harness-design.md) for the message flow and the distinction from transferring a `MessagePort`.

## Sandbox Direction

Do not require users to install Docker. Start with workspace-scoped file access, explicit permission checks, and approval for risky operations. Shell and file operations initially run through a replaceable execution interface. These controls reduce risk but are not OS-level isolation; investigate stronger platform-specific isolation as a later milestone.

## Learning and Build Order

Follow the course outline, keeping the desktop-specific setup and IPC boundary early: Electron/Bun/TypeScript foundations → typed IPC and separate harness process → model streaming and agent/tool loop → permissions and host execution → context engineering → subagents → remote/headless entrypoint → evals → trace recording/replay. Keep auth and durable database work at the point their product contracts are ready; the user will provide the database schema and auth requirements. The detailed status and agreed decisions are in the handoff section below. Keep the harness independent of Electron so another transport can be added without moving harness logic into the UI.

## Running the chat + agent-loop slice

The local harness process inherits its environment from Electron. For the current unauthenticated prototype, configure the chat endpoint before starting the app:

```sh
CHAT_COMPLETIONS_URL="https://your-company.example/v1/chat/completions" \
bun run dev
```

`CHAT_COMPLETIONS_URL` is the full shared chat API endpoint. The harness sends `Authorization: Bearer <access_token>` using `CHAT_ACCESS_TOKEN`; until the auth integration contract is supplied, it falls back to the placeholder `YOUR_JWT_ACCESS_TOKEN`. Replace the placeholder with the app-issued JWT flow when login/token handling is implemented. Never put credentials in renderer code or commit real values. The app currently uses the selected model name from the prompt bar. Global skills are discovered only under `~/.ccodex/skills/<name>/SKILL.md`; the app creates `~/.ccodex` at startup and creates `skills/` when the skill tool is used. MCP stdio servers can be configured with `MCP_SERVERS` as a JSON array of `{ "name", "command", "args", "env", "cwd" }` entries; each MCP tool call requires approval. LSP servers can be configured with `LSP_SERVERS` as a JSON array of `{ "extensions", "command", "args", "languageId", "cwd", "env" }` entries; they use standard LSP stdio framing and require approval per query. Ordered permission overrides can be configured in `HARNESS_PERMISSION_RULES` as a JSON array, for example `[{"tool":"bash","pattern":"git status*","decision":"allow"}]`.

Workspace selection is optional; without a picked folder the harness uses the current user's home directory as its execution root. The prompt bar offers **Ask every time** (default), **Auto-approve safe operations**, and **Full access**. These user approval modes are separate from the internal `allow` / `ask` / `deny` policy; explicit deny rules always block. The harness registers file, search, shell, patch, web fetch, LSP, skill, todo, and configured MCP tools. The loop sends each tool result back to the model and continues until the model returns a normal answer without tool calls. There is currently no fixed tool-round limit or prompt-cancellation command. IPC commands are validated at runtime with Zod schemas.

Conversation history is behind a `ConversationStore` interface with a process-memory adapter. Restarting the app clears sessions until the SQLite schema is provided. Permission approvals are application-level checks; they do not isolate the process from the host OS. `read` returns pages of up to 2,000 lines / about 50 KB and accepts a line offset to continue; files above 20 MB are rejected. `write` creates missing parent directories. Bash defaults to 120 seconds and returns at most 50,000 output bytes; webfetch downloads up to 5 MiB and returns at most 50 KiB to the model. LSP and MCP require external servers configured by environment variables; MCP currently supports local stdio and the 2025-11-25 handshake. Run harness unit tests with `bun test`.

### Code walkthrough

- `src/contracts/commands.ts` is the message shape the desktop sends. `chat.submit` includes a request ID, session ID, prompt, model, optional workspace path, and approval mode.
- `src/contracts/events.ts` is the message shape the harness sends back. `assistant.delta` can arrive many times for one request; `chat.completed` or `chat.failed` ends that request.
- `src/desktop/preload/index.ts` exposes only `sendHarnessCommand` and `subscribeHarnessEvents` to React. The renderer never receives `ipcRenderer` itself.
- `src/desktop/main/index.ts` owns the Electron utility process and forwards commands/events. It does not implement the agent loop.
- `src/harness-server/index.ts` is the separate-process composition/transport entrypoint; [`src/harness/runtime.ts`](src/harness/runtime.ts) owns headless prompt/session orchestration.
- `src/domain/chat/chat-client.ts` converts streamed server-sent event chunks into text and tool-call deltas. `src/infrastructure/http/http-client.ts` provides separate JSON and streaming HTTP transports, both using Undici; the streaming transport has a 5-minute response-header timeout and a 15-minute idle timeout between body chunks.
- `src/harness/agent/agent-loop.ts` collects tool-call fragments, invokes registered tools, appends their results to the conversation, and asks the model for the next turn.
- `src/harness/tools/` contains the registered tool implementations; policy marks outside reads and risky operations as `ask`, then the selected approval mode decides whether to show the prompt or auto-approve it.
- [`docs/harness-design.md`](docs/harness-design.md) explains permission decisions, the Electron utility-process messaging API, memory storage boundary, limitations, and a guided reading order.

## Handoff for the Next Session (2026-11-08)

Use this section as the current project brief. The project owner wants step-by-step guidance that follows the [course outline](https://github.com/decodingai-magazine/building-a-coding-agent-from-scratch-course#-course-outline), with practical comparisons to OpenCode. IPC was intentionally implemented early so the harness loop and tool approvals can communicate with the desktop. Read [`docs/harness-design.md`](docs/harness-design.md) for the detailed architecture/security review and the dated design decisions under `docs/superpowers/specs/` and `docs/superpowers/plans/` for prior choices. Do not treat an item marked “decided” as a request to revisit it.

### Target and course position

The target is a desktop coding harness with a separate headless harness process, a real agent loop, tools, explicit permissions, MCP and skills, and later company authentication and persistent conversation storage. Most of the basic harness and tool work is in place. Course Lesson 3's OS sandboxing was explicitly deferred: the app currently runs tools on the host and the user chose this to keep macOS/Windows support simple. The next course step is Lesson 4, context engineering. Continue there while being clear that app permissions are not OS isolation.

### Implemented in source

- Electron main/preload/renderer are separated from a utility-process harness. Zod validates IPC command payloads; shared message discriminants and exhaustive event/command handling reduce protocol drift.
- The harness has an agent loop that streams model output, executes tool calls, feeds results back, and continues until the model returns without tool calls. Session message storage is behind `ConversationStore`, currently backed only by process memory.
- Tool set: `read`, `write`, `edit`, `glob`, `grep`, `bash`, `apply_patch`, `lsp`, `webfetch`, `todowrite`, `question`, global `skill`, and configured MCP tools. `glob`/`grep` use `@vscode/ripgrep`; `apply_patch` uses the JS `diff` library and does not require Git installed on the user's machine. MCP uses the official TypeScript SDK over local stdio.
- Permission policy has `allow`/`ask`/`deny` rules and UI approval modes (ask every time, auto-approve safe operations, full access); explicit deny remains authoritative. Reads can target paths outside the chosen workspace after permission approval and use descriptor identity checks. `write` creates missing parent directories. Bash defaults to 120 seconds with a 50,000-byte output cap. Webfetch allows HTTP(S), caps downloads at 5 MiB and model output at 50 KiB.
- `read` returns pages up to 2,000 lines / about 50 KB with a line offset for continuation, and rejects files over 20 MB. It reads outside the selected workspace only subject to permission policy.
- LSP is configurable by server executable, file extensions and language ID; the app does not bundle language servers. Global skills are read only from `~/.ccodex/skills/<name>/SKILL.md`; the app creates `~/.ccodex` at startup and the skill tool creates `skills/` on use.
- The main process constructs and validates permission/question response commands from renderer payloads. It creates the global `.ccodex` root idempotently; tool-owned data directories are created by their owning modules.

### Decisions already made

- **Execution:** run tools on the host like OpenCode's normal local mode. Do not require Docker and do not silently fall back between sandbox modes. Revisit OS sandboxing only if isolation becomes a product requirement; document the current host risk.
- **Skills:** app-specific global directory is `~/.ccodex`; do not discover from `.codex`, `.claude`, or project folders. Skills are context instructions, not executable plugins.
- **Filesystem/tools:** allow approved reads outside workspace; use descriptor validation for reads; writes can create parent directories. Keep `read`, `write`, `edit`, `bash`, `apply_patch`; use ripgrep for glob/grep. Bash limits are 120 sec / 50 KB. Webfetch limits are 5 MiB download / 50 KiB returned text.
- **IPC/schema:** use Zod at runtime boundaries, shared constants for discriminants, base event interfaces, and exhaustive `assertNever` handlers. Keep permission/question response IPC channels; main owns the command `type` and validates the complete command.
- **MCP/LSP:** use a library for MCP, currently official TypeScript SDK over stdio. LSP support is determined by user-configured language-server executables; current operations are definition, references, hover, and diagnostics.
- **Backend chat/auth:** the intended backend is one company API with an OpenAI Chat Completions-compatible schema; requests use an app-issued access token in `Authorization: Bearer <access_token>`. Login/token acquisition and refresh come later. No static API key is part of the product contract. Current prototype uses `CHAT_ACCESS_TOKEN` with a placeholder default until auth is implemented. The user supplies the company URL when doing real end-to-end chat checks.
- **Database:** the user will provide the DB schema. Do not invent conversation/message persistence schema yet; preserve `ConversationStore` as the seam. Current harness conversation history is memory-only, and renderer sidebar session data is mock/local UI state rather than durable harness storage.
- **Build/release:** packaging/build target and release design are for the user to decide. Updates will use a private update server for the internal app, not public GitHub Releases. Do not start a packaging/release implementation before the user chooses specifics.

### Not done / known gaps

- Course Lesson 4 remains: context assembly/management, useful memory design, context-window budgeting and compaction. Skill support is basic (`SKILL.md` only); LSP feedback is basic. Follow the course in small explainable steps and use OpenCode as a reference rather than copying unrelated architecture wholesale.
- No login, access-token lifecycle, secure credential storage, or auth integration. Chat endpoint exists, but real company-authenticated E2E is pending the user-provided URL and auth flow.
- No DB schema or durable chat/session history. No harness commands to create/list/rename/delete sessions or return a snapshot on renderer reconnect. Current sidebar is mock state.
- Prompt cancellation/interrupt is not implemented end-to-end, despite the HTTP client using `AbortController` internally. Model request has a 30-second response-header timeout and a 120-second no-stream-chunk timeout, with no total generation deadline.
- Lesson 3 host execution has no OS sandbox. Filesystem mutations still have parent-path TOCTOU limitations; app permission prompts are not a security boundary against arbitrary host process behavior.
- MCP currently supports local stdio, not remote HTTP/OAuth; its host initializes a shared tool registry once per process, so explicit server `cwd` matters if multiple workspaces are used. LSP server installation, completion, restart/backoff, and broader document lifecycle are absent.
- Skill supporting files/metadata are not loaded. Webfetch intentionally returns bounded text, not arbitrary binary/web-page rendering.
- Packaging, signing, CI release artifacts, private update API integration, and actual updater are not implemented. UI update controls are currently mock UI.
- A dependency advisory review is documented in `docs/harness-design.md` as performed on 2026-11-06. It is a point-in-time result, not a guarantee of zero future CVEs; repeat a full dependency/Electron advisory check after dependency changes and before release.
- Latest `src/desktop/main/index.ts` TODO cleanup and README/design doc edits have not had typecheck or tests run yet. Run `bun run typecheck`, relevant `bun test` suites, `bun run build`, and `git diff --check` before claiming the latest changes verified.

### Suggested next work

1. Start Lesson 4 with context engineering: trace what history/tool outputs are sent on each model request, identify token/context growth, and explain the current behavior before changing it. Keep durable memory and DB schema out until the user supplies the storage contract.
2. Add focused context budgeting/compaction design and implementation in small course-aligned increments; preserve tool-call/result pairing and do not drop active-turn state.
3. Then cover skill/LSP context contributions and define what should be retained or summarized. Reconcile details with the owner before inventing memory persistence semantics.
4. Later, when the user provides contracts, implement auth/access-token flow and the shared chat API header; later still, integrate their DB schema behind `ConversationStore`.
5. Before broader release work, resolve cancellation, security boundary gaps, run CVE scans, and wait for the owner to decide packaging/update details.

For immediate orientation in a new session, inspect the working tree first (it contains staged, unstaged, and untracked work), then read this handoff, `docs/harness-design.md`, and the Lesson 4 course material. Avoid resetting or cleaning the working tree: the existing changes are intentional project work.
