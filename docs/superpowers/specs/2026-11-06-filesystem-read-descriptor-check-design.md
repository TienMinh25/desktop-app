# Filesystem read descriptor check

## Intent

Keep a read permission decision tied to the workspace boundary when the tool waits for the user. A path resolved inside the workspace before approval must not be redirected to a file outside the workspace before its contents are read.

## Scope

- Apply to `read` and every existing tool path that reads through `ExecutionEnvironment.readTextFile` (`edit`, LSP source reads, skill loading, and patch source reads).
- Keep external reads possible when their preflight resolution marked them outside the workspace and the existing permission flow approved them.
- Do not change `ApprovalMode`, permission rules, UI, or add a filesystem dependency.
- This does not make write operations or shell execution race-safe and is not an OS sandbox. Their separate path/mutation boundary remains a follow-up.

## Approaches

1. Resolve the path again after approval, then read by path. This is a small change but leaves a race between the final check and `open()`.
2. **Open and validate a file descriptor before reading (selected).** Open the target with no-follow where supported; inspect the opened descriptor; resolve and stat the current path; require the path's device/inode to match the descriptor; if preflight said the path was inside the workspace, require the current resolved path to remain inside. Read only through that already-validated descriptor and always close it. This detects a parent-directory/path swap without keeping handles open during the approval wait and adds no dependency.
3. Open and retain a descriptor during preflight, then read from it after approval. This pins the original file object across the wait, but requires cleanup for denial, timeout, cancellation, and manager shutdown.

The selected approach follows the user's choice, avoids a pending descriptor during a potentially long approval wait, and closes the resolve/open gap by validating the descriptor that will actually supply bytes. Node documents `O_NOFOLLOW` as platform-dependent (it is not available among Windows' listed open flags), so use it where present and rely on descriptor/path identity plus workspace containment on other platforms. If descriptor identity cannot be established on a platform, fail closed rather than falling back to a path read. [Node filesystem documentation](https://nodejs.org/api/fs.html)

## Behavior and verification

- Preserve existing regular-file, UTF-8/binary, and byte-limit checks, applying size and content reads to the opened descriptor.
- Add a deterministic regression test: preflight a file under a workspace subdirectory, replace that directory with a symlink to an external directory while approval is pending, then assert the file read is rejected and no external contents are returned.
- Keep a positive case for an explicitly approved external file and the existing in-workspace, binary, and size-limit cases.
- Run the focused filesystem/tool tests, then the full test suite, typecheck, and build.

## Remaining work

The same class of path race can affect writes and shell commands. This change only hardens reads; decide and design those boundaries separately, with an OS sandbox still required for a real isolation boundary.
