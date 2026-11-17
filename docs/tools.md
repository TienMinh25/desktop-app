# Tài liệu capability của tools

> Tham chiếu về việc từng tool làm được gì, giới hạn, quyền và caveat. Tool output là kết quả cho model; chỉ `read` media trả về nội dung `input_file`/`input_image` theo mapping ghi dưới đây. Mọi lần thêm hoặc thay đổi tool phải cập nhật trang này.

## Tools trong harness

| Tool | Capability và phạm vi | Giới hạn | Quyền / approval | Behavior và caveat |
| --- | --- | --- | --- | --- |
| `read` | Đọc UTF-8 text/code với **mọi extension** (không có allowlist). Ngoài ra nhận diện riêng **13 extension media**: ảnh `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` (5); tài liệu `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.csv`, `.ppt`, `.pptx` (8). Text → `input_text`; CSV và tài liệu khác → `input_file`; ảnh → `input_image`. | Text 20.000.000 byte/file; media 20 MiB/file. Mỗi trang text tối đa 2.000 dòng và 100.000 byte. | Workspace thông thường được phép theo policy mặc định; file ngoài workspace hoặc nhạy cảm cần duyệt. | `.csv` phải là UTF-8; các extension media còn lại phải khớp signature/định dạng tương ứng. `offset` là dòng 0-based; `columnOffset` là UTF-16 offset 0-based trong dòng; không cắt đôi emoji. GIF động, binary không thuộc nhóm hỗ trợ và nội dung không khớp extension bị từ chối. PDF có thể chứa cả text và ảnh trang; Office không phải PDF chỉ trích xuất text, không gồm ảnh/biểu đồ nhúng. |
| `write` | Tạo hoặc thay toàn bộ file UTF-8; tạo thư mục cha còn thiếu. **Không giới hạn số extension**: ghi text với mọi extension, ví dụ `.txt`, `.ts`, `.md`, `.json`, `.yaml`, `.csv`, `.html`, `.xml` hoặc extension khác. | Không có giới hạn byte riêng ở tool. Kích thước thực tế bị giới hạn bởi output token của model, request history/provider và bộ nhớ máy. | Hỏi approval theo mặc định; ngoài workspace cũng yêu cầu approval. | Chỉ ghi text, không sinh binary. Đặt tên `report.pdf` rồi ghi text không tạo ra PDF hợp lệ; PDF, DOCX, XLSX, ảnh và binary khác cần generator/artifact workflow riêng. OpenCode formatter là capability riêng, không phải extension allowlist của write. |
| `edit` | Thay text trong file UTF-8 bằng `oldString` và `newString`; `replaceAll: true` thay mọi lần xuất hiện. | Không có giới hạn byte riêng ở tool; file được đọc và ghi toàn bộ. Mặc định `oldString` phải khớp đúng một lần. | Hỏi approval theo mặc định; ngoài workspace cũng yêu cầu approval. | `oldString` rỗng, không tìm thấy, khớp nhiều lần (khi không bật `replaceAll`) hoặc thay không tạo khác biệt thì từ chối. Không tìm kiếm fuzzy/format theo extension. Chỉ dành cho text; không sửa binary. |
| `glob` | Liệt kê file (không gồm thư mục) trong workspace theo cú pháp glob của ripgrep, gồm `*`, `**`, `?`, brace và character class. | Pattern tối đa 1.000 ký tự; tối đa 500 kết quả trả về. | Được phép theo policy mặc định; path segment `..` bị từ chối. | Dùng ripgrep đóng gói cùng app; mặc định tôn trọng ignore files và bỏ hidden. Glob include cụ thể có semantics của ripgrep và có thể chọn file bị ignore; pattern nêu rõ hidden path sẽ tìm được hidden path đó. Báo rõ khi kết quả bị giới hạn. Không đọc nội dung file. |
| `grep` | Tìm regex của ripgrep trong text files theo glob; mặc định không phân biệt hoa thường và glob `**/*`; có `caseSensitive` để phân biệt hoa thường. | Regex tối đa 500 ký tự; glob tối đa 1.000 ký tự; preflight tối đa 20.000 file; tối đa 500 kết quả; mỗi dòng kết quả tối đa 1.000 ký tự. | Được phép theo policy mặc định; file nhạy cảm trong tập preflight yêu cầu approval bổ sung. Nếu preflight chạm giới hạn, cần approval cho workspace trước khi tìm kiếm rộng hơn. | Search chỉ chạy trên các file đã preflight, trừ khi danh sách bị giới hạn và workspace đã được duyệt. Mặc định tôn trọng ignore files và bỏ hidden; glob include cụ thể có thể chọn file bị ignore theo semantics của ripgrep. Pattern nêu rõ hidden path sẽ tìm được hidden path đó. Ripgrep được đóng gói trong app, không tải ở runtime. Báo khi kết quả hoặc danh sách file bị giới hạn. |
| `shell` | Chạy một command foreground trong workspace bằng shell của hệ điều hành. | Command tối đa 20.000 ký tự; timeout mặc định/tối đa 120 giây (tối thiểu 1 giây); stdout + stderr tối đa 50.000 byte. | Hỏi approval cho mỗi command theo mặc định. | Không hỗ trợ PTY hoặc job nền. Timeout/đóng execution environment sẽ dừng process tree. Cú pháp phụ thuộc shell; approval không phải OS sandbox, command chạy với quyền OS của user. |
| `apply_patch` | Áp OpenCode patch qua `patchText`; hỗ trợ nhiều thao tác `*** Add File`, `*** Update File`, `*** Delete File`, `*** Move to` trong một patch. Hỗ trợ nội dung text với mọi extension. | Không có giới hạn byte riêng cho patch hoặc file nguồn. Kích thước thực tế bị giới hạn bởi output token/request history/provider và bộ nhớ. | Hỏi approval theo mặc định cho toàn bộ các path nguồn/đích trong patch. | Path được validate trước approval; từ chối path ngoài workspace, `..`, NUL, thao tác xung đột và symlink. Update hunk dùng dòng ` `, `-`, `+` với context khớp chính xác. Các nguồn được đọc và kiểm tra trước khi bắt đầu ghi, nhưng lỗi I/O giữa chừng vẫn có thể khiến nhiều file chỉ được áp dụng một phần. Không hỗ trợ binary patch. |
| `lsp` | Gọi language server đã bật trong Customize → Language Servers: `definition`, `references`, `hover`, `diagnostics`. Đọc source UTF-8 rồi gửi `didOpen`/`didChange`; giao tiếp stdio theo framing LSP. Tool chỉ được đưa vào model khi có server bật và executable tìm thấy. | File tối đa 1.000.000 byte; một frame nhận tối đa 10.000.000 byte; request LSP timeout sau 30 giây; diagnostics chờ tối đa 1,5 giây; kết quả tối đa 30.000 byte JSON, output dài có cờ `truncated`. Vị trí line/character là 1-based ở tool, chuyển thành 0-based UTF-16 theo LSP. | Hỏi approval cho từng file theo mặc định; file ngoài workspace cũng cần approval. | Customize dò executable có sẵn và lưu cấu hình ở app `userData`; app không tự tải/cài server. Danh mục tích hợp gồm Go (`gopls`), TypeScript/JavaScript (`typescript-language-server`), Python (`Pyright`), Rust (`rust-analyzer`), Java (`jdtls`), C# (`csharp-ls`), C/C++ (`clangd`) và PHP (`Intelephense`); TypeScript Language Server xử lý cả file JavaScript. Có thể thêm server tùy chỉnh. Nếu thiếu server, UI hiện lệnh cài và hướng dẫn chính thức. clangd cho kết quả tốt hơn khi project có `compile_commands.json`. Diagnostics có thể báo timeout riêng, không đồng nghĩa danh sách rỗng; diagnostic cũ có version bị bỏ qua, nhưng server không gửi version thì không thể nhận diện chắc chắn dữ liệu cũ. Chỉ có bốn operation trên; chưa có completion, symbols, rename, code actions, document close hay tự restart/backoff. Client chưa xử lý request server gửi ngược về client như `workspace/configuration`. |
| `webfetch` | Tải nội dung từ URL HTTP/HTTPS dạng text, JSON hoặc XML. | Tải tối đa 5 MiB; trả tối đa 50 KiB; tối đa 10 redirect; timeout 30 giây. | Hỏi approval cho URL ban đầu và từng đích redirect theo mặc định. | URL không được chứa username/password; loại MIME không phải text/JSON/XML bị từ chối. Hiện chưa có chặn hostname/IP loopback, private hoặc link-local; approval redirect không tự bảo vệ khỏi SSRF ở tầng kết nối. |
| `todowrite` | Tạo/cập nhật checklist cho prompt hiện tại hoặc goal đang chọn. Upsert theo `id`; thiếu `id` thì ghép theo nội dung; item bỏ khỏi payload vẫn giữ. | Tối đa 100 item/lần; nội dung item tối đa 2.000 ký tự. | Được phép theo policy mặc định. | Lưu trong memory của harness process, không ghi database. Xóa session sẽ xóa checklist của session. |
| `question` | Hiển thị câu hỏi và chờ câu trả lời tự do; choices chỉ là gợi ý. | Câu hỏi tối đa 2.000 ký tự; tối đa 8 gợi ý, mỗi gợi ý tối đa 200 ký tự; UI giới hạn câu trả lời 10.000 ký tự và không gửi câu rỗng/whitespace; chờ tối đa 5 phút. | Không yêu cầu permission OS. | Trim câu hỏi và từ chối nội dung rỗng; câu trả lời giữ nguyên whitespace đầu/cuối. Hết hạn hoặc xóa session sẽ hủy lượt hỏi; không tự chọn một gợi ý thay người dùng. |
| `skill` | `list` trả tên các skill global hợp lệ; `load` trả toàn bộ nội dung `SKILL.md` dạng UTF-8 để model nhận như tool output/context. Mỗi lần load đọc lại file, không cache. | Tên thư mục theo `[A-Za-z0-9][A-Za-z0-9._-]*`; `SKILL.md` tối đa 100.000 byte (file đúng 100.000 byte được chấp nhận). Nội dung phải là UTF-8 text và không có NUL byte. | Cả `list` và `load` đều đi qua permission preflight. Policy mặc định là `ask`; `load` được đánh dấu `sensitive`. `manual` hỏi người dùng; `auto-safe` cũng hỏi vì policy là `ask`; `full-access` tự cho qua trừ rule `deny`. | Chỉ dò `~/.ccodex/skills/<name>/SKILL.md`, sắp xếp tên trước khi trả. Tên sai định dạng, symlink ở root/skill directory/file, thư mục thiếu `SKILL.md`, file không regular hoặc file thoát khỏi root bị bỏ qua/từ chối. Tool tự tạo `~/.ccodex/skills` nếu chưa có. Không parse frontmatter, không tìm trong project hay thư mục chuẩn khác, không cài/xóa skill, không tự nạp supporting files và không chạy script. Model vẫn có thể dùng `read` để đọc tài nguyên theo đường dẫn hoặc gọi `shell` để chạy script được hướng dẫn trong skill; đó là tool call riêng với permission của tool tương ứng, shell chạy trên host và không có OS sandbox. Nội dung là instruction không tin cậy; approval chỉ cho phép đọc, không kiểm duyệt hay vô hiệu hóa prompt injection. |
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
- Responses SSE không còn giới hạn 1 MB/frame; các frame tool argument lớn được đọc hết. Request history serialized vẫn có ngưỡng 400.000.000 byte và model/provider vẫn giới hạn số output token, nên bỏ ngưỡng frame không đồng nghĩa tạo được payload tùy ý lớn.
- Binary không hỗ trợ không được gửi như text; app nên báo lỗi cụ thể.

