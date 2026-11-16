# Thiết kế quản lý vòng đời process của tool `shell`

## Mục tiêu

Giữ cách chạy đơn giản: mỗi lần gọi `shell` tạo một process shell theo hệ điều hành. Khi hết timeout hoặc execution environment đóng, process cùng các process con của nó cần được dừng; không để lệnh chạy sót ngoài vòng đời của tool.

## Phương án

- Chỉ kill process trực tiếp: đơn giản nhưng có thể để process con tiếp tục chạy.
- **Theo dõi các process đang chạy trong `LocalExecutionEnvironment`:** có thể dừng process tree khi timeout hoặc `close()`, không cần dịch vụ process riêng.
- Tạo process manager/daemon có job ID, output lưu lại, PTY và khôi phục process: vượt nhu cầu hiện tại.

Chọn phương án thứ hai. `HarnessTool` tiếp tục gọi `ExecutionEnvironment.runCommand()`; việc spawn và dọn process thuộc `LocalExecutionEnvironment`.

## Chọn shell

Thay việc cố định `/bin/sh`/`cmd.exe` bằng selector theo thứ tự của OpenCode:

- Nếu `SHELL` trỏ tới executable có thể dùng, ưu tiên shell đó.
- macOS: fallback `/bin/zsh`.
- Linux: tìm `bash` trong `PATH`, nếu không có thì dùng `/bin/sh`.
- Windows: tìm `pwsh`, `powershell`, Git Bash, rồi fallback `COMSPEC` hoặc `cmd.exe`.
- Những platform khác giữ fallback hiện tại theo nhánh non-Windows.

Selector chỉ nhận regular executable file (follow symlink); directory hoặc path không dùng được trong `SHELL` bị bỏ qua để tiếp tục fallback. Git Bash chỉ được chọn khi nhận diện được layout Git for Windows, không chọn một `bash.exe` bất kỳ trong PATH.

Arguments được chọn theo shell family, kể cả khi shell cấu hình khác với mặc định OS: `cmd` dùng `/d /s /c` với Windows verbatim arguments; PowerShell dùng `-Command`; Zsh dùng `+o nomatch -c`; Bash/sh dùng `-lc`; shell khác dùng `-c`. Không thêm giao diện cấu hình shell riêng trong app ở thay đổi này. Đây là thứ tự của OpenCode hiện tại: macOS fallback Zsh; Linux fallback Bash rồi `sh`.

Chuẩn hóa `process.platform` thành nhãn `OS` (`macOS`, `Windows`, `Linux`, hoặc giá trị gốc nếu là platform khác) một lần trong selector. Dùng nhãn này cho chọn shell, cấu hình detached process và nhánh terminate; không rải các phép so sánh `process.platform` khắp implementation.

## Hành vi

- Mỗi lệnh vẫn chạy trong một OS process riêng; lệnh foreground trả stdout, stderr, exit code/signal như hiện tại.
- Shell được chọn theo thứ tự ở mục “Chọn shell”; arguments phù hợp executable được chọn.
- Khi hết timeout, dừng toàn bộ process tree. Trên macOS/Linux gửi `SIGTERM` cho process group rồi gửi `SIGKILL` sau một giây nếu cần. Trên Windows dùng `taskkill /T /F`.
- Khi `LocalExecutionEnvironment.close()` được gọi, bắt đầu dừng mọi command process còn hoạt động theo cơ chế dừng process tree tương ứng OS. `close()` vẫn là thao tác đồng bộ; các promise đang chờ kết thúc khi child process phát sự kiện đóng.
- Trên Windows chỉ kill child trực tiếp nếu `taskkill /T /F` lỗi hoặc trả exit code khác 0; không race bằng cách kill root ngay sau khi spawn `taskkill`.
- Không cần kill process đã kết thúc bình thường.
- Sau khi đóng environment, từ chối các lần gọi `runCommand()` mới.
- Chỉ đọc `process.platform` tại chỗ chuẩn hóa nhãn `OS`; giữ fallback cho platform chưa ánh xạ.
- Gỡ command khỏi danh sách theo dõi sau khi child process kết thúc và luôn dọn timeout timer. Nếu đang terminate trên POSIX, giữ force-kill timer có tham chiếu đủ một giây kể cả khi shell process đã thoát và command promise đã settle; nếu không, host có thể thoát trước khi kill process con còn sót.
- Kiểm thử timeout, cleanup lúc đóng environment, đóng lặp lại, và từ chối lệnh sau khi đóng.

## Ngoài phạm vi

- PTY, interactive terminal, lệnh chạy nền, job ID, đọc output theo đợt, lưu output bền vững, daemon và khôi phục process sau restart.
- Đổi tên tool `bash` thành `shell`; việc đó nằm trong plan riêng.
- OS sandbox. Permission prompt không giới hạn quyền OS của process được phép chạy.
