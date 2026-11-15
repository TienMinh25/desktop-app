# Tài liệu các tool

> Hợp đồng ngắn gọn về capability, định dạng vào Responses API và giới hạn. Mọi lần thêm hoặc refactor tool đều phải cập nhật bảng này.

| Tool / luồng | File hỗ trợ và mapping lên Responses API | Giới hạn mỗi file | Giới hạn session / request | Behavior khác |
| --- | --- | --- | --- | --- |
| `read` | UTF-8 text/code → `input_text`; CSV → `input_file`; PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX → `input_file`; PNG/JPG/JPEG/GIF tĩnh/WebP → `input_image`. | UTF-8: tối đa 20.000.000 byte/file. Ảnh/tài liệu đọc bằng tool: tối đa 20 MiB/file. Một trang text: tối đa 2.000 dòng và 100.000 byte; không cắt theo số ký tự/dòng. | Output của `read` không tính vào quota 40 MB dành cho file user kéo thả. Nhưng media tool trả về vẫn tính vào giới hạn API của request có phát lại lịch sử. | `offset` là số dòng từ 0; `columnOffset` là vị trí UTF-16 trong dòng đó, chỉ dùng cho UTF-8 và không cắt đôi emoji. CSV gửi `input_file` để dùng xử lý bảng tính. PDF có thể mang cả text và ảnh trang; Office không phải PDF chỉ trích xuất text, không gồm biểu đồ/ảnh nhúng. GIF động và binary không hỗ trợ bị từ chối. Giữ kiểm tra quyền đọc hiện có. |
| Kéo thả file vào prompt (behavior đã chốt; UI hiện mock) | File text/code/tài liệu → `input_file`; ảnh raster → `input_image`. File code kéo thả vẫn là `input_file`; không tự chuyển thành tool call. | App giới hạn mỗi file `input_file` dưới 40 MB; giới hạn tổng request cũng nghiêm hơn mức upstream. | Tối đa 40 MB byte gốc cho tổng file user kéo thả còn trong lịch sử session. Mỗi request phát lại lịch sử phải cộng mọi `input_file` và giữ tổng dưới 40 MB; tổng payload đã serialize của mọi `input_image` phải dưới 400 MB/request. Toàn bộ JSON request phải dưới 400 MB. | Khi luồng đính kèm được triển khai, file sẽ đi thẳng vào user input, không cần gọi `read`. Từ chối attachment vượt quota trước khi thêm vào lịch sử và báo dung lượng đã dùng/còn lại. |
| `@` file trong workspace (hành vi dự kiến) | Ban đầu gửi tham chiếu đường dẫn; khi model gọi `read`, dispatcher dùng mapping của `read` ở hàng trên. | Áp dụng giới hạn tương ứng của `read`. | Không tính vào quota user drag-and-drop 40 MB. Nếu `read` trả media, vẫn tính vào giới hạn API của request đang phát lại history. | `@` không upload nội dung ngay. Quyền và xác thực đường dẫn được xử lý qua `read`. UI hiện chưa triển khai `@` thật. |

## Cách tính kích thước

- Giới hạn theo file tính trên byte gốc. Khi gửi inline, `file_data`/data URL dùng Base64, làm payload tăng khoảng một phần ba; adapter cũng phải kiểm tra kích thước request đã serialize.
- Giới hạn ứng dụng `input_file` dưới 40 MB là tổng byte gốc của tất cả file trong **một request**, không phải mỗi session; mỗi file riêng cũng phải dưới 40 MB. Giới hạn chính thức hiện được OpenAI công bố là 50 MB tổng file/request, vì vậy mức 40 MB của app để lại khoảng đệm. Nếu request phát lại lịch sử, attachment và file do `read` trả về đều được cộng lại.
- Giới hạn ảnh dưới 400 MB là tổng byte UTF-8 của các data URL Base64 trong mọi `input_image` của **một request**, tính cả ảnh trong lịch sử được phát lại; không phải mỗi ảnh hay quota session. Toàn bộ JSON request đã serialize cũng phải dưới 400 MB.
- Các request còn bị giới hạn bởi context/token, kích thước/patch của từng ảnh và giới hạn model/provider.
- Loại file nhị phân không được hỗ trợ hoặc không xác định phải trả lỗi rõ ràng; không gửi nó như text.

Tham khảo: [File inputs](https://developers.openai.com/api/docs/guides/file-inputs) · [Images and vision](https://developers.openai.com/api/docs/guides/images-vision) · [Function calling](https://developers.openai.com/api/docs/guides/function-calling).

## Quy ước cập nhật

Khi thêm hoặc refactor tool, cập nhật cùng lúc: các file được hỗ trợ, mapping Responses API, giới hạn mỗi file, giới hạn session/request, quyền/approval và behavior đặc biệt. Viết bằng tiếng Việt, ngắn gọn và dùng bảng ở trên làm nguồn tra cứu chung.
