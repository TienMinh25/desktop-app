# Desktop Coding Harness

An Electron desktop coding assistant backed by a local harness process. The desktop UI talks to the harness over a local process boundary; the harness talks to the company's backend for authentication and OpenAI Chat Completions compatible model requests.

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

The Electron main process owns desktop lifecycle and starts/stops the harness process. It forwards commands and events between the renderer and harness. The harness does not import Electron or UI code. Chat requests go from the harness to the company backend, which serves the model using the OpenAI Chat Completions schema; streamed response events travel back through the harness to the UI.

## Folder Structure

```text
src/
  desktop/
    main/              # Electron app lifecycle, windows, harness process management
    preload/           # Narrow, validated API exposed to the renderer
    renderer/          # Desktop UI
  harness/
    runtime.ts         # Harness composition and public runtime operations
    session/           # Session lifecycle and conversation state
    agent/             # Model loop and context assembly
    tools/              # File, shell, and other agent tools
    permissions/        # Permission policy and approval requests
    execution/          # Workspace-scoped tool execution
  harness-server/
    index.ts           # Separate-process entrypoint; starts the harness runtime
  domain/
    auth/               # Login and credential handling for the company backend
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
- `domain` adapts company authentication and chat APIs for use by the harness.
- `contracts` contains only shared message shapes and types; it contains no runtime behavior.

## Command and Event Flow

The desktop sends commands such as `session.create`, `chat.submit`, `execution.interrupt`, and `permission.respond`. The harness publishes events such as `session.created`, `assistant.delta`, `tool.started`, `permission.required`, `execution.completed`, and `execution.failed`.

Commands request an action. Events report what happened. Long-running work is observed through events rather than keeping a UI request open for the whole model run. The UI can request a session snapshot after startup or reconnecting.

The initial local transport should use Electron-managed child-process IPC (or another private local IPC mechanism), not an unauthenticated HTTP port exposed on localhost. Define and validate the transport boundary before adding features that depend on it.

## Sandbox Direction

Do not require users to install Docker. Start with workspace-scoped file access, explicit permission checks, and approval for risky operations. Shell and file operations initially run through a replaceable execution interface. These controls reduce risk but are not OS-level isolation; investigate stronger platform-specific isolation as a later milestone.

## Learning and Build Order

Build in small steps, following the course's progression while keeping the app's process boundaries:

1. Bun + TypeScript project setup; learn `package.json`, `tsconfig.json`, and module imports.
2. Electron shell and the main / preload / renderer boundary.
3. Typed command/event contracts and local harness process lifecycle.
4. Company login and secure credential handling.
5. OpenAI Chat Completions request and streamed text display.
6. Durable sessions and the basic agent loop.
7. Read-only workspace tools, then writes and permission approvals.
8. Shell execution and stronger sandbox options.
9. Context management, skills, subagents, evals, and trace replay.

At each step, implement and explain one small slice before moving to the next. Keep the harness independently usable from the desktop transport so a future CLI or other interface can be added without moving harness logic into the UI.
