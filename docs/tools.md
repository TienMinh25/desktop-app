# Tài liệu capability của tools

> Tham chiếu về việc từng tool làm được gì, giới hạn, quyền và caveat. Tool output là kết quả cho model; chỉ `read` media trả về nội dung `input_file`/`input_image` theo mapping ghi dưới đây. Mọi lần thêm hoặc thay đổi tool phải cập nhật trang này.

## Tools trong harness

| Tool | Capability và phạm vi | Giới hạn | Quyền / approval | Behavior và caveat |
| --- | --- | --- | --- | --- |
| `read` | Đọc UTF-8 text/code; PNG, JPG/JPEG, GIF tĩnh, WebP; PDF, DOC/DOCX, XLS/XLSX, CSV, PPT/PPTX. Text → `input_text`; CSV → `input_file`; ảnh → `input_image`; tài liệu còn lại → `input_file`. | Text 20.000.000 byte/file; media 20 MiB/file. Mỗi trang text tối đa 2.000 dòng và 100.000 byte. | Workspace thông thường được phép theo policy mặc định; file ngoài workspace hoặc nhạy cảm cần duyệt. | `offset` là dòng 0-based; `columnOffset` là UTF-16 offset 0-based trong dòng; không cắt đôi emoji. Dùng `limit` để đọc ít dòng hơn. GIF động, binary và nội dung không khớp extension bị từ chối. PDF có thể chứa cả text và ảnh trang; Office không phải PDF chỉ trích xuất text, không gồm ảnh/biểu đồ nhúng. |
| `write` | Tạo hoặc thay toàn bộ file UTF-8; tạo thư mục cha còn thiếu. | Nội dung tối đa 1.000.000 byte/file. | Hỏi approval theo mặc định; ngoài workspace cũng yêu cầu approval. | Không ghi file binary. |
| `edit` | Thay một đoạn text khớp chính xác trong file UTF-8. | File đọc và file sau sửa tối đa 1.000.000 byte; đoạn cũ phải khớp đúng một lần. | Hỏi approval theo mặc định; ngoài workspace cũng yêu cầu approval. | Không tìm thấy hoặc khớp nhiều lần thì từ chối, không sửa. |
| `glob` | Liệt kê đường dẫn trong workspace theo glob đơn giản `*`, `**`, `?`. | Tối đa 500 kết quả trả về. | Được phép theo policy mặc định; pattern được xác thực. | Báo rõ khi kết quả bị giới hạn. Không đọc nội dung file. |
| `grep` | Tìm regex không phân biệt hoa thường trong text files theo glob; mặc định `**/*`. | Regex tối đa 500 ký tự; quét tối đa 20.000 file; tối đa 500 kết quả; mỗi dòng kết quả tối đa 1.000 ký tự. | Được phép theo policy mặc định; đường dẫn nhạy cảm trong tập file sẽ yêu cầu approval bổ sung. | Regex nhóm lồng/lặp bị hạn chế để giảm nguy cơ regex tốn tài nguyên. Báo khi kết quả hoặc danh sách file bị giới hạn. |
| `shell` | Chạy một command foreground trong workspace bằng shell của hệ điều hành. | Command tối đa 20.000 ký tự; timeout mặc định/tối đa 120 giây (tối thiểu 1 giây); stdout + stderr tối đa 50.000 byte. | Hỏi approval cho mỗi command theo mặc định. | Không hỗ trợ PTY hoặc job nền. Timeout/đóng execution environment sẽ dừng process tree. Cú pháp phụ thuộc shell; approval không phải OS sandbox, command chạy với quyền OS của user. |
| `apply_patch` | Áp unified diff lên file trong workspace; hỗ trợ tạo, sửa, xóa file. | Diff tối đa 1.000.000 byte; file nguồn tối đa 2.000.000 byte/file. | Hỏi approval theo mặc định. | Từ chối path thoát workspace, symlink, rename và copy; patch phải khớp chính xác (không fuzz). |
| `lsp` | Gọi language server đã bật trong Customize → Language Servers: `definition`, `references`, `hover`, `diagnostics`. Đọc source UTF-8 rồi gửi `didOpen`/`didChange`; giao tiếp stdio theo framing LSP. Tool chỉ được đưa vào model khi có server bật và executable tìm thấy. | File tối đa 1.000.000 byte; một frame nhận tối đa 10.000.000 byte; request LSP timeout sau 30 giây; diagnostics chờ tối đa 1,5 giây; kết quả tối đa 30.000 byte JSON, output dài có cờ `truncated`. Vị trí line/character là 1-based ở tool, chuyển thành 0-based UTF-16 theo LSP. | Hỏi approval cho từng file theo mặc định; file ngoài workspace cũng cần approval. | Customize dò executable có sẵn và lưu cấu hình ở app `userData`; app không tự tải/cài server. Danh mục tích hợp gồm Go (`gopls`), TypeScript/JavaScript (`typescript-language-server`), Python (`Pyright`), Rust (`rust-analyzer`), Java (`jdtls`), C# (`csharp-ls`), C/C++ (`clangd`) và PHP (`Intelephense`); TypeScript Language Server xử lý cả file JavaScript. Có thể thêm server tùy chỉnh. Nếu thiếu server, UI hiện lệnh cài và hướng dẫn chính thức. clangd cho kết quả tốt hơn khi project có `compile_commands.json`. Diagnostics có thể báo timeout riêng, không đồng nghĩa danh sách rỗng; diagnostic cũ có version bị bỏ qua, nhưng server không gửi version thì không thể nhận diện chắc chắn dữ liệu cũ. Chỉ có bốn operation trên; chưa có completion, symbols, rename, code actions, document close hay tự restart/backoff. Client chưa xử lý request server gửi ngược về client như `workspace/configuration`. |
| `webfetch` | Tải nội dung từ URL HTTP/HTTPS dạng text, JSON hoặc XML. | Tải tối đa 5 MiB; trả tối đa 50 KiB; tối đa 10 redirect; timeout 30 giây. | Hỏi approval cho URL ban đầu và từng đích redirect theo mặc định. | URL không được chứa username/password; loại MIME không phải text/JSON/XML bị từ chối. Hiện chưa có chặn hostname/IP loopback, private hoặc link-local; approval redirect không tự bảo vệ khỏi SSRF ở tầng kết nối. |
| `todowrite` | Tạo/cập nhật checklist cho prompt hiện tại hoặc goal đang chọn. Upsert theo `id`; thiếu `id` thì ghép theo nội dung; item bỏ khỏi payload vẫn giữ. | Tối đa 100 item/lần; nội dung item tối đa 2.000 ký tự. | Được phép theo policy mặc định. | Lưu trong memory của harness process, không ghi database. Xóa session sẽ xóa checklist của session. |
| `question` | Hiển thị câu hỏi và chờ câu trả lời tự do; choices chỉ là gợi ý. | Câu hỏi tối đa 2.000 ký tự; tối đa 8 gợi ý, mỗi gợi ý tối đa 200 ký tự; UI giới hạn câu trả lời 10.000 ký tự và không gửi câu rỗng/whitespace; chờ tối đa 5 phút. | Không yêu cầu permission OS. | Trim câu hỏi và từ chối nội dung rỗng; câu trả lời giữ nguyên whitespace đầu/cuối. Hết hạn hoặc xóa session sẽ hủy lượt hỏi; không tự chọn một gợi ý thay người dùng. |
| `skill` | `list` hoặc `load` skill từ `~/.ccodex/skills/<name>/SKILL.md`; nội dung load được thêm vào model context. | Tên thư mục theo `[A-Za-z0-9][A-Za-z0-9._-]*`; file skill đọc tối đa 100.000 byte. | Hỏi approval khi liệt kê hoặc nạp; nạp skill được đánh dấu nhạy cảm vì nội dung bên ngoài được đưa vào context. | Chỉ tìm global skills trong `~/.ccodex/skills`; không tự tìm skill trong repo/workspace. Từ chối symlink ở thư mục gốc và file không phải regular file. |
| `mcp_<server>_<tool>` | Tool động được khám phá từ MCP server local stdio khai báo trong `MCP_SERVERS`; schema/description lấy từ server và được giới hạn thành function tool. | Mỗi schema tối đa 50.000 byte, phải là object schema. Gọi tool timeout sau 30 giây; output text tối đa 30.000 ký tự. Input/result protocol khác tùy server. | Hỏi approval cho mỗi lần gọi theo mặc định. | Chỉ xuất hiện khi server cấu hình kết nối thành công; lỗi kết nối khiến setup MCP thất bại. Chỉ giữ content dạng text; nếu không có text trả JSON result bị giới hạn. Chưa hỗ trợ remote HTTP/OAuth. Tên tool có prefix server để tránh trùng; có thể chuẩn hóa ký tự và giới hạn 64 ký tự. |

