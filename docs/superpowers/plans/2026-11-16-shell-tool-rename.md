# Kế hoạch đổi tên tool `bash` thành `shell`

> **Dành cho người triển khai agent:** Bắt buộc dùng skill `superpowers:executing-plans` để triển khai lần lượt từng task. Dùng cú pháp checkbox (`- [ ]`) để theo dõi.

**Mục tiêu:** Đổi tên tool tích hợp và permission key `bash` thành `shell`, giữ nguyên hành vi chạy shell native theo hệ điều hành.

**Kiến trúc:** Giữ việc tạo process trong `LocalExecutionEnvironment`; chỉ đổi tên adapter tool, chỗ đăng ký, permission mặc định và tài liệu liên quan. macOS/Linux tiếp tục dùng `/bin/sh -lc`; Windows tiếp tục dùng `%ComSpec%` hoặc `cmd.exe /d /s /c`.

**Công nghệ:** TypeScript, Bun test, harness chạy trong Electron utility process.

**Thiết kế:** `docs/superpowers/specs/2026-11-16-shell-tool-design.md`

## Ràng buộc chung

- Định danh tool và permission là `shell`; không thêm alias tương thích `bash`.
- Cú pháp shell phụ thuộc hệ điều hành; không thêm dependency shell.
- Giữ giới hạn hiện tại: command tối đa 20.000 ký tự; timeout 1–120 giây sau khi clamp; tổng stdout + stderr được giữ tối đa 50.000 byte.
- Hoãn theo dõi và dọn process khi adapter đóng.
- Không stage hoặc commit thay đổi.

## Các điểm cần review

- Nếu function definition hoặc permission request còn tên `bash`, model/UI có thể tiếp tục dùng định danh cũ; cần kiểm tra cả hai đều là `shell`.
- Permission mặc định cũ có thể làm tool mới bị deny; cần kiểm tra `shell` mặc định là ask và rule mới khớp.
- Shell khác nhau theo OS; giữ nhánh chạy hiện tại và command kiểm thử tương ứng nền tảng.
- Dễ nhầm output cap là giới hạn từng stream; test phải kiểm tra tổng 50.000 byte và đặt tên chính xác.
- Tài liệu lịch sử có thể nhắc Bash như một ngôn ngữ shell; chỉ đổi các chỗ nói về tên tool tích hợp hoặc key cấu hình.

---

### Task 1: Đổi tên tool và đồng bộ test

**Files:**
- Đổi tên: `src/harness/tools/bash-tool.ts` → `src/harness/tools/shell-tool.ts`
- Sửa: `src/harness-server/index.ts`
- Sửa: `src/harness/permissions/permission-manager.ts`
- Đổi tên sau khi viết regression test: `tests/harness/tools/bash-tool.test.ts` → `tests/harness/tools/shell-tool.test.ts`
- Sửa: `tests/harness/permissions/permission-config.test.ts`
- Sửa: `tests/harness/permissions/permission-manager.test.ts`
- Kiểm thử: tool shell đã đổi tên và các permission tests

**Interfaces:**
- Adapter export `shellTool`; function definition và permission request đều dùng `shell`.
- `PermissionManager` dùng `shell: "ask"` làm mặc định.
- Không ánh xạ rule `bash` cũ sang `shell`.

- [ ] **Bước 1: Cập nhật test trước trong file test hiện tại.** Kiểm tra tên tool và permission request là `shell`; đổi assertion lỗi `NaN` thành “must be an integer”; đổi tên test output để mô tả giới hạn tổng stdout/stderr và kỳ vọng 50.000 byte stdout được giữ lại; cập nhật fixture permission rule thành `shell`; thêm coverage cho permission mặc định `shell` là ask và rule `bash` cũ không áp dụng cho `shell`.
- [ ] **Bước 2: Chạy focused tests và xác nhận chúng fail vì implementation vẫn đăng ký `bash`.**

Chạy: `bun test tests/harness/tools/bash-tool.test.ts tests/harness/permissions/permission-config.test.ts tests/harness/permissions/permission-manager.test.ts`

Kỳ vọng: regression test lỗi vì tên tool và permission vẫn là `bash`.

- [ ] **Bước 3: Đổi tên file test và adapter; đổi export/function definition thành `shell`; cập nhật harness registration và permission default.** Giữ nguyên cách chạy command, timeout và giới hạn output.
- [ ] **Bước 4: Chạy focused tests.**

Chạy: `bun test tests/harness/tools/shell-tool.test.ts tests/harness/permissions/permission-config.test.ts tests/harness/permissions/permission-manager.test.ts`

Kỳ vọng: toàn bộ focused tests pass; permission rule dùng `shell` hoạt động và không có alias tương thích.

### Task 2: Cập nhật tài liệu tool và các reference hiện hành

**Files:**
- Sửa: `docs/tools.md`
- Sửa: `docs/harness-design.md`
- Sửa: `docs/harness-domain-and-desktop-architecture.md`
- Sửa các plan/spec hiện hành nhắc tên tool tích hợp hoặc permission key là `bash`.

- [ ] **Bước 1: Đổi reference tên tool/key cấu hình sang `shell`; ghi cú pháp theo OS và giới hạn hiện tại vào `docs/tools.md`.** Giữ nguyên các chỗ nói chung về shell và Bash syntax.
- [ ] **Bước 2: Tìm toàn bộ source, test và docs còn reference tên tool/key `bash`.** Xác nhận các kết quả còn lại chỉ nói về khái niệm/ngôn ngữ shell hoặc ví dụ command lịch sử.
- [ ] **Bước 3: Chạy focused shell tests, permission tests, toàn bộ Bun test suite và typecheck.** Báo rõ lỗi cũ ngoài phạm vi mà không sửa thêm.
