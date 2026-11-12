# Chat HTTP Timeouts Implementation Plan

> **For agentic workers:** Use this plan to standardize both HTTP transports on Undici and configure chat stream timeouts. Executed inline in the current workspace.

**Goal:** Use Undici consistently for JSON and streaming HTTP, and give chat streaming transport-level response-header and idle-body timeouts without changing the chat protocol or adding an overall request deadline.

**Architecture:** Both HTTP transports use Undici fetch and its types. `StreamingHttpClient` creates an Undici `Agent` with explicit header and body timeout options. `ChatClient` retains SSE parsing and external abort forwarding but removes its duplicate local timeout wrappers.

**Tech stack:** TypeScript, Electron utility process, Undici.

**Spec:** `docs/superpowers/specs/2026-11-11-chat-http-timeouts-design.md`

## File map

- Modify `package.json` and `bun.lock`: declare Undici as a direct runtime dependency.
- Modify `src/infrastructure/http/http-client.ts`: use Undici fetch/types in both clients; configure an Undici `Agent` for streaming fetches with response-header and body-idle timeouts.
- Modify `src/domain/chat/chat-client.ts` and `tests/domain/chat/chat-client.test.ts`: use Undici fetch/response types for injection and remove local timer-based stream reads.

## Global constraints

- Header timeout: `300_000` ms.
- Body idle timeout: `900_000` ms.
- Overall request timeout: none.
- Do not change JSON request behavior, Bearer auth, SSE parsing, or cancellation semantics.
- Do not add or run tests/typecheck unless requested by the user.

## Review focus

- Ensure a body-idle timeout still fires while the chat client is awaiting the next stream chunk.
- Ensure the caller's `AbortSignal` still cancels both the request and body read.
- Ensure the Agent is not created per request and can reuse connections.
- Ensure non-streaming `HttpClient` remains on its current behavior.

## Task 1: Configure streaming HTTP transport timeouts

**Files:** as listed in the file map.

**Interfaces:**

- `StreamingHttpClient` continues to expose `post(url, body, headers, signal): Promise<Response>`.
- `ChatClient` continues to expose the current `ChatModel` interface.

- [x] Declare `undici` as a direct runtime dependency at the resolved version already present in the lockfile.
- [x] Use Undici fetch in both HTTP client classes and explicit `RequestInfo`, `RequestInit`, `HeadersInit`, and `Response` types from `undici-types`; keep the types package in `devDependencies`.
- [x] Align `undici` and `undici-types` at `8.12.4` to avoid incompatible `Request`/`Response` declarations.
- [x] Configure one reusable `Agent` per `StreamingHttpClient` with `headersTimeout: 300_000` and `bodyTimeout: 900_000`, and pass it as the dispatcher to Undici fetch.
- [x] Remove `ChatClient`'s manual response-header timer and `readWithIdleTimeout`; consume the response stream directly so the transport enforces both limits.
- [x] Review the resulting diff and references. Tests/typecheck were not run.
