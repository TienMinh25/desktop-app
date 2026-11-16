# Kế hoạch triển khai vòng đời process của shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Mục tiêu:** Chọn shell executable theo thứ tự OpenCode và dừng process tree khi timeout hoặc khi `LocalExecutionEnvironment` đóng, không tạo process manager/daemon riêng.

**Kiến trúc:** Một shell selector chọn executable/arguments theo OS và environment; `LocalExecutionEnvironment` dùng invocation đó và theo dõi child process. Dùng một đường cleanup idempotent cho timeout và `close()`, rồi xóa child khỏi registry khi nó đóng.

**Công nghệ:** TypeScript, Node.js `node:child_process`, Bun test.

**Thiết kế:** `docs/superpowers/specs/2026-11-16-shell-process-lifecycle-design.md`

## Global Constraints

- Một lần gọi `runCommand()` tạo một process shell theo OS.
- Timeout là 1–120 giây sau clamp; mặc định 120 giây.
- Output stdout + stderr cộng lại tối đa 50.000 byte.
- macOS/Linux dừng process group bằng `SIGTERM`, rồi `SIGKILL` sau một giây nếu cần.
- Windows dừng cây process bằng `taskkill.exe /PID <pid> /T /F`.
- Chuẩn hóa `process.platform` một lần thành `OS`: `darwin` → `macOS`, `win32` → `Windows`, `linux` → `Linux`, platform khác giữ nguyên giá trị gốc.
- Ưu tiên executable trong `SHELL` nếu dùng được; macOS fallback `/bin/zsh`; Linux fallback `bash` trong `PATH`, rồi `/bin/sh`; Windows ưu tiên `pwsh`, `powershell`, Git Bash, rồi `COMSPEC`/`cmd.exe`.
- Chọn command-line arguments theo executable (`cmd`, PowerShell, Zsh, shell kiểu `-c`).
- Chỉ chọn regular executable file; Git Bash phải được nhận diện theo layout Git for Windows, không chọn `bash.exe` bất kỳ.
- `cmd.exe` nhận command trong ngoặc kép và spawn với `windowsVerbatimArguments: true`; flags theo shell family bất kể OS.
- Không `unref()` POSIX force-kill timer. Windows chỉ kill child trực tiếp nếu `taskkill /T /F` lỗi hoặc thất bại.
- Dùng nhãn `OS` cho chọn shell, `detached` và cleanup; không rải điều kiện `process.platform` trong `runCommand()`.
- `close()` đồng bộ, idempotent, dừng process đang chạy; gọi `runCommand()` sau `close()` bị từ chối.
- Không thêm PTY, background jobs, persistent daemon, hoặc dependency mới.

## Các trường hợp cần kiểm tra kỹ

- Timeout xảy ra khi process đang chạy: kết quả phải có `timedOut: true`, promise phải settle và process tree phải bị dừng.
- `close()` trong lúc command chạy: process tree bị dừng và command promise settle; environment không giữ process trong danh sách.
- `close()` gọi nhiều lần: không throw và không gửi cleanup lặp gây lỗi.
- `runCommand()` sau `close()`: reject trước khi spawn.
- Command kết thúc trước timeout: hủy timer và không đánh dấu nhầm là timeout.
- `SHELL` trỏ tới directory hoặc executable không hợp lệ: bỏ qua và tiếp tục fallback.
- Windows Git Bash: chỉ chọn bash trong layout Git for Windows; `bash.exe` riêng lẻ không được nhầm thành Git Bash.
- Windows `cmd` nhận command có dấu ngoặc kép qua Windows verbatim arguments.
- Shell thoát sau `SIGTERM` nhưng process con còn sống: POSIX force-kill timer vẫn phải chạy hết để dừng process group.
- Platform chưa biết: giữ nhãn gốc và theo nhánh non-Windows hiện tại.

---

### Task 1: Chọn executable shell theo OS

**Files:**
- Create: `src/harness/execution/shell-selector.ts`
- Test: `tests/harness/execution/shell-selector.test.ts`
- Modify: `src/harness/execution/local-execution-environment.ts`

**Interfaces:**
- `resolveShellInvocation(command: string, platform: NodeJS.Platform | string, env: NodeJS.ProcessEnv): ShellInvocation` trả `{ executable, args, os, windowsVerbatimArguments? }` đã được chọn.
- Selector dùng `SHELL` trước nếu executable tồn tại; khi không có, áp dụng thứ tự fallback trong Global Constraints.