## File do người dùng đính kèm và tham chiếu `@`

| Luồng | Trạng thái và mapping | Giới hạn / quyền |
| --- | --- | --- |
| Kéo thả file vào prompt | Hành vi đích đã chốt, UI hiện mock. File text/code/tài liệu → `input_file`; ảnh raster → `input_image`. Code kéo thả là file input, không tự gọi tool. | App dự kiến giới hạn mỗi file dưới 40 MB và tổng file user đính kèm còn trong lịch sử session dưới 40 MB; request phát lại phải cộng cả file do `read` trả về và giữ dưới 40 MB. Tổng data URL Base64 của `input_image` và JSON request dự kiến dưới 400 MB/request. Chưa triển khai luồng UI. |
| `@` file trong workspace | Hành vi dự kiến: gửi tham chiếu path; khi model cần nội dung sẽ gọi `read`. UI hiện chưa triển khai `@` thật. | Không upload nội dung ngay và không tính vào quota attachment user; khi `read` media, áp giới hạn API của request phát lại history. Dùng quyền/xác thực của `read`. |

## Quyền và policy mặc định

| Nhóm | Mặc định |
| --- | --- |
| Tự cho phép trong workspace | `read`, `glob`, `grep`, `todowrite` |
| Yêu cầu approval | `write`, `edit`, `shell`, `apply_patch`, `lsp`, `webfetch`, `skill`, `mcp` |
| Yêu cầu approval theo tình huống | `read` ngoài workspace/đọc dữ liệu nhạy cảm; `glob`/`grep` theo policy override; từng URL redirect của `webfetch` |
| Không dùng permission OS | `question` |

