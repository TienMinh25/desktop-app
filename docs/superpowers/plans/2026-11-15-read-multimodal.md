# Kế hoạch mở rộng tool `read` để đọc nhiều định dạng

> **Đã duyệt:** Người dùng chốt kế hoạch và yêu cầu tạo `docs/tools.md` rồi triển khai.

## Mục tiêu

Giữ nguyên một tool model-visible tên `read`, đồng thời cho phép model nhận nội dung có giới hạn từ file UTF-8, ảnh, PDF, tài liệu Office và CSV qua Responses API.

## Kiến trúc dự kiến

`read` phân loại file dựa trên nội dung và metadata đã kiểm tra. File UTF-8 được đọc cục bộ theo từng trang. Ảnh và tài liệu được đọc thành byte gốc trong `ExecutionEnvironment`; khi tạo request, adapter mã hóa các byte này thành Base64 và đóng gói theo định dạng Responses API (`input_image` dùng data URL; `input_file` dùng `file_data` dạng data URL). Mỗi Responses request phát lại lịch sử hội thoại hiện có, gồm output item trước đó và `FunctionCallOutput` tương ứng. Chưa tích hợp SQLite, lưu artifact bền vững hoặc compaction.

## Công nghệ hiện có

Bun, TypeScript, Electron harness, `ExecutionEnvironment` cục bộ và API tương thích OpenAI Responses API dạng JSON/SSE.

## Khả năng và giới hạn dự kiến

- Chỉ có một function cho model gọi là `read`; không thêm `read_image`, `read_pdf` hoặc tool đọc riêng theo định dạng.
- Đầu vào tiếp tục có `path`, `offset`, `limit`. `offset` là số dòng bắt đầu từ 0; phân trang chỉ áp dụng cho file UTF-8. Nếu model truyền `offset` hoặc `limit` cho ảnh/tài liệu, trả lỗi rõ ràng thay vì bỏ qua tham số.
- **File UTF-8:** tối đa 20.000.000 byte mỗi file. Mỗi lần đọc trả tối đa 2.000 dòng và 100.000 byte nội dung. Không giới hạn số ký tự trên từng dòng. Nếu một dòng dài vượt giới hạn nội dung của trang, cần cursor vị trí trong dòng để đọc tiếp mà không làm mất phần văn bản còn lại.
- **CSV:** gửi dưới dạng `input_file` để dùng luồng xử lý bảng tính của API; không phân trang bằng `offset`/`limit`. Theo tài liệu API hiện tại, luồng bảng tính xử lý tối đa 1.000 dòng mỗi sheet.
- **Ảnh:** PNG, JPG/JPEG, GIF tĩnh và WebP. JPG và JPEG là hai phần mở rộng cho cùng định dạng JPEG. Kiểm tra chữ ký file so với phần mở rộng/MIME; từ chối GIF động với thông báo rõ ràng.
- **Tài liệu gửi dưới dạng `input_file`:** PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX và CSV. Với model có vision, PDF có thể đưa cả text trích xuất và hình từng trang vào ngữ cảnh. API chỉ trích xuất text từ tài liệu Office không phải PDF; hình/biểu đồ nhúng không được đưa vào ngữ cảnh. CSV dùng luồng bảng tính như trên.
- **Giới hạn media do tool `read` trả về:** tối đa 20 MiB byte gốc cho mỗi file ảnh/tài liệu. Không áp quota 40 MB của user attachment lên các kết quả tool; toàn bộ history vẫn phải qua kiểm tra giới hạn request.
- **File người dùng đính kèm:** quota tối đa 40 MB (40.000.000 byte) tổng byte gốc cho mọi file người dùng kéo thả còn trong lịch sử session được phát lại, kể cả code. Đây là quota sản phẩm, không phải giới hạn API. Không tính output do tool `read` tạo vào quota user attachment. Từ chối file mới trước khi thêm vào lịch sử nếu tổng vượt quota và báo dung lượng đã dùng/còn lại. Xóa attachment hoặc xóa session thì giải phóng quota tương ứng. Giao diện đính kèm hiện chưa được triển khai; chỉ ghi hợp đồng quota trong giai đoạn `read` này.
- **Mã hóa khi gửi:** `ExecutionEnvironment` đọc byte gốc; adapter mã hóa Base64 ở ranh giới gửi API. Base64 làm phần dữ liệu trong JSON lớn hơn khoảng một phần ba (20 MiB byte gốc thành khoảng 26,7 MiB Base64, chưa tính JSON và tiền tố data URL). Giới hạn dung lượng mỗi file được tính trên byte gốc; việc tạo request cũng cần tránh nhiều bản sao lớn trong bộ nhớ. API cũng hỗ trợ `file_id`, nhưng phương án hiện tại trong plan là gửi Base64 inline, chưa thêm quy trình upload Files API.
- **Giới hạn request của ứng dụng:** tổng byte gốc của mọi `input_file` trong toàn bộ lịch sử được phát lại phải dưới 40 MB; từng `input_file` cũng phải dưới 40 MB. Giới hạn này gồm cả attachment và file do `read` trả về. Mức chính thức OpenAI hiện công bố là 50 MB tổng file/request, nên 40 MB là khoảng đệm của ứng dụng. Tổng payload đã serialize của mọi `input_image` trong request phải dưới 400 MB; ảnh từ user và tool đều được tính. Toàn bộ JSON request phải dưới 400 MB. Giới hạn model về ảnh/context vẫn có thể thấp hơn.
- **Giới hạn request sau Base64:** quota 40 MB tính byte gốc; tổng `input_image` và toàn bộ JSON request đã serialize đều phải dưới 400 MB. Adapter kiểm tra riêng tổng file gốc, payload ảnh đã serialize và JSON request hoàn chỉnh; không âm thầm bỏ lịch sử/media nếu request vượt giới hạn.
- Reference cục bộ chỉ phục vụ hiển thị trong UI, bản thân nó không cung cấp nội dung cho model. Khi lịch sử phát lại, cần giữ snapshot byte/content tương ứng với mỗi media input để nội dung không đổi nếu file nguồn trên đĩa bị sửa sau đó. Việc lưu bền vững artifact vẫn để giai đoạn sau.
- Định dạng không hỗ trợ, file hỏng, chữ ký không khớp phần mở rộng, UTF-8 không hợp lệ và file vượt giới hạn phải trả lỗi cụ thể; không giải mã byte nhị phân không rõ loại như text.
- Giữ nguyên quyền hiện tại của `read` với đường dẫn bên ngoài workspace và tài nguyên nhạy cảm. Bổ sung đọc byte có giới hạn qua `ExecutionEnvironment`, dùng cùng kiểm tra symlink, danh tính descriptor và workspace như đọc text.
- Chưa tích hợp schema SQLite, lưu artifact bền vững, quản lý ngân sách context hoặc compaction. Lưu typed history và reference/snapshot media trong in-memory conversation store hiện có. Ghi rõ trong `docs/tools.md` đây là giải pháp tạm; khi triển khai schema đã cung cấp, cần lưu bền vững artifact/reference và bổ sung quản lý context.