## Điều phối session

- Harness giữ FIFO queue riêng cho từng session; prompt đang chạy/chờ được phát event từ runtime.
- Mỗi prompt có tool context và execution environment riêng; các vòng gọi model sau tool call nằm trong cùng AgentLoop.
- `todowrite` ở scope request bị xóa khi prompt kết thúc; scope goal tiếp tục trong session cho tới khi xóa session.
- Xóa session bỏ prompt chưa chạy, hủy câu hỏi đang chờ và dọn checklist; prompt đang chạy được phép kết thúc trước khi dọn agent.

## Review capability: `skill`

Phần này ghi lại hành vi đã xác nhận trong `src/harness/tools/skill-tool.ts` và các giới hạn hiện tại để làm cơ sở chốt phạm vi tiếp theo. Đây chưa phải cam kết sẽ triển khai các mục bên dưới.

### Đã có

- Nguồn duy nhất là `~/.ccodex/skills`; mỗi skill là một thư mục con có `SKILL.md` trực tiếp.
- Model có thể liệt kê tên rồi nạp một skill theo tên. Tool chỉ trả nội dung hướng dẫn; skill không được thực thi như code.
- Danh sách bỏ qua entry sai tên, symlink, thư mục thiếu `SKILL.md`, file không regular và file có canonical path nằm ngoài root. Nội dung được đọc qua execution environment với giới hạn byte và kiểm tra UTF-8/binary.
- Cả liệt kê và nạp được gate bằng permission policy. Nội dung khi nạp được đánh dấu nhạy cảm để UI giải thích rằng instruction bên ngoài sẽ vào model context.