- [x] **Step 1: Viết test cho thứ tự lựa chọn.** Dùng PATH tạm/fake executable để kiểm tra biến `SHELL`, macOS Zsh fallback, Linux Bash rồi `sh`, Windows `pwsh` → `powershell` → Git Bash → `COMSPEC`/`cmd.exe`, và fallback platform lạ.
- [x] **Step 2: Chạy selector tests để xác nhận fail trước implementation.**

Chạy: `bun test tests/harness/execution/shell-selector.test.ts`

Kỳ vọng: fail vì selector chưa tồn tại.

- [x] **Step 3: Implement `resolveShellInvocation(...)` và nối vào `LocalExecutionEnvironment.runCommand()`.** Tập trung kiểm tra platform, tìm regular executable trong PATH, chuẩn hóa `OS`, nhận diện Git Bash theo layout Git for Windows, và tạo flags theo shell family. `cmd.exe` dùng command trong ngoặc kép và `windowsVerbatimArguments: true`. Không thêm package.
- [x] **Step 4: Chạy selector tests.**

Chạy: `bun test tests/harness/execution/shell-selector.test.ts`

Kỳ vọng: toàn bộ thứ tự lựa chọn và arguments theo shell pass.

### Task 2: Theo dõi và dọn command process

**Files:**
- Modify: `src/harness/execution/local-execution-environment.ts`
- Test: `tests/harness/execution/local-execution-environment.test.ts`

**Interfaces:**
- Giữ nguyên `ExecutionEnvironment.runCommand(command: string, timeoutMs?: number): Promise<CommandResult>` và `close(): void`.
- `LocalExecutionEnvironment.close()` sẽ đánh dấu environment đã đóng và bắt đầu terminate process tree của mọi command đang được theo dõi.

- [x] **Step 1: Viết regression tests trước.** Thêm test cho command timeout, environment đóng khi command đang chạy, `close()` gọi lặp lại, và `runCommand()` sau `close()` bị reject. Dùng script Node tạm spawn một process con lâu dài và ghi PID ra file; sau timeout/close, xác nhận child process đã thoát. Dọn child process trong `finally` để test không rò process khi assertion fail.
- [x] **Step 2: Chạy tests mới để xác nhận hiện trạng chưa đáp ứng.**

Chạy: `bun test tests/harness/execution/local-execution-environment.test.ts`

Kỳ vọng: test cleanup khi `close()` và từ chối lệnh sau `close()` fail; test timeout/close phát hiện process con còn sống khi cleanup chưa dừng cả process tree.

- [x] **Step 3: Thêm trạng thái đóng và registry process.** Dùng nhãn `OS` từ selector cho `detached` và nhánh terminate. Mỗi child được thêm trước khi chờ output, xóa khỏi registry trong handler `close`, và từ chối command mới sau khi đóng.
- [x] **Step 4: Hợp nhất cleanup timeout và `close()` vào thao tác terminate idempotent theo OS.** Giữ POSIX process group `SIGTERM` rồi `SIGKILL` sau một giây; giữ Windows `taskkill /T /F` và chỉ fallback kill child nếu taskkill lỗi/thất bại; không tạo force-kill timer thứ hai nếu cleanup đã bắt đầu. Dọn timeout timer khi child đóng, nhưng giữ force-kill timer POSIX có tham chiếu đủ một giây vì process con có thể còn sống sau khi shell thoát.
- [x] **Step 5: Chạy execution environment tests.**

Chạy: `bun test tests/harness/execution/local-execution-environment.test.ts`

Kỳ vọng: toàn bộ tests pass; không còn command được theo dõi sau khi kết thúc hoặc environment đóng.

### Task 3: Ghi contract vòng đời và lựa chọn shell

**Files:**
- Modify: `docs/tools.md`

- [x] **Step 1: Cập nhật `docs/tools.md`.** Ghi rõ thứ tự chọn shell theo OS, shell syntax/flags phụ thuộc executable được chọn, mỗi lần gọi chạy foreground; timeout và lúc environment đóng sẽ dừng process tree; không hỗ trợ job nền/PTY.
- [x] **Step 2: Chạy focused tests và typecheck.**

Chạy: `bun test tests/harness/execution/local-execution-environment.test.ts` và `bun run typecheck`

Kỳ vọng: focused tests pass. Typecheck hiện có nhiều lỗi đã tồn tại trong test contracts cũ; xác nhận không có diagnostics trong các file selector/execution đã sửa và ghi lại các lỗi còn lại.
