# Session Prompt Queue and Todo State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Run prompts through a runtime-owned per-session FIFO queue, cache one lightweight `AgentLoop` coordinator per session, and keep todo updates consistent within prompt and goal scopes.

**Architecture:** `HarnessRuntime` owns explicit per-session queue state and lazily cached `AgentLoop` coordinators. Each prompt supplies its current `ChatModel` and `ToolContext`; queue and todo state remain separate from model transport objects. Runtime lifecycle events are the source of truth for the renderer's active and queued prompts.

**Tech Stack:** TypeScript, Bun, Electron utility process and IPC, React renderer, existing Responses API adapter.

**Spec:** `docs/superpowers/specs/2026-11-16-session-prompt-queue-and-todo-state-design.md`

## Global Constraints

- Keep one cached `AgentLoop` coordinator per session, created lazily when its first prompt starts.
- Do not cache `ChatClient` or its Undici dispatcher per session; model and turn context are prompt-scoped.
- Queue order and active prompt are owned by the runtime; the renderer displays runtime lifecycle state.
- Normal todo state resets for every new user prompt; todos for the same selected `goalId` persist across prompts in the current process.
- A `todowrite` call upserts only supplied items; omitted items remain and the tool emits the complete current snapshot.
- Goal editor, `@goal` syntax, and database persistence are out of scope; the runtime contract may carry an optional goal scope for later integration.
- Do not add or run tests unless the user asks. Verify production source with typecheck and review the diff; full typecheck also includes test files that still use the old Chat Completions, AgentLoop, and ToolContext contracts.

## Review Focus

- Multiple prompts submitted rapidly to one session: FIFO order and the active request's events stay attached to the correct prompt.
- Prompts in separate sessions: queues progress independently.
- Tool calls that cause multiple model requests: remain within one `AgentLoop.run` and one todo scope.
- Partial todo update: changed item updates while omitted items and their statuses remain in the snapshot.
- Same goal selected across prompts: its todo scope persists; ordinary prompt scope resets.

---

### Task 1: Define queue lifecycle and todo scope contracts

**Files:**
- Modify: `src/contracts/message-types.ts`
- Modify: `src/contracts/events.ts`
- Modify: `src/contracts/commands.ts`
- Modify: `src/harness/agent/tool-registry.ts`

**Interfaces:**
- Add typed prompt queued/started events with `requestId`, `sessionId`, and queue position where applicable.
- Add a session deletion command so runtime-owned agent/queue/todo state can be released.
- Extend todo items with a stable `id`; add optional `goalId` to prompt context/command, with request-scoped todos as the default.

- [x] Add the event/command constants and schemas, including session deletion and optional goal scope.
- [x] Define one shared `TodoItem` type and use it in `ToolContext.updateTodos` and the event contract.
- [x] Verify schemas and exhaustive event handling compile for production source; full typecheck remains blocked by test files using legacy chat/AgentLoop/ToolContext contracts.

### Task 2: Make runtime own prompt queues and session agent coordinators

**Files:**
- Modify: `src/harness/runtime.ts`
- Modify: `src/harness/agent/agent-loop.ts`
- Modify: `src/harness-server/index.ts`

**Interfaces:**
- `AgentLoop` is constructed with `ToolRegistry`; `run` accepts the current `ChatModel` plus the existing per-prompt input.
- `HarnessRuntime` stores `Map<sessionId, SessionQueue>` and `Map<sessionId, AgentLoop>`; create loop lazily, process one prompt at a time, and clear state when a session is deleted and idle.

- [x] Replace the promise chain with an explicit FIFO queue that records active and pending commands per session.
- [x] Emit queued and started lifecycle events; after completion or failure, promote the next command and delete empty queue state.
- [x] Reuse the session's `AgentLoop` coordinator while passing a fresh model/context for each prompt.
- [x] Handle session deletion by dropping pending prompts, allowing an active prompt to finish, then clearing agent/queue/todo state without starting more prompts.
- [x] Verify source type consistency and review queue exit paths: success, model/config failure, tool failure, and session deletion.

### Task 3: Add scoped, partial todo updates

**Files:**
- Modify: `src/harness/tools/todowrite-tool.ts`
- Modify: `src/harness/runtime.ts`
- Modify: `src/harness/agent/tool-registry.ts`
- Create or modify: `src/harness/session/todo-state-store.ts`

**Interfaces:**
- Todo scope is unique per session and request for ordinary prompts, or per session and stable `goalId` when a goal is selected.
- `todowrite` accepts items with optional IDs, assigns IDs to new items, merges by ID (or exact content for a new item without ID), and returns/emits a full snapshot.

- [x] Create the in-memory todo state store with replace-free upsert behavior and explicit clear operations for lifecycle cleanup.
- [x] Pass the prompt/goal todo scope through `ToolContext` and use it in `todowrite`.
- [x] Ensure an update to one item preserves omitted items; return IDs and the complete merged list to the model and renderer.
- [x] Verify existing tool schema usage and production source typecheck; do not persist todo data to SQLite.

### Task 4: Render the runtime queue and scope todos in the workspace

**Files:**
- Modify: `src/desktop/renderer/pages/WorkspacePage/WorkspacePage.tsx`
- Modify: `src/desktop/renderer/pages/WorkspacePage/components/ConversationStream/ConversationStream.tsx`
- Modify: related `ConversationStream` styles
- Modify: session deletion wiring in `src/desktop/renderer/hooks/useProjectSessions.ts` or its caller

**Interfaces:**
- Renderer tracks an active turn separately from queued prompt summaries.
- Queue events promote the matching request; stream events update only that request, not whichever prompt was submitted most recently.

- [x] Keep the current turn visible when more prompts are submitted and render pending prompts in FIFO order.
- [x] Remove a queued row when runtime marks it started; show it as the active prompt and promote the next row after completion/failure.
- [x] Keep the todo card stable through model/tool rounds; initialize request-scoped todos only when the runtime starts a new user prompt, while goal-scoped snapshots remain available across prompts selecting that goal.
- [x] Send the session deletion command when a chat session is deleted.
- [x] Verify renderer event handling by tracing rapid submissions and session keyed state; production source typecheck passes.

### Task 5: Update tool documentation and review the complete flow

**Files:**
- Modify: `docs/tools.md`
- Modify: `docs/harness-design.md`
- Modify: `docs/superpowers/specs/2026-11-16-session-prompt-queue-and-todo-state-design.md`

- [x] Document `todowrite` scope, partial merge behavior, reset behavior, and current in-memory lifetime in Vietnamese.
- [x] Document runtime-owned FIFO queue and one cached agent coordinator per session, distinguishing the per-prompt model/transport.
- [x] Check design requirements against the final diff and run `git diff --check` plus production source typecheck. Full `bun run typecheck` still reports legacy test contract errors; no tests were added or run.

