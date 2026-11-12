# Chat HTTP Timeouts Design

## Intent

Use Undici consistently for both ordinary JSON requests and chat streaming. Let the streaming HTTP transport enforce its header and body-idle timeouts instead of maintaining hand-written timers around `fetch` and stream reads.

## Goals

- Enforce a 300,000 ms response-header timeout and a 900,000 ms body-idle timeout for chat streaming.
- Keep `ChatClient` responsible for chat request construction and SSE parsing, not socket timeout mechanics.
- Use explicit Undici request/response types from the `undici-types` package rather than asserting its fetch function to the global DOM `fetch` type.
- Keep Undici in runtime dependencies because both HTTP transports execute in the harness process.

## Non-goals

- Add an overall request deadline or automatic retry behavior.
- Add timeout configuration to user settings.
- Replace the chat protocol parser or change auth/request behavior.

## Approaches

- Keep manual `fetch` timers in application code: no dependency, but timeout behavior remains hand-built and cannot match the HTTP parser's header/body timeout semantics.
- Adopt Effect HTTP like OpenCode: it provides structured timeout handling, but adds a broad effect runtime that this project does not otherwise use.
- Use Undici's `Agent` with `headersTimeout` and `bodyTimeout` (selected): a focused HTTP transport dependency that supports the exact transport limits needed by the Electron utility process.

## Design

Both `HttpClient` and `StreamingHttpClient` will use Undici's fetch and request/response types. `StreamingHttpClient` will own an Undici `Agent` configured with 300,000 ms for response headers and 900,000 ms between response body chunks, and pass that dispatcher to streaming requests. `ChatClient` will no longer implement its own response-header and stream-idle timers; its user abort signal will still cancel the request. No overall timeout is added.

## Constraints and risks

- The streaming transport runs in Electron's Node-based utility process, where Undici's dispatcher API is supported.
- Keep the `undici` and `undici-types` major versions aligned; mismatched `Request`/`Response` declarations are structurally incompatible.
- Undici's `bodyTimeout` is a transport-level inactivity timeout between received body chunks, which matches the desired stream-idle behavior.
- Timeout errors will originate from Undici and retain its transport error details.
- Tests/typecheck are not run unless requested by the user.
