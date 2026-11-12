# Filesystem Read Descriptor Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure file reads stay within the workspace boundary that was evaluated before a permission wait, even if the path changes before the file is opened.

**Architecture:** Extend `ExecutionEnvironment.readTextFile` with the preflight `insideWorkspace` decision. `LocalExecutionEnvironment` opens once, checks the opened descriptor against the path's current canonical target and workspace boundary, then reads through that descriptor and closes it. Tools pass their prepared `ResolvedPath.insideWorkspace` value to the adapter.

**Tech Stack:** TypeScript, Node.js `node:fs/promises` `FileHandle`, Bun tests.

**Spec:** `docs/superpowers/specs/2026-11-06-filesystem-read-descriptor-check-design.md`

## Global Constraints

- Do not add a dependency.
- Preserve explicit, approved reads outside the workspace.
- If current path identity or containment cannot be established, fail closed before reading bytes.
- Preserve regular-file, binary-file, UTF-8, and byte-limit behavior.
- This change hardens reads only; it does not claim that writes, shell, or the harness process are OS-sandboxed.

## Review Focus

- **Parent-directory symlink swap after an in-workspace preflight:** reject and return no external contents. Test in Task 1.
- **An explicitly approved outside-workspace read:** still returns the target content. Test in Task 1.
- **A missing or moved target:** reject before reading bytes when open, current-path resolution, or path identity validation fails. Covered alongside the parent-directory swap regression in Task 1.
- **Existing input constraints:** non-regular, oversized, and binary files remain rejected. Keep the current environment tests in Task 1.
- **All tool call sites:** read, edit, LSP, skill, and patch-source reads pass the preflight workspace flag. Typecheck and full tests in Task 1 cover signature drift.

---

### Task 1: Validate descriptor-backed reads across all tools

**Files:**
- Modify: `tests/harness/execution/local-execution-environment.test.ts`
- Modify: `tests/harness/tools/read-tool.test.ts`
- Modify: `src/harness/execution/execution-environment.ts`
- Modify: `src/harness/execution/local-execution-environment.ts`
- Modify: `src/harness/tools/read-tool.ts`
- Modify: `src/harness/tools/edit-tool.ts`
- Modify: `src/harness/tools/lsp-tool.ts`
- Modify: `src/harness/tools/skill-tool.ts`

**Interfaces:**
- Change `ExecutionEnvironment.readTextFile(path: string, maxBytes: number, expectedInsideWorkspace: boolean): Promise<string>`.
- Tool callers supply the `insideWorkspace` value from their preflight `ResolvedPath`; project skill files pass `true`. `LocalExecutionEnvironment.applyPatch` passes `true` for its internal patch-source read after patch path validation.
- `LocalExecutionEnvironment` uses `FileHandle.stat()`, `realpath()`, and `stat()` to verify the descriptor and current path refer to the same file, and verifies current workspace containment when `expectedInsideWorkspace` is true. Apply `O_NOFOLLOW` when Node exposes it. Read content only from the validated handle and close it in `finally`.

- [ ] **Step 1: Add a failing parent-directory symlink-swap regression test**

In `tests/harness/tools/read-tool.test.ts`, prepare a read of a regular file inside a workspace subdirectory, move that directory, replace its original path with a symlink to a temporary external directory containing a same-named file with secret text, then call `readTool.execute` with the prepared data (representing execution after approval). Assert it rejects with a workspace/path-change error and never returns the external text.

- [ ] **Step 2: Run the focused test and verify it fails for the leak**

Run: `bun test tests/harness/tools/read-tool.test.ts`

Expected: the new test fails because current implementation returns the external file content; existing tests pass.

- [ ] **Step 3: Preserve approved external reads and update the read-tool test**

In `tests/harness/tools/read-tool.test.ts`, execute a prepared external `.env` read and assert it returns the file content after the test has observed its outside-workspace permission requirement. The existing in-workspace read remains a positive case.

- [ ] **Step 4: Run the focused read tests and verify the external case passes before the implementation change**

Run: `bun test tests/harness/tools/read-tool.test.ts`

Expected: the external read test passes; the parent-directory swap test fails because the current environment reads by path without descriptor/path validation.

- [ ] **Step 5: Implement descriptor validation and thread the workspace decision through callers**

Update the interface, all `readTextFile` tool callers, `LocalExecutionEnvironment.applyPatch`, and direct environment tests to pass the expected workspace flag. In `LocalExecutionEnvironment.readTextFile`, open with `O_RDONLY | (constants.O_NOFOLLOW ?? 0)`, validate a regular file and size using `FileHandle.stat()`, resolve the path and workspace after opening, compare descriptor/path `dev` and `ino`, enforce workspace containment when expected, then read at most `maxBytes + 1` bytes from the file handle. If identity cannot be established or any validation fails, throw before content reads; always close the handle.

- [ ] **Step 6: Run focused filesystem/tool tests**

Run: `bun test tests/harness/execution/local-execution-environment.test.ts tests/harness/tools/read-tool.test.ts tests/harness/tools/edit-tool.test.ts tests/harness/tools/lsp-tool.test.ts tests/harness/tools/skill-tool.test.ts tests/harness/tools/apply-patch-tool.test.ts`

Expected: all focused tests pass, including the symlink-swap rejection and approved external-read success.

- [ ] **Step 7: Run full verification**

Run: `bun test && bun run typecheck && bun run build && git diff --check`

Expected: all tests pass, typecheck/build succeed, and diff check reports no whitespace errors.
