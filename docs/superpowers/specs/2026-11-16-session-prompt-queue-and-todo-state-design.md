# Thiết kế queue prompt theo session và trạng thái todo

## Mục tiêu

- Mỗi session có một `AgentLoop` coordinator được cache, khởi tạo lười khi prompt đầu tiên bắt đầu. Mỗi user prompt gọi `run` riêng; vòng model → tool → tool result → model bên trong cùng một prompt giữ nguyên todo state của lượt đó.
- Prompt trong cùng session chạy tuần tự theo FIFO. Runtime là nguồn chuẩn cho prompt đang chạy và prompt đang chờ; UI hiển thị prompt chờ và chuyển prompt kế tiếp thành prompt hiện tại khi lượt trước kết thúc.
- Todo thường thuộc về một user prompt: prompt mới bắt đầu danh sách mới.
- Todo gắn với cùng một goal được giữ xuyên các prompt khi goal đó vẫn được chọn. Sửa nội dung goal không tự xóa checklist; đổi goal hoặc reset rõ ràng mới đổi scope.
- Cập nhật một todo là cập nhật từng phần: những todo không có trong lần gọi `todowrite` vẫn giữ nguyên. Runtime phát snapshot đầy đủ sau mỗi lần cập nhật.

## Hiện trạng và nguyên nhân

`HarnessRuntime` hiện nối `Promise` theo `sessionId`, nên request có chạy tuần tự nhưng không có queue state để UI đọc. `WorkspacePage` thay `turn` và `activeRequestId` mỗi lần gửi prompt, khiến prompt đang chạy có thể bị UI bỏ qua khi prompt mới được gửi.

`AgentLoop` chạy trọn vòng tool bên trong một lần `run`; conversation history nằm trong `ConversationStore`. Cache coordinator theo session giúp có đúng một điểm điều phối cho session, nhưng không cần giữ model hoặc HTTP dispatcher ở đó. `ChatClient` tạo `StreamingHttpClient`, và mỗi `StreamingHttpClient` tạo một Undici `Agent` dispatcher. Vì thế `ChatModel` và `ToolContext` được truyền theo từng prompt để model/approval/environment có thể đổi và dispatcher không bị giữ idle cùng session. Todo tool hiện thay toàn bộ danh sách mỗi lần gọi, còn UI khởi tạo danh sách rỗng khi prompt mới bắt đầu.

## Các hướng đã cân nhắc

1. Giữ Promise chain và để UI tự giữ queue: ít sửa runtime, nhưng runtime và UI phải duy trì hai bản thứ tự riêng.
2. Chuyển sang FIFO queue tường minh trong runtime, phát event queued/started/completed để UI đồng bộ: runtime là nguồn chuẩn, hỗ trợ lifecycle rõ ràng. **Chọn hướng này.**

Về vòng đời agent, có hai lựa chọn:

1. Tạo `AgentLoop` cho từng prompt; history và state store giữ continuity. Ít lifecycle cache hơn, nhưng không khớp quyết định một coordinator cho mỗi session.
2. Cache một `AgentLoop` coordinator theo session, nhưng truyền `ChatModel` vào mỗi `run`; không cache `ChatClient`/dispatcher. **Chọn hướng này:** đúng vòng đời session mà người dùng muốn, hỗ trợ đổi model theo prompt và tránh giữ network dispatcher khi session idle.

Agent coordinator được tạo lười khi prompt đầu tiên của session bắt đầu, không phải khi app mở hoặc khi session chỉ được chọn. Model và `ToolContext` vẫn được tạo theo prompt. Nếu sau này cần tái sử dụng connection pool, cân nhắc cache transport/model theo endpoint và model thay vì theo session.

## Thiết kế

### Queue và vòng đời agent

- Runtime giữ queue riêng cho từng session, mỗi queue có prompt đang chạy và danh sách pending FIFO.
- Khi nhận prompt, runtime xếp nó vào queue; khi bắt đầu, runtime phát event có `requestId`/`sessionId` để UI chuyển prompt từ danh sách chờ sang khu vực đang chạy.
- Khi prompt hoàn tất hoặc lỗi, runtime lấy prompt kế tiếp. Prompt của session khác có thể chạy độc lập.
- UI không đổi prompt đang chạy chỉ vì user gửi thêm prompt. Nó hiển thị pending prompts riêng và gắn stream event vào request đang chạy tương ứng.
- Lấy một `AgentLoop` coordinator theo `sessionId`; nếu chưa có thì tạo lúc prompt đầu tiên bắt đầu. Truyền model hiện tại vào `run`; mọi lượt gọi model do tool calls vẫn thuộc cùng `run` và không tạo todo scope mới.
- Cache `AgentLoop` chỉ sống trong process. Sau app restart, tạo lại coordinator lười khi session nhận prompt tiếp theo; history được lấy từ `ConversationStore` theo khả năng persistence hiện có.
- Queue state chỉ được giữ khi session có prompt đang chạy hoặc đang chờ; xóa queue state khi rỗng. Khi session bị xóa, runtime bỏ các prompt đang chờ; prompt đang chạy được phép kết thúc. Sau đó runtime giải phóng agent, queue và todo state của session, không chạy các prompt còn lại.

### Todo scope và cập nhật từng phần

- Prompt thường dùng scope duy nhất theo `sessionId` và `requestId`; scope mới bắt đầu với danh sách rỗng.
- Prompt có goal dùng scope theo `sessionId` và stable `goalId`; các prompt tiếp theo trong session chọn cùng goal sẽ tiếp tục danh sách đó. Chỉnh sửa nội dung goal không đổi identity. Goal khác có scope khác; todo scope được giải phóng khi xóa session. Cơ chế reset checklist chưa nằm trong thay đổi này.
- Todo scope được quản lý độc lập với `AgentLoop`, để scope prompt được giải phóng sau lượt còn scope goal tồn tại trong lúc goal còn được chọn.
- Todo item có stable `id`. Lần đầu thêm item có thể không có ID; tool tạo ID và trả snapshot có ID để model dùng cho các lần cập nhật sau.
- `todowrite` chỉ upsert item được gửi theo ID; không xóa item bị lược khỏi payload. Có thao tác rõ ràng để xóa/reset nếu sản phẩm cần.
- Sau mỗi cập nhật, tool phát toàn bộ snapshot trong scope hiện tại để UI hiển thị nhất quán.
- Goal selection/editor và cú pháp `@goal` không được tạo trong thay đổi này; thiết kế chỉ chuẩn bị scope contract để nối vào khi tính năng đó được triển khai.

## Ngoài phạm vi

- Thay đổi database schema hoặc lưu todo/queue bền vững qua lần khởi động lại app.
- Tạo UI/editor goal, cú pháp `@goal`, hoặc cơ chế versioning goal.
- Hủy, reorder, pause hay retry prompt đang chờ.

## Tiêu chí hoàn tất

- Nhiều prompt gửi nhanh trong một session chạy tuần tự; UI luôn hiển thị đúng prompt chạy và các prompt chờ.
- Prompt tiếp theo bắt đầu sau khi prompt trước hoàn tất hoặc lỗi; event cũ không ghi đè prompt đang chạy.
- Nhiều vòng tool trong một prompt dùng chung todo scope.
- Prompt thường mới có todo list mới; prompt của cùng goal giữ checklist goal.
- Cập nhật status của một todo không làm mất những todo khác.
