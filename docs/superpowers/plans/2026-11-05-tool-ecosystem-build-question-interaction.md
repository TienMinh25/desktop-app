# Harness question, tool adapters, and security Implementation Plan

**Goal:** Implement an in-conversation `question` tool, adopt the selected ripgrep and MCP packages, remove the external Git executable requirement for patching, and document the course-guided architecture and security state.

**Spec:** `docs/superpowers/specs/2026-11-05-tool-ecosystem-build-question-interaction-design.md`

## Completion evidence

- [x] Typed question command/event, UI, timeout, and answer round-trip through the agent tool result.
- [x] Permission requests stay separate and retain Allow once / Deny behavior.
- [x] `glob` uses ripgrep and returns matching files plus non-empty matching directories.
- [x] `grep` uses ripgrep and preserves sensitive-resource approval checks.
- [x] MCP stdio uses the official SDK with legacy protocol negotiation and existing app-level permission/schema boundaries.
- [x] `apply_patch` uses `diff` and works when `PATH` is empty; Git does not need to be installed or bundled.
- [x] Documentation reflects current LSP support, in-memory storage, permission-vs-sandbox boundary, and selected dependencies.
- [x] `bun audit` reports no known vulnerabilities in the full dependency graph (170 packages, 2026-11-05).
- [ ] Final full test, typecheck, build, and dependency audit after the last edits.

## Deferred by owner

- Electron packaging and distribution target. Keep the existing build setup unchanged until the owner decides.
- Persistent conversation database; wait for the schema from the owner.
- Which language servers to install or bundle; current LSP support stays configurable.

## Verification commands

```sh
bun test
bun run typecheck
bun run build
bun audit
```