Chế độ approval của prompt và `HARNESS_PERMISSION_RULES` có thể thay đổi quyết định mặc định; rule khớp sau có thể override rule trước. Quyền được xác nhận bởi harness không tạo sandbox hệ điều hành.

## Cách tính kích thước

- Giới hạn file tính trên byte UTF-8 hoặc byte gốc. Inline `file_data`/data URL dùng Base64 nên payload tăng khoảng một phần ba.
- Mức 40 MB cho attachment là quy tắc sản phẩm dự kiến; mỗi request phát lại lịch sử cần cộng lại các file còn nằm trong lịch sử. Giới hạn OpenAI công bố là 50 MB tổng file/request, nên 40 MB dự kiến để lại khoảng đệm.
- Mức 400 MB cho ảnh tính theo byte UTF-8 của data URL Base64 trong toàn bộ `input_image` của một request, gồm ảnh trong history; JSON request serialized cũng không vượt 400 MB theo thiết kế dự kiến.
- Model/provider còn áp dụng giới hạn context/token, kích thước ảnh/patch và request riêng.
- Binary không hỗ trợ không được gửi như text; app nên báo lỗi cụ thể.

## Điều phối session

- Harness giữ FIFO queue riêng cho từng session; prompt đang chạy/chờ được phát event từ runtime.
- Mỗi prompt có tool context và execution environment riêng; các vòng gọi model sau tool call nằm trong cùng AgentLoop.
- `todowrite` ở scope request bị xóa khi prompt kết thúc; scope goal tiếp tục trong session cho tới khi xóa session.
- Xóa session bỏ prompt chưa chạy, hủy câu hỏi đang chờ và dọn checklist; prompt đang chạy được phép kết thúc trước khi dọn agent.

Tham khảo API: [File inputs](https://developers.openai.com/api/docs/guides/file-inputs) · [Images and vision](https://developers.openai.com/api/docs/guides/images-vision) · [Function calling](https://developers.openai.com/api/docs/guides/function-calling).
