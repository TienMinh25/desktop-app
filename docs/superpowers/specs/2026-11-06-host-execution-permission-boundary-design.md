# Host execution and permission boundary

**Status: owner-selected direction**

## Intent

Keep tool execution on the desktop user's host, following OpenCode's normal local execution model. Do not probe for Docker, switch to a container, or add an automatic runtime fallback. Keep the app's permission policy and approval UI as the user-awareness and authorization layer, while documenting clearly that they do not provide OS-level isolation.

The owner selected host execution for simplicity across macOS and Windows. This intentionally leaves the course's Docker/Modal sandbox lesson unimplemented.

## Goals

- Continue using `LocalExecutionEnvironment` for file and shell operations.
- Keep `ApprovalMode` separate from per-operation permission decisions.
- Preserve manual Allow once / Deny behavior and the current Auto-safe / Full-access semantics.
- Retain the descriptor-backed read validation and the outside-workspace read path after permission approval.
- Explain in the UI and documentation that host commands run with the user's OS privileges and that permission prompts are not an OS sandbox.

## Non-goals

- Do not add Docker detection, Docker packaging, containers, or native OS sandboxing.
- Do not claim isolation from path checks, command scanning, or approval dialogs.
- Do not change the approval rules or force manual mode in place of the user's selected `ApprovalMode`.
- Do not choose an Electron packager or modify distribution scripts.

## Approaches considered

1. **Host execution, like standard OpenCode — selected by the owner:** no runtime prerequisite and consistent with the current app; tools retain host-user authority.
2. **Docker-required sandbox:** stronger process isolation but adds a Docker Engine/Desktop prerequisite on both target platforms.
3. **Docker with host fallback:** avoids blocking when Docker is unavailable but introduces runtime detection and can downgrade isolation unexpectedly.

The owner chose the first approach as the simplest fit. If stronger isolation becomes a product requirement, revisit the execution backend as a separate course lesson and make the runtime boundary explicit.

## Runtime behavior

- All current `ExecutionEnvironment` methods continue to use the host adapter.
- `PermissionManager` continues to evaluate allow/ask/deny and the chosen `ApprovalMode`; permission decisions do not imply OS isolation.
- In manual mode, permission requests still show Allow once / Deny. `question` remains a separate free-form response flow.
- The utility process, shell, MCP stdio servers, and configured LSP processes run with the desktop user's OS privileges.
- Reads retain descriptor identity validation after approval; this protects that read path against a parent-directory replacement but is not a general sandbox for writes or child processes.

## Acceptance criteria

- No Docker availability check or Docker dependency is added.
- Host execution stays on macOS and Windows through Node/Electron process APIs.
- Approval UI and `ApprovalMode` behavior remain unchanged.
- Documentation distinguishes application permission policy from OS sandboxing and describes the host authority of shell/MCP/LSP processes.

## References

- [OpenCode security statement](https://github.com/anomalyco/opencode/security)
- [OpenCode v2 permissions](https://dev.opencode.ai/v2/docs/permissions)
- [Course lesson 3: sandboxed coding agent](https://github.com/decodingai-magazine/building-a-coding-agent-from-scratch-course#-course-outline)