### Bảng phân biệt giới hạn

| Giới hạn | Phạm vi được tính | Ví dụ / cách xử lý |
| --- | --- | --- |
| Mỗi `input_file` dưới 40 MB (app) | Byte gốc của từng file. Mức upstream OpenAI là dưới 50 MB/file. | App từ chối file 40 MB trở lên dù upstream có thể nhận file lớn hơn. |
| Tổng `input_file` dưới 40 MB mỗi request (app) | Cộng byte gốc của tất cả file inputs trong lịch sử gửi lên, gồm attachment và file do tool trả về. Mức upstream OpenAI là 50 MB tổng/request. | Attachment PDF 25 MB + PDF do `read` trả 12 MB = 37 MB; thêm PDF 4 MB thành 41 MB thì app không gửi request đó. |
| Quota ứng dụng 40 MB cho file user đính kèm | Cộng byte gốc của mọi file người dùng kéo thả còn nằm trong lịch sử session, kể cả source code. Không tính tool output vào quota này. Đây là chính sách sản phẩm, không phải quota API. | Từ chối file mới trước khi thêm vào lịch sử nếu tổng vượt 40 MB; xóa file/session thì giải phóng quota. |
| Giới hạn app 20 MiB cho media mỗi file do `read` | Kích thước byte gốc của từng ảnh/tài liệu được tool đọc. Không thay thế giới hạn tổng request API. | Một PDF 20 MiB do `read` có thể bị từ chối nếu cộng nó vào lịch sử khiến tổng `input_file` đạt 40 MB. |
| Tổng payload `input_image` dưới 400 MB mỗi request (app) | Cộng độ dài payload đã serialize của tất cả ảnh trong lịch sử request. Toàn bộ JSON request cũng phải dưới 400 MB; upstream có giới hạn riêng và model còn có giới hạn patch/context. | Ảnh trong attachment và ảnh do `read` trả về cùng được cộng vào tổng 400 MB của request. |
| File code do user kéo thả | File text/code được kéo thả gửi dạng `input_file`, nên cộng vào tổng app 40 MB cùng các tài liệu khác. Ảnh raster gửi dạng `input_image`. Cả hai thuộc quota app 40 MB user attachment. | Source code kéo thả cộng vào tổng cùng PDF/CSV. |
| Base64 khi truyền inline | Là cách biểu diễn byte trong JSON, không phải một file thứ hai. Chuỗi Base64 lớn hơn byte gốc khoảng một phần ba; cần theo dõi riêng kích thước request đã serialize. | File gốc 20 MiB tạo ra khoảng 26,7 MiB Base64. Tài liệu API nêu giới hạn theo kích thước file; không nên mặc định giới hạn file đó cũng là giới hạn toàn bộ HTTP body. |
| File UTF-8 được `read` thành text | Không phải `input_file`, nên không tính vào tổng 40 MB file inputs; vẫn tiêu tốn kích thước request và ngữ cảnh/token. | Đọc source code 100 KB không làm tăng tổng `input_file`, nhưng vẫn làm prompt dài hơn. |

