# Thiết kế tool `shell`

## Mục tiêu

Đặt tên tool đúng với hành vi hiện tại: chạy command bằng shell mặc định của hệ điều hành. `shell` hỗ trợ macOS/Linux và Windows, nhưng cú pháp lệnh phụ thuộc shell của từng nền tảng; không hứa một cú pháp portable.

## Phương án

- Giữ tên `bash`: không đúng vì Windows chạy `cmd.exe`, còn Unix dùng `/bin/sh`.
- Cài Bash trên mọi nền tảng: tạo dependency và khác với mục tiêu dùng shell native.
- **Đổi tên thành `shell` và giữ shell native theo OS:** được chọn vì phản ánh chính xác runtime đang có, không thêm dependency.

## Hành vi đã chốt

- Tool/function và permission key đều là `shell`; không giữ alias `bash`.
- macOS/Linux chạy `/bin/sh -lc`; Windows chạy `%ComSpec%` hoặc `cmd.exe` với `/d /s /c`.
- Quyền mặc định tiếp tục là hỏi trước khi chạy mỗi command.
- Giữ giới hạn implementation: command dài tối đa 20.000 ký tự; timeout mặc định 120 giây và bị kẹp trong khoảng 1–120 giây; tổng stdout + stderr được giữ tối đa 50.000 byte.
- Test phản ánh implementation: `NaN` bị báo không phải integer; output capture kiểm tra tổng 50.000 byte, không kiểm tra 40.000 byte mỗi stream.
- Cấu hình `HARNESS_PERMISSION_RULES` dùng `"tool": "shell"`. Rule cũ ghi `bash` không còn là rule của tool này; không tự chuyển đổi alias.
- Cập nhật tài liệu contract hiện tại và test cùng lúc với việc đổi tên.

## Ngoài phạm vi

Quản lý child process đang chạy khi `ExecutionEnvironment.close()` được gọi sẽ xử lý ở một thay đổi riêng.

Permission của ứng dụng không sandbox shell khỏi quyền OS của user.