### Chưa có / cần quyết định

| Câu hỏi | Hiện trạng | Quyết định cần chốt |
| --- | --- | --- |
| Phạm vi discovery | Global `~/.ccodex/skills` duy nhất; không tìm skill trong repo/workspace, `.agents/skills`, `.codex/skills` hay các thư mục khác. | Giữ global-only hay thêm project/workspace scope? Nếu thêm, cần quy tắc ưu tiên, tránh trùng tên và cách hiện nguồn/độ tin cậy cho người dùng. |
| Metadata và discovery cho model | `list` chỉ trả tên; tool schema không có `description` theo từng skill. | Model có cần xem mô tả ngắn/frontmatter trước khi chọn load để giảm lượt gọi và tránh nạp nhầm không? Nếu có, chốt format metadata và validation. |
| Tài nguyên phụ và scripts | `skill` không đọc file phụ. Model có thể gọi `read` với path cụ thể để nạp tài liệu, hoặc `shell` để chạy script theo hướng dẫn; các tool đó có permission riêng. | Cách dùng `read`/`shell` hiện tại có đủ không, hay cần skill-aware resource/script API để giảm việc model tự ghép path? Nếu cần, chốt tổng size budget, containment, quyền theo từng file và UX approval; không chạy script ngầm bên trong `skill.load`. |
| Quản lý cài đặt | Người dùng tự đặt file vào thư mục; tool không tạo, cập nhật hoặc xóa skill (ngoại trừ tạo root directory rỗng khi được gọi). | Giữ quản lý thủ công hay cần UI/import/install và nguồn tin cậy/versioning? Đây là capability riêng, không nên ngầm gắn với `load`. |
| Vòng đời trong phiên | Load lại file mỗi lần gọi; không có danh sách skill đã nạp, unload, pin theo session hay kiểm tra file thay đổi giữa các lượt. | Có cần quản lý skill theo session, trạng thái loaded, hoặc refresh/unload không? |
| Trust và permission UX | Approval áp dụng cho thao tác list/load theo policy; nội dung được đưa nguyên dạng vào context. Không có sandbox, chữ ký hay scanner. | Có cần preview nội dung trước khi load, provenance/trust indicator hoặc allowlist nguồn không? Approval hiện tại chỉ xác nhận quyền đọc, không bảo đảm nội dung an toàn. |
| Gating load và containment lúc đọc | `permissionRequests` kiểm tra format tên và tạo resource path, xin approval trước `prepare`; `prepare` mới xác nhận skill tồn tại/canonical path. Discovery kiểm tra canonical path nằm trong root, nhưng `readTextFile` chỉ xác minh identity của file đang mở, không xác minh lại containment với skill root. Nếu thư mục skill bị thay bằng symlink sau discovery, có race hiếm có thể trỏ lần đọc sang path ngoài root. | Nên resolve skill metadata trước approval để không hỏi quyền cho skill không tồn tại; vẫn không đọc nội dung trước approval. Đồng thời cân nhắc API đọc có root constraint để kiểm tra containment ngay tại thời điểm open, tránh parent-directory swap. |
| Regression coverage | Có test list/load thành công và lỗi operation/name không hợp lệ hoặc skill vắng mặt. Chưa thấy test riêng cho giới hạn 100.000 byte, UTF-8/NUL, symlink root/file, bỏ qua skill thiếu file, approval theo mode, hoặc thay directory path giữa discovery và open. | Chốt các invariant bảo mật/lifecycle nào cần test trước khi mở rộng behavior; riêng root containment nên có test directory-swap chống TOCTOU. |

### Các phương án triển khai sau khi chốt

1. **Giữ gọn như hiện tại:** global-only, `SKILL.md` độc lập, bổ sung test cho invariants còn thiếu và giữ docs đồng bộ.
2. **Discovery tốt hơn:** thêm metadata có kiểm tra và trả tên + mô tả; chưa đổi nguồn cài đặt hoặc cách đọc tài nguyên.
3. **Skills theo project:** thêm scope project với quy tắc trust/ưu tiên/trùng tên và permission theo nguồn trước khi đọc.
4. **Skill resources/management:** thiết kế thành capability riêng cho tài nguyên phụ hoặc install/update, kèm containment, size budget và provenance.

Thứ tự phụ thuộc: chốt nguồn/scope trước metadata discovery; chốt tài nguyên phụ trước khi tăng context budget; chốt trust model trước khi thêm install hoặc nguồn project.

Tham khảo API: [File inputs](https://developers.openai.com/api/docs/guides/file-inputs) · [Images and vision](https://developers.openai.com/api/docs/guides/images-vision) · [Function calling](https://developers.openai.com/api/docs/guides/function-calling).