## Luồng hoạt động với Responses API

1. Gửi lịch sử hội thoại đã lưu dưới dạng input item của Responses API, kèm định nghĩa function `read`. Lịch sử gồm message thông thường và các assistant output/function output đã phát sinh.
2. Đọc các sự kiện SSE của Responses, giữ các output item đã hoàn tất và tiếp tục phát text delta cho renderer như hiện tại.
3. Với từng output item `function_call`, chạy `read` theo JSON arguments của item đó.
4. Tạo `function_call_output` gắn đúng `call_id`. Kết quả text dùng string; với ảnh/tài liệu, adapter chuyển byte gốc thành Base64 data URL rồi đặt vào content part `input_image` hoặc `input_file` tương ứng.
5. Lưu các response output item và `function_call_output` vào lịch sử, rồi gửi lại toàn bộ lịch sử ở request kế tiếp. Lặp đến khi response không còn function call. Trước khi gửi, kiểm tra giới hạn input_file/ảnh trên toàn bộ media có trong request.

`EasyInputMessage` dùng cho system/developer/user/assistant message thông thường. Kết quả tool phải dùng `FunctionCallOutput`; nội dung ảnh/file nằm trong trường `output` dưới dạng content part có kiểu tương ứng.

## Phân biệt `@` file trong workspace và kéo thả file

Hiện tại UI chưa triển khai xử lý `@` hoặc đính kèm file thật: placeholder chỉ ghi “Type @ to attach files”, còn nút attach đang hiển thị mock. Đề xuất behavior khi triển khai:

- **Chọn file bằng `@`:** gửi một tham chiếu workspace (đường dẫn tương đối và tên hiển thị) cùng prompt, không upload byte/Base64 ngay. Model có thể gọi `read` với đường dẫn đó khi cần. Quyền đọc, giới hạn text/media và xác thực đường dẫn của `read` vẫn được áp dụng. Nếu `read` trả PDF/Office/ảnh, nội dung đó được gửi sau dưới dạng tool output và vẫn phải qua giới hạn API của request.
- **Kéo thả file vào prompt:** coi là file đính kèm do user chủ động cung cấp; gửi nội dung file cùng user message, không cần model gọi `read` trước. File text/code/tài liệu được API hỗ trợ gửi bằng `input_file`; ảnh raster gửi bằng `input_image` theo loại content mà Responses API hỗ trợ. Tính byte gốc vào quota user attachment 40 MB. File code kéo thả cũng tính vào tổng app 40 MB `input_file` của request.
- **Khác biệt chính:** `@` trao cho model một đường dẫn để đọc theo nhu cầu qua tool và quyền harness; kéo thả cung cấp nội dung file ngay trong input của user. Không tự đọc/đính kèm toàn bộ nội dung của file được chọn bằng `@` trước khi model yêu cầu.

### Quy tắc dispatcher cho `read`

| Loại nội dung được xác định | Content part gửi trong `FunctionCallOutput.output` | Ghi chú |
| --- | --- | --- |
| File UTF-8 text/code hợp lệ | `input_text` | Bao gồm các file text/code thông thường; tuân theo giới hạn text và phân trang của `read`. |
| CSV | `input_file` | Ngoại lệ có chủ đích dù CSV thường là UTF-8, để dùng luồng phân tích bảng tính của API. |
| PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX | `input_file` | Gửi byte file bằng `file_data` Base64 data URL; không parse Office cục bộ trong giai đoạn này. |
| PNG, JPG/JPEG, GIF tĩnh, WebP | `input_image` | Gửi ảnh bằng data URL Base64; GIF động bị từ chối. |
| File UTF-8 hợp lệ khác chưa có parser chuyên biệt | `input_text` | Chỉ khi giải mã UTF-8 hợp lệ và không phải định dạng có xử lý API riêng như CSV. |
| File nhị phân không hỗ trợ, hỏng hoặc không xác định | Lỗi tool rõ ràng | Không biến byte không rõ loại thành `input_text` hay `input_file` tùy tiện. |

`input_file` không phải kiểu tổng quát cho mọi byte nhị phân; ảnh phải dùng `input_image`. `FunctionCallOutput` cho phép output chứa text, image hoặc file content parts. ([File inputs](https://developers.openai.com/api/docs/guides/file-inputs), [Images and vision](https://developers.openai.com/api/docs/guides/images-vision), [Function calling](https://developers.openai.com/api/docs/guides/function-calling))

## Các file dự kiến thay đổi

- Tạo `docs/tools.md` bằng tiếng Việt: tài liệu chuẩn về hợp đồng tool `read` và mẫu để mô tả các tool trong những lần refactor sau.
- Sửa `src/domain/chat/types.ts`: thêm kiểu input/output/content item của Responses API.
- Sửa `src/domain/chat/chat-client.ts`: payload Responses endpoint, SSE event, output item hoàn tất và ánh xạ schema function tool.
- Sửa `src/harness/agent/agent-loop.ts`: tích lũy Responses output item và liên kết call/output.
- Sửa `src/harness/agent/tool-registry.ts`: cho phép kết quả tool là typed content thay vì chỉ string.
- Sửa `src/harness/execution/execution-environment.ts` và `src/harness/execution/local-execution-environment.ts`: đọc byte có giới hạn cùng các kiểm tra đường dẫn an toàn.
- Sửa `src/harness/tools/read-tool.ts`: phân loại file, xác thực, định tuyến kết quả text/media/tài liệu và giữ nguyên kiểm tra quyền.
- Sửa `src/harness/session/conversation-store.ts` và `src/harness/session/in-memory-conversation-store.ts`: lưu/clone typed Responses history cùng reference đến snapshot media trong bộ nhớ; chưa triển khai SQLite.
- Chỉ cập nhật test hiện có sau khi được duyệt và khi việc xác minh implementation được cho phép.

## Danh sách công việc

- [x] Sau khi duyệt plan, tạo `docs/tools.md` bằng tiếng Việt, ghi hợp đồng `read` và quy ước cập nhật cho tool mới.
- [x] Định nghĩa union type cho kết quả text, ảnh, file; cùng kiểu Responses function call/output.
- [x] Chuyển model adapter từ Chat Completions `choices[].delta` sang Responses streaming event, giữ nguyên sự kiện text delta cho UI.
- [x] Cập nhật agent loop để lưu Responses output item và gắn từng kết quả tool vào đúng `call_id` trong lịch sử phát lại.
- [x] Bổ sung đọc byte an toàn, có giới hạn vào `ExecutionEnvironment` mà không làm yếu kiểm tra đường dẫn hiện tại.
- [x] Bổ sung phân loại và định tuyến file UTF-8, ảnh và các định dạng tài liệu đã liệt kê.
- [x] Thực thi các giới hạn đã chốt và trả lỗi cụ thể cho định dạng không hỗ trợ hoặc dữ liệu không khớp.
- [x] Giữ nguyên database, lưu artifact, compaction session và các tool khác trong giai đoạn này.
- [x] Đối chiếu implementation với `docs/tools.md`; chưa bắt đầu refactor tool khác cho tới khi hợp đồng `read` ổn định.

## Các điểm cần xem lại

- JPG/JPEG và trường hợp MIME/chữ ký file không khớp phải được phân loại chính xác.
- GIF động không được gửi như thể đó là ảnh GIF tĩnh được hỗ trợ.
- DOCX/XLSX/PPTX là ZIP container; xác minh cấu trúc package thay vì chỉ tin phần mở rộng.
- Kết quả text, ảnh, PDF và Office phải gắn đúng Responses `call_id` và hoạt động qua nhiều vòng tool trong cùng session.
- Mỗi request phải tuân thủ giới hạn media của endpoint trên toàn bộ lịch sử được phát lại. Quota attachment 40 MB chỉ phân loại theo nguồn user; không được bỏ qua tool media khi kiểm tra giới hạn API.
- `columnOffset` tiếp tục dòng dài theo vị trí UTF-16 trong dòng; khi cắt trang không được tách đôi surrogate pair.

## Ngoài phạm vi

Thêm tool mới; luồng file đính kèm do người dùng gửi; trích xuất video/audio; tự phân tích PDF/Office ở máy; migration SQLite; lưu artifact bền vững; quản lý context/compaction; thiết kế lại MCP, plugin hoặc skill; thay đổi database schema.

## Tài liệu tham khảo

- [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state)
- [File inputs](https://developers.openai.com/api/docs/guides/file-inputs)
- [Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
- [Function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [Create a model response](https://developers.openai.com/api/reference/resources/responses/methods/create)
