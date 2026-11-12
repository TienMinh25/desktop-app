# Thiết kế harness: hiện trạng và các bước tiếp theo

Tài liệu này mô tả implementation hiện tại, phân biệt phần đã làm với các adapter dự kiến, và hướng dẫn lần theo hệ thống để tìm hiểu cách hoạt động.

## Mục tiêu và ranh giới

- Electron quản lý cửa sổ, hộp thoại và kênh truyền dữ liệu giữa desktop với harness.
- Renderer chỉ dùng API giới hạn do preload cung cấp.
- Một Electron utility process riêng xử lý yêu cầu model, agent loop, tool registry, permission và lịch sử phiên trong bộ nhớ.
- Thiết kế chat backend sau này: gọi API chat chuẩn chung của công ty, request body tương thích OpenAI Chat Completions và xác thực bằng access token trong header `Authorization: Bearer <access_token>`. Login và credential flow chưa được triển khai; hợp đồng sản phẩm không dùng API key tĩnh.
- Việc lưu hội thoại nằm sau một interface. Hiện dữ liệu chỉ ở trong bộ nhớ; SQLite chờ schema do chủ dự án cung cấp.

## Luồng process và message

```text
React renderer
  │ desktop.sendHarnessCommand / desktop.subscribeHarnessEvents
  ▼
Preload (contextBridge; không để lộ ipcRenderer cho UI)
  │ ipcRenderer.send / ipcRenderer.on
  ▼
Electron main
  │ UtilityProcess.postMessage / UtilityProcess message event
  ▼
Harness utility process
  ├─ InMemoryConversationStore
  ├─ HarnessRuntime → AgentLoop → ToolRegistry → PermissionManager
  │                                      └→ tool executor → ExecutionEnvironment
  └─ OpenAIChatClient ── HTTP/SSE + Authorization: Bearer <access_token> (sau khi auth được nối) ──► API chat chuẩn của backend công ty
```

### Hợp đồng API chat dự kiến sau khi nối auth

Khi phần auth được triển khai, ứng dụng sẽ gọi một API chat chuẩn chung do backend công ty cung cấp; các model được chọn bằng trường `model` trong request theo schema tương thích OpenAI Chat Completions. Mỗi request sẽ mang access token còn hiệu lực trong header `Authorization: Bearer <access_token>`. Token sẽ do auth flow cung cấp qua credential interface trong process tin cậy; không hard-code, không đóng gói vào build và không dùng API key tĩnh. Auth flow sẽ chịu trách nhiệm refresh token hoặc yêu cầu đăng nhập lại khi token hết hạn. Hiện tại chưa có login, cấp/refresh access token hoặc gắn token vào chat request.

Trong code hiện tại có chênh lệch với hợp đồng dự kiến này: `OpenAIChatConfig` vẫn có trường `apiKey`, `OpenAIChatClient` dùng nó làm Bearer token, và `harness-server` đọc `CHAT_API_KEY`. Đây là wiring prototype chưa được nối auth, không phải cách xác thực sản phẩm; cần bỏ và thay bằng access token từ auth flow khi triển khai đăng nhập/backend thật.

### “Message port” ở đây có nghĩa gì?

Code hiện tại **không** tạo hoặc chuyển một `MessagePort`. Nó dùng API IPC của Electron utility process:

1. `utilityProcess.fork(...)` khởi chạy một Node.js child process do Electron quản lý.
2. Main gửi object có kiểu bằng `harnessProcess.postMessage(command)`.
3. Child lắng nghe `process.parentPort.on("message", event)` và đọc `event.data`.
4. Child phản hồi bằng `process.parentPort.postMessage(event)`.
5. Main nhận object qua `harnessProcess.on("message", ...)` rồi chuyển tiếp đến renderer bằng `webContents.send`.

Đây là kênh message giữa parent process và utility process do Electron quản lý, không phải thao tác chuyển `MessagePortMain`/`MessageChannelMain`. API `process.parentPort` trong child là đầu giao tiếp tương ứng. Việc tách process giữ công việc model/tool khỏi event loop của Electron main và tạo ranh giới process có thể thay thế. Bản thân nó không sandbox quyền truy cập filesystem hoặc shell.

`HarnessCommandSchema` dùng Zod để kiểm tra dữ liệu runtime tại IPC boundary; các kiểu TypeScript được suy ra từ schema bằng `z.infer`. Schema là nguồn định nghĩa duy nhất cho discriminant, enum, giới hạn chuỗi và các field được phép. Event kế thừa `BaseEvent` (`requestId`) hoặc `SessionEvent` (`requestId`, `sessionId`); handler UI dùng `switch` cùng `assertNever` để compiler báo khi union có event mới nhưng chưa được xử lý.

`HARNESS_COMMAND_TYPES` và `HARNESS_EVENT_TYPES` ở `contracts/message-types.ts` là constants dùng chung cho Zod schemas, định nghĩa event, message dispatch, event emit và UI handlers. File constants được giữ riêng để renderer có thể import discriminant mà không kéo Zod vào bundle UI. Trong composition root, `createChatModel(modelName)` là factory tạo `ChatModel` adapter cho model được chọn; hiện nó tạo `OpenAIChatClient` từ endpoint cấu hình. `ensureMcpToolsRegistered(workspacePath)` chạy trước model request đầu tiên để kết nối các MCP server, khám phá schema tool rồi đăng ký chúng vào registry để model nhận được danh sách tool.

MCP initialization hiện chỉ diễn ra một lần trong suốt vòng đời harness process. Nếu `MCP_SERVERS` bỏ trống `cwd`, server dùng workspace của prompt đầu tiên; những prompt sau dùng cùng client/process. Với nhiều workspace, hãy đặt `cwd` rõ trong từng cấu hình MCP; hỗ trợ client MCP riêng theo workspace cần tách tool registry/cache trước khi triển khai.

### Hai ranh giới sandbox khác nhau

Sandbox của Chromium renderer tách biệt với sandbox thực thi của harness. `BrowserWindow` đặt `contextIsolation: true` và `nodeIntegration: false`; từ Electron 20, renderer mặc định đã được sandbox, dù ứng dụng không đặt rõ `sandbox: true`. Cấu hình này giới hạn renderer truy cập API Node/Electron và buộc UI đi qua preload bridge hẹp. Nó **không** sandbox utility process: tool và shell command đã được cho phép vẫn chạy với quyền OS của người dùng desktop. [Sandbox process của Electron](https://www.electronjs.org/docs/latest/tutorial/sandbox)

Việc cần rà soát thêm về bảo mật Electron: main process hiện kiểm tra IPC có đến từ `BrowserWindow` của ứng dụng và xác thực payload theo type, nhưng chưa chặn điều hướng renderer hoặc tạo popup; HTML của renderer cũng chưa có Content Security Policy. Ứng dụng hiện chỉ tải renderer local hoặc dev server. Trước khi thêm nội dung remote hoặc không đáng tin cậy, cần giới hạn `will-navigate` và `setWindowOpenHandler`, xác thực sender frame/origin cho IPC, và đặt CSP phù hợp theo môi trường. Xem [danh sách kiểm tra bảo mật của Electron](https://www.electronjs.org/docs/latest/tutorial/security/).

## Luồng permission

```text
agent yêu cầu ToolRegistry chạy một tool
        │
        ▼
registry thu thập yêu cầu permission của tool
        │
        ├─ policy allow ───────────────► thực thi
        ├─ policy deny ────────────────► trả lỗi tool cho model
        └─ policy ask
              │ permission.required event
              ▼
         main chuyển yêu cầu tới UI
              │ Allow once / Deny
              ▼
         permission.respond command
              │
              └─ utility process hoàn tất yêu cầu đang chờ
```

Quyết định cho phép của người dùng chỉ áp dụng một lần và không được lưu lại. Policy mặc định:

| Tool | Mặc định | Phạm vi / ghi chú |
|---|---|---|
| `read` | Policy cho phép đọc trong workspace hiệu lực; hỏi nếu ở ngoài workspace hoặc thuộc đường dẫn/tệp chứa thông tin xác thực phổ biến như `.env`, `.ssh`, `.aws`, `.kube`, `.docker` và thư mục thông tin xác thực cloud | Chế độ duyệt của người dùng được áp dụng sau policy này. Có thể dùng đường dẫn tuyệt đối ở ngoài workspace; sau khi được duyệt, adapter xác thực descriptor đã mở với đường dẫn hiện tại và kết quả kiểm tra workspace trước khi đọc. Mỗi lần đọc trả tối đa 2.000 dòng và khoảng 50 KB; dòng dài hơn 2.000 ký tự bị rút gọn. Có thể gọi tiếp với `offset`; file lớn hơn 20 MB bị từ chối. |
| `write`, `edit`, `apply_patch` | Hỏi | Phải được duyệt trước khi sửa nội dung. `write` tự tạo thư mục cha còn thiếu. |
| `bash` | Hỏi | Chạy trong workspace đã chọn trên host OS. Mặc định 120 giây, trần 120 giây; kết quả gửi về model tối đa 50.000 byte tổng cộng giữa stdout/stderr và có thông báo nếu bị cắt. |
| `glob`, `grep` | Cho phép | Tìm kiếm dưới workspace hiệu lực bằng binary `@vscode/ripgrep` đi kèm; bỏ qua các thư mục dependency/generated phổ biến và giới hạn kết quả. `glob` trả về tệp khớp và thư mục cha không rỗng; `grep` giới hạn 500 kết quả và hỏi trước khi tìm trong đường dẫn nhạy cảm. |
| `webfetch` | Hỏi | Chỉ HTTP(S), timeout 30 giây, tải tối đa 5 MiB và gửi tối đa 50 KiB nội dung về model; có thông báo khi bị cắt. |
| `todowrite` | Cho phép | Giữ checklist trong bộ nhớ harness, không ghi ra đĩa. |
| `lsp` | Hỏi | Dùng language server cấu hình qua stdio. Hỗ trợ definition, references, hover và diagnostics. |
| `skill` | Hỏi | Chỉ liệt kê/tải `~/.ccodex/skills/<tên>/SKILL.md`. Khi tải, nội dung được thêm vào tool result/model context sau khi người dùng duyệt. App tạo `~/.ccodex` lúc khởi động; tool tạo `skills/` khi được dùng. |
| `mcp_*` | Hỏi | Tool được khám phá từ MCP server stdio local đã cấu hình; mỗi lần gọi đều cần duyệt. |

Có thể truyền rule qua `HARNESS_PERMISSION_RULES` dưới dạng JSON array có thứ tự gồm `{ "tool": "*" | "read" | "bash" | ..., "pattern": "glob-like resource pattern", "decision": "allow" | "ask" | "deny" }`. Ví dụ:

```json
[
  { "tool": "bash", "pattern": "git status*", "decision": "allow" },
  { "tool": "edit", "pattern": "**/*.env*", "decision": "deny" }
]
```

Rule khớp sau cùng sẽ được áp dụng. Giá trị mặc định nằm trong `PermissionManager`; JSON sai sẽ chặn chat thay vì âm thầm nới quyền. UI hiện có hai lựa chọn Allow once và Deny; không lưu các quyền cấp rộng.

Đây là bước duyệt ở tầng ứng dụng, không phải ranh giới bảo mật cứng. Utility process hiện có cùng quyền OS với desktop app. Cụ thể, shell command đã được duyệt có thể đọc hoặc sửa mọi thứ mà tài khoản người dùng truy cập được. Muốn cô lập thực sự cần một execution backend riêng, chẳng hạn platform sandbox; nên thiết kế phần này trước khi cho phép shell chạy không cần giám sát.

### OpenCode v2: policy permission và sandbox

Tuyên bố bảo mật của OpenCode nói rằng sản phẩm không sandbox agent: prompt permission giúp người dùng nhận biết và duyệt hành động; muốn cô lập thực sự thì phải tự chạy OpenCode trong Docker container hoặc VM. OpenCode không kiểm tra Docker có sẵn hay không để tự đổi runtime. Cài đặt local thông thường chạy tool với quyền của user trên host; người cần cách ly tự khởi chạy OpenCode bên trong container hoặc VM. Permission v2 là policy có thứ tự trên action/resource, đưa ra `allow`, `ask` hoặc `deny`; nó không đổi ranh giới process. Policy nền hiện tại của v2 khá thoáng với phần lớn action; đọc `.env` sẽ hỏi nếu chưa có rule khác. Vì vậy, OpenCode là tài liệu tham khảo tốt cho UX permission và điều phối tool, nhưng không phải ví dụ về tự dò Docker hoặc OS sandbox. [Tuyên bố bảo mật OpenCode](https://github.com/anomalyco/opencode/security), [hướng dẫn permission OpenCode v2](https://dev.opencode.ai/v2/docs/permissions)

OpenCode v2 biểu diễn permission bằng các rule `{ action, resource, effect }` có thứ tự; rule khớp sau cùng thắng. Resource có thể là path, command, URL, skill ID hoặc tên MCP server. Việc kiểm tra thư mục ngoài, thao tác file và shell dùng các action riêng. Trước khi chạy, luồng permission của shell quét command rồi ánh xạ subcommand/path thành permission resource; cú pháp không thể phân tích sẽ bị từ chối. Việc quét chỉ là biện pháp tốt nhất có thể, không sandbox shell. Từ thay đổi của OpenCode được merge ngày 2026-10-29, mọi release channel dùng `ShellScan` tự triển khai cho Bash, Zsh, POSIX sh và PowerShell thay cho các Tree-sitter WASM grammar trước đây. Đây là scanner nội bộ của OpenCode, không phải npm package tổng quát để đưa thẳng vào ứng dụng này. Kể cả có scanner, shell vẫn giữ quyền truy cập filesystem/process/network trên host. [Hướng dẫn permission](https://dev.opencode.ai/v2/docs/permissions), [PR thay scanner](https://github.com/anomalyco/opencode/pull/60332)

Cấu hình MCP của OpenCode hỗ trợ server local qua stdio và server remote qua Streamable HTTP, kèm OAuth, environment/header, timeout và thiết lập protocol. MCP có thể cung cấp tool, prompt, resource và instruction; mỗi server có identity và kết nối qua MCP protocol. Harness này hiện chỉ có client stdio local, nhưng giao phần protocol cho TypeScript SDK chính thức. [Hướng dẫn MCP server của OpenCode](https://dev.opencode.ai/v2/docs/mcp-servers/)

OpenCode có thể tìm skill dưới dạng các gói instruction: ban đầu agent thấy catalog ID/name/description, sau đó gọi `skill` để tải nội dung Markdown và đường dẫn supporting file của skill được chọn. OpenCode tìm trong thư mục project/global và thư mục tương thích; việc dùng skill được kiểm soát theo skill ID. Harness này chỉ đọc skill toàn cục trong `~/.ccodex/skills/<tên>/SKILL.md`; chưa có metadata riêng, supporting file hoặc tài nguyên đi kèm. [Hướng dẫn skill của OpenCode](https://dev.opencode.ai/v2/docs/skills/)

`question` của OpenCode là một tương tác riêng: nó tạm dừng turn, hiển thị ô nhập tự do cùng lựa chọn gợi ý, rồi tiếp tục sau khi có câu trả lời. Project này dùng cùng cách tách khái niệm: `question` có request/reply IPC có kiểu riêng và UI nằm trong chat; thao tác với OS vẫn dùng permission card. [Hướng dẫn tool và question](https://dev.opencode.ai/v2/docs/tools)

## Tool và điểm mở rộng

Mỗi tool triển khai `HarnessTool`: một OpenAI function definition, các bước tùy chọn để yêu cầu permission/chuẩn bị dữ liệu, và hàm `execute`. `ToolRegistry` cung cấp definition, parse đối số, thu thập yêu cầu permission, hỏi `PermissionManager`, rồi mới gọi tool. `HarnessRuntime` điều phối một turn và phát event có kiểu; module này không import Electron hay renderer.

### Agent loop: tool call, MCP tool và skill

`AgentLoop` lặp lại việc gửi hội thoại hiện tại cùng các tool definition trong registry đến chat model. Nó thu thập text và các mảnh tool call được stream về. Nếu phản hồi của assistant không có tool call thì turn kết thúc. Nếu có, loop chạy từng tool qua `ToolRegistry`, thêm assistant tool-call message và từng tool result vào lịch sử hội thoại, rồi gọi model lần nữa. Loop hiện không còn giới hạn cứng tám vòng: con số tám trước đây là hard stop tùy ý, khiến turn lỗi dù model vẫn còn việc. Vì vậy, nếu provider liên tục yêu cầu gọi tool, turn có thể chạy mãi; hủy request và đặt ngân sách cấu hình được là các guardrail cần bổ sung sau.

Ba khái niệm này khác nhau ở thứ model nhận được:

| Khái niệm | Model nhận được gì | Điều gì xảy ra khi được dùng | Ví dụ trong harness |
|---|---|---|---|
| Built-in tool | Tên function, mô tả và schema đối số trong mỗi request gửi model | `ToolRegistry` kiểm tra JSON, yêu cầu permission, chạy adapter rồi trả về một tool message | `read`, `bash`, `grep`, `question` |
| MCP tool | Cùng function schema như built-in tool, nhưng gắn namespace của MCP server đã cấu hình | MCP SDK chính thức gửi tool call tới server qua stdio local; ứng dụng hỏi permission mỗi lần gọi | Các mục `MCP_SERVERS` được khám phá ở prompt đầu tiên rồi đăng ký thành `mcp_<server>_<tool>` |
| Skill | Không nạp function thực thi từ skill; model dùng function `skill` để tìm hoặc tải instruction | Skill tool trả Markdown về dưới dạng tool result; nội dung trở thành model context và có thể hướng dẫn model chọn tool tiếp theo | `~/.ccodex/skills/<tên>/SKILL.md` toàn cục của app |

Tóm lại, tool thực hiện hành động; MCP là protocol và nguồn cung cấp thêm tool có thể gọi; skill đưa instruction để định hướng cách model dùng tool. MCP không bỏ qua registry hay luồng duyệt. Skill không phải code thực thi được sandbox; nó là text không đáng tin cậy được thêm vào hội thoại sau khi người dùng duyệt. Skill adapter chỉ trả nội dung `SKILL.md`, không tải các tài nguyên được liên kết.

`ToolRegistry.execute` lần lượt chạy `permissionRequests` của tool, bước `prepare` tùy chọn (có thể trả thêm yêu cầu permission và dữ liệu đã chuẩn bị), rồi mới chạy `execute`. Nhờ vậy tool có thể xác định path hoặc MCP identity thực tế trước khi xin quyền. Kết quả được trả cho `AgentLoop` dưới dạng message `role: "tool"` gắn với tool-call ID từ model. Lỗi cũng được trả dưới dạng tool message để model phản hồi hoặc thử cách khác. Tool `question` là tương tác đặc biệt với người dùng: nó chờ câu trả lời qua IPC có kiểu, không cấp quyền OS; permission approval vẫn dùng event và UI card riêng.

Các tool gọi `ToolContext.environment`, không gọi trực tiếp API filesystem hoặc shell của Node. `ExecutionEnvironment` định nghĩa resolve path, đọc/ghi text có giới hạn, liệt kê file, áp dụng patch và chạy command. Interface này là ranh giới thực hiện các thao tác OS cho một turn; `LocalExecutionEnvironment` là implementation chạy trên host hiện tại. Sau này có thể thay bằng OS sandbox hoặc remote executor mà không đổi schema tool hay agent loop. Adapter local hiện tại **không** cô lập OS: permission chỉ là cổng ở tầng ứng dụng, còn host command đã duyệt chạy bằng tài khoản desktop.

Đã triển khai: `read`, `write`, `edit`, `glob`, `grep`, `bash`, `apply_patch`, `lsp`, `webfetch`, `todowrite`, `question`, skill toàn cục trong `.ccodex` và MCP tool qua stdio local. Cấu hình MCP server dùng JSON trong `MCP_SERVERS`: `{ "name", "command", "args", "env", "cwd" }`. Mỗi server khởi chạy trong utility process, kết nối bằng SDK `@modelcontextprotocol/client` chính thức với legacy 2025 handshake, khám phá `tools/list`, rồi đăng ký tool có namespace để model dùng. Host hiện chỉ hỗ trợ transport stdio local; app chưa cấu hình remote HTTP hoặc OAuth.

`question` tạm dừng lần gọi agent hiện tại và hiển thị form trả lời tự do trong chat, có thể kèm lựa chọn gợi ý. Đây là tương tác hội thoại, không phải yêu cầu permission OS. Permission card vẫn có luồng Allow once / Deny riêng. `todowrite` giữ checklist nhỏ trong memory của process/session hiện tại, không lưu ra đĩa.

Cấu hình LSP server bằng JSON trong `LSP_SERVERS`: `{ "extensions", "command", "args", "languageId", "cwd", "env" }`. Manager dùng framing LSP qua stdio và giữ một process cho mỗi cặp server command/root. Implementation ban đầu gửi `initialize`/`didOpen`/`didChange` và hỗ trợ definition, references, hover, publish-diagnostics. Hiện chưa có document close, workspace edit, completion hoặc restart/backoff.

Skill là instruction bundle được nạp vào context, không phải executable tool. App tạo thư mục toàn cục `~/.ccodex` khi khởi động; tool skill tạo `~/.ccodex/skills` khi được dùng và chỉ tìm `~/.ccodex/skills/<tên>/SKILL.md`, không dò `.codex`, `.claude`, `.agents` hoặc thư mục skill trong project. Thư mục dữ liệu khác, chẳng hạn DB, do module sở hữu dữ liệu đó khởi tạo khi cần. Chỉ thư mục skill trực tiếp và file `SKILL.md` thường được chấp nhận; symlink bị bỏ qua/từ chối. Trước khi liệt kê hoặc nạp skill, tool sẽ hỏi người dùng.

`glob` và `grep` dùng binary `@vscode/ripgrep` (`rgPath`) mà không thông qua shell. Package này kèm binary ripgrep theo platform qua optional dependency nên người dùng không cần cài ripgrep riêng. Tool tìm dưới workspace hiệu lực và bỏ qua `.git`, `node_modules`, `dist`, `out`; `glob` có thể trả về thư mục khớp nếu thư mục đó chứa file. Ripgrep không liệt kê được thư mục rỗng. `grep` dùng regular expression của ripgrep và JSON output, bỏ qua file binary/quá lớn, đồng thời giới hạn output. `read` có thể resolve absolute path ngoài workspace hiệu lực; permission policy sẽ hỏi trước khi đọc path ngoài workspace hoặc thông tin xác thực nhạy cảm.

`apply_patch` dùng package JavaScript `diff` để parse và áp dụng unified patch, do đó không cần Git executable trên máy người dùng. Adapter hỗ trợ sửa, tạo và xóa file; từ chối rename/copy. Hiện chưa chọn cách đóng gói Git vì ứng dụng không cần Git cho tool này.

### Rà soát thư viện cho tool (chờ chủ dự án quyết định)

Bảng này mô tả implementation tại thời điểm rà soát và các thư viện phổ biến cùng lĩnh vực. Số sao GitHub được làm tròn và kiểm tra ngày 2026-11-06. `ripgrep` ở đây là công cụ tìm kiếm Rust upstream; wrapper Node [`@vscode/ripgrep`](https://github.com/microsoft/vscode-ripgrep) có khoảng 207 sao và cung cấp binary theo platform. Số sao thể hiện mức độ quan tâm, không khẳng định độ phù hợp API, tình trạng bảo trì, bảo mật hay giấy phép. Các thư viện ứng viên chỉ để tham khảo, trừ những mục ghi rõ đã dùng.

| Tool / ranh giới | Implementation hiện tại | Thư viện ứng viên và số sao ước tính | Độ phù hợp / đánh đổi |
|---|---|---|---|
| `read` | Lời gọi Node `fs` qua `ExecutionEnvironment`, có kiểm tra kích thước, text, path và permission | [`fs-extra`](https://github.com/jprichardson/node-fs-extra), 9,6k | Cung cấp hàm tiện ích filesystem, không phải lớp đọc an toàn cho agent. API `fs` sẵn có đã đủ và giúp policy path/permission dễ thấy hơn. |
| `write` | Node `fs` với kiểm tra path, symlink, kích thước và policy | [`fs-extra`](https://github.com/jprichardson/node-fs-extra), 9,6k | Hạn chế tương tự: API tiện ích không cung cấp ranh giới cấp quyền của app. Giữ adapter mỏng tự viết, trừ khi có tính năng filesystem cụ thể còn thiếu. |
| `edit` | Tìm và thay thế chính xác một đoạn text, từ chối nếu kết quả không duy nhất | [`diff` / jsdiff](https://github.com/kpdecker/node-diff), 9,2k | jsdiff tính và áp dụng diff, nhưng không triển khai hợp đồng tìm/thay chính xác, duy nhất của tool này. Không thay đổi chỉ vì số sao. |
| `glob` | Binary `@vscode/ripgrep` và adapter hẹp của app | [`ripgrep`](https://github.com/BurntSushi/ripgrep), 69,7k; [`glob`](https://github.com/isaacs/node-glob), 8,7k; [`fast-glob`](https://github.com/mrmlnc/fast-glob), 2,8k | Đã chọn ripgrep để tìm path nhanh; node-glob gần với ngữ nghĩa Bash glob hơn khi cần khớp thư mục rõ ràng. Ripgrep không trả thư mục rỗng. |
| `grep` | `@vscode/ripgrep` với JSON output, giới hạn kết quả và kiểm tra path nhạy cảm của app | [`ripgrep`](https://github.com/BurntSushi/ripgrep), 69,7k | Đã chọn; wrapper cung cấp binary, còn app tự xử lý permission, giới hạn output và cách hiển thị. |
| `bash` | `child_process.spawn` với host shell, timeout, output cap và permission prompt | [`execa`](https://github.com/sindresorhus/execa), 7,6k; [`node-pty`](https://github.com/microsoft/node-pty), 2,1k; [`tree-sitter-bash`](https://github.com/tree-sitter/tree-sitter-bash), 335; [`shell-quote`](https://github.com/ljharb/shell-quote), 66 | Execa giúp chạy process thuận tiện hơn nhưng không phải shell parser hay sandbox. node-pty dành cho terminal tương tác, thêm native/platform packaging; tool command chạy một lần hiện không cần PTY. tree-sitter-bash cung cấp grammar Bash, không có logic permission hoặc PowerShell. shell-quote xử lý quoting/tokenization, không phải scanner bảo mật đầy đủ. Scanner hiện tại của OpenCode nằm trong source của họ, không phải dependency tái sử dụng trực tiếp. |
| `apply_patch` | Package `diff` cùng kiểm tra path/symlink của app | [`diff` / jsdiff](https://github.com/kpdecker/node-diff), 9,2k | Đã dùng để không cần Git trên máy host. App vẫn quản lý policy workspace và ghi file an toàn. |
| `lsp` | Tự viết framing LSP stdio, request ID, process manager và định tuyến thao tác | [`vscode-languageserver-node`](https://github.com/microsoft/vscode-languageserver-node), 1,8k | Các package `vscode-jsonrpc`/protocol có thể thay framing và protocol type. Chúng không cung cấp language intelligence; việc đó do language server cài riêng đảm nhiệm. |
| `webfetch` | `fetch` tích hợp trong Node, chặn redirect, giới hạn thời gian/content type/kích thước response | [`undici`](https://github.com/nodejs/undici), 7,7k | Undici là HTTP client của Node và là nền tảng cho Node fetch. Tool GET có giới hạn hiện không cần thêm package; policy SSRF và redirect vẫn thuộc app. |
| `todowrite` | Checklist nhỏ trong memory theo session | Không cần | Đây là state của app, không phải bài toán persistence tổng quát. Không ghi vào database. |
| `question` | Request/reply IPC tự viết có type, pending-promise manager và form renderer | Không cần | Gắn với UI và vòng đời turn của app; package prompt tổng quát không thay được ranh giới này. |
| `skill` | Tự viết bước tìm file và tải nội dung `SKILL.md` | [`gray-matter`](https://github.com/jonschlinkert/gray-matter), 4,5k | Chỉ hữu ích nếu ta dùng YAML frontmatter metadata. Package không tự tìm skill, kiểm tra permission hoặc tải tài nguyên liên quan. |
| MCP host | MCP client SDK TypeScript chính thức, transport stdio, validation/namespace/permission adapter của app | [`modelcontextprotocol/typescript-sdk`](https://github.com/modelcontextprotocol/typescript-sdk), 13,7k | Đã chọn; SDK đảm nhiệm protocol, còn cấu hình và quyết định tin cậy vẫn do app quản lý. |
| Model client / tool loop | Tự viết OpenAI-compatible SSE decoder và agent loop | [`openai/openai-node`](https://github.com/openai/openai-node), 11,3k; [`vercel/ai`](https://github.com/vercel/ai), 27,8k | OpenAI SDK có thể thay phần API/SSE thủ công; Vercel AI SDK có thể thay thêm điều phối streaming/tool loop. Cần đánh giá adapter với endpoint OpenAI-compatible của công ty và hợp đồng approval/IPC hiện tại. |

Mẫu số chung: thư viện phổ biến xử lý primitive như duyệt filesystem, tìm regex, process stream, LSP framing hoặc model protocol; app vẫn cần schema tool, UI duyệt, policy path, giới hạn thực thi và ranh giới OS sandbox riêng. Trước khi chọn thêm thư viện, cần pin version, kiểm tra license và toàn bộ dependency graph để tìm CVE, rồi thêm behavior test theo hợp đồng tool hiện có.

| Ranh giới bảo mật | Implementation hiện tại / ứng viên tham khảo | Độ phù hợp / đánh đổi |
|---|---|---|
| Permission policy | `PermissionManager` tự triển khai; [`node-casbin`](https://github.com/apache/casbin-node-casbin), khoảng 2,9k sao, là authorization engine tổng quát cho ACL/RBAC/ABAC | Casbin có thể đánh giá policy model nhưng không cung cấp UI duyệt một lần, chuẩn hóa tool-resource, question flow hay sandbox của app. Có thể quá nặng với rule `allow`/`ask`/`deny` hiện tại. |
| OS sandbox | App chưa có sandbox; [`@anthropic-ai/sandbox-runtime`](https://github.com/anthropics/sandbox-runtime), khoảng 7k sao, là ứng viên sandbox ở tầng OS riêng | macOS dùng `sandbox-exec`; Linux dùng bubblewrap và `socat`; Windows đang alpha và dùng helper đi kèm. Windows cần cài một lần với quyền nâng cao để tạo sandbox account cấp máy và WFP rule. Mặc định account này được đọc profile người cài, trừ kho credential; có thể bỏ quyền profile đó. Cần cân nhắc kỹ chi phí cài đặt và quyền riêng tư trước khi dùng. Đây không phải sandbox OpenCode đang sử dụng. |

## Hỗ trợ LSP hiện tại

App không đóng gói hoặc cài language server. Tool `lsp` có thể làm việc với mọi ngôn ngữ nếu người dùng cấu hình command của LSP server trong `LSP_SERVERS`, bao gồm phần mở rộng file và `languageId` tùy chọn. Ánh xạ dự phòng extension sang language ID hiện có TypeScript (`.ts`), TSX, JavaScript, JSX, Python, Rust, Go; ngôn ngữ khác dùng `plaintext`. Chỉ có mapping này thì chưa có language intelligence. Các operation hiện dùng được là definition, references, hover và diagnostics. Máy người dùng phải có executable của server và server đó phải hỗ trợ ngôn ngữ tương ứng; nếu không, sau này cần quyết định cách cài/đóng gói.

## Kiểm tra bảo mật dependency

Tại ngày 2026-11-06, `bun audit` báo không có lỗ hổng đã biết trong dependency graph gồm 170 package theo lockfile. Electron runtime được kiểm tra riêng vì Electron đóng gói Chromium và Node, không nằm hoàn toàn trong advisory của dependency ứng dụng: lockfile đang dùng Electron 45.2.3, bản stable mới nhất trên release feed Electron ở thời điểm rà soát; release note có các bản vá Chromium/engine được backport. Các dải version bị ảnh hưởng trong advisory Electron cũng được đối chiếu với bản stable đã resolve. Một lượt kiểm tra advisory riêng đã rà jsdiff CVE-2026-24001 (đã sửa từ `diff` 8.0.3; app đang dùng 9.0.0) và advisory redirect của MCP SDK (đã sửa từ client 2.3.0; app dùng 2.4.0 và chỉ cấu hình stdio). Tham khảo [Electron release feed](https://releases.electronjs.org/release), [Electron security advisories](https://github.com/electron/electron/security/advisories), [jsdiff advisory](https://github.com/advisories/GHSA-73rr-hh4g-fpgx) và [MCP SDK advisory](https://osv.dev/vulnerability/GHSA-6prh-2h8m-c8cw). Đây là kết quả kiểm tra advisory tại một thời điểm, không đảm bảo các CVE chưa công bố hoặc phát sinh sau này; hãy chạy lại khi dependency/lockfile đổi và trước khi release.

## Trạng thái build và phân phối

`bun run build` gọi `electron-vite build` và tạo app đã compile trong `out/`. electron-vite bundle các process main, preload, renderer bằng Vite; nó không phải distribution packager và không tự tạo macOS `.dmg`/`.zip` hay Windows installer. [Hướng dẫn build electron-vite](https://electron-vite.org/guide/build)

Chủ dự án đã chọn **electron-builder** để package và phân phối. Chưa có cấu hình hoặc workflow electron-builder trong repository. `electron-builder` sẽ chạy sau `electron-vite build`, lấy output `out/` làm app, rồi đóng gói production dependencies. Các package được import lúc runtime — hiện gồm `diff`, `@vscode/ripgrep` và `@modelcontextprotocol/client` — phải tiếp tục nằm trong `dependencies`, không chuyển sang `devDependencies`. Nên đặt `appId` cố định và không đổi sau khi phát hành vì updater cần nhận diện cùng một ứng dụng qua các version.

### Đóng gói ripgrep theo platform và architecture

[`BurntSushi/ripgrep`](https://github.com/BurntSushi/ripgrep) là công cụ CLI upstream viết bằng Rust, cung cấp binary phát hành cho Windows, macOS và Linux. [`@vscode/ripgrep`](https://github.com/microsoft/vscode-ripgrep) là wrapper npm dành cho Node.js: nó cung cấp `rgPath` và cài binary tương ứng qua các `optionalDependencies` theo OS/architecture. `LocalExecutionEnvironment` đang import `rgPath` và gọi binary bằng `spawn`; người dùng cuối không cần cài ripgrep riêng.

Mỗi artifact app vẫn phải chứa binary có thể chạy trên đúng OS/architecture, nhưng workflow thông thường không cần tự tải binary từ repo BurntSushi hay tự viết bảng ánh xạ path. Khi cài dependency trên runner đúng target, package manager cài optional dependency tương ứng; electron-builder đưa production dependencies đó vào app. Để binary có thể chạy trong app dùng ASAR, cấu hình `asarUnpack` rõ ràng cho các executable trong `node_modules/@vscode/ripgrep-*/bin/**`, rồi kiểm tra artifact đóng gói bằng cách chạy `rgPath --version` trong smoke check. electron-builder có cơ chế tự phát hiện và unpack executable; khai báo rõ giúp việc đóng gói binary này dễ kiểm tra hơn. [Cách wrapper chọn và phân phối binary](https://github.com/microsoft/vscode-ripgrep), [quy tắc ASAR/unpack của electron-builder](https://www.electron.build/v26/docs/contents/)

Khuyến nghị build artifact riêng cho từng target trên runner phù hợp để dependency cài đúng binary: Windows x64 trên runner Windows x64; macOS Apple Silicon và Intel trên runner/kiểu build tương ứng. Nếu chỉ hỗ trợ Apple Silicon thì một artifact macOS arm64 là đủ cho target đó; nếu cần cả Intel thì phát hành thêm artifact x64. Có thể dùng `@vscode/ripgrep-universal` để lấy binary nhiều platform từ một lần cài, nhưng package lớn hơn đáng kể (khoảng 60 MB theo README của wrapper); chưa cần chọn hướng này khi có thể chạy build theo platform/architecture.

Target khuyến nghị: **NSIS installer cho Windows** và **DMG kèm ZIP cho macOS**. Không dùng Windows portable nếu cần `electron-updater` tự cài phiên bản mới. Để phân phối trực tiếp trên macOS cần code signing và notarization; Windows signing cũng nên có để giảm cảnh báo publisher. [Target auto-update được hỗ trợ](https://www.electron.build/v26/docs/features/auto-update/), [ký app và notarization](https://www.electron.build/v26/docs/features/code-signing/)

Script `build:win` hiện là bước PowerShell tự copy Electron runtime và `out/` thành zip. Nó không đóng gói dependency tree production, không đưa optional binary ripgrep đúng platform vào output, và không tạo Windows installer có updater; không dùng script này làm artifact phát hành. Có thể thay bằng script electron-builder sau khi cấu hình.

### Luồng phát hành và cập nhật ứng dụng

Nơi phát hành đã chọn là **update server riêng**, không phải GitHub Releases. Hướng triển khai được đề xuất là dùng `electron-updater` với Generic provider; electron-builder tạo installer và update metadata như `latest.yml`/`latest-mac.yml`, còn CI cần upload metadata cùng artifact lên update server. Generic provider không tự upload các file này. Bảo vệ endpoint bằng cơ chế xác thực backend và URL tải có thời hạn; không nhúng token cố định hoặc secret phát hành vào desktop app. [Auto-update của electron-builder](https://www.electron.build/v26/docs/features/auto-update/), [cấu hình publish](https://www.electron.build/v26/docs/publish/)

Quy trình release đề xuất: tăng version theo SemVer trong `package.json`, tạo tag như `v1.2.0`, để CI build theo platform/architecture rồi tải các artifact và manifest lên server. Khi app kiểm tra update ở lần khởi động hoặc theo lịch, nó tải bản mới ở nền; notification panel hiện có sẽ hiển thị version/trạng thái thật. Nút **Update now** chỉ gọi cài đặt và khởi động lại sau khi download hoàn tất. Nút và notification hiện tại trong `TitleBar.tsx` còn là UI mock, chưa kết nối updater, IPC hay server.

Hiện chưa triển khai electron-builder config, signing, CI release workflow, `electron-updater` hoặc hợp đồng API xác thực/tải từ update server. Cần chốt URL manifest/artifact và cách client lấy quyền tải update trước khi có thể kiểm tra end-to-end. [Tổng quan phân phối Electron](https://www.electronjs.org/docs/latest/tutorial/distribution-overview), [electron-builder](https://www.electron.build/)

## Ranh giới lưu hội thoại

`ConversationStore` cung cấp `getMessages(sessionId)` và `saveMessages(sessionId, messages)`. `InMemoryConversationStore` hiện là adapter và clone message array tại ranh giới interface. Harness server chỉ lưu sau khi agent run thành công. Khởi động lại process sẽ xóa lịch sử. Khi chủ dự án cung cấp schema SQLite, hãy viết adapter SQLite sau interface này; không để API agent/tool phụ thuộc vào bảng SQL.

`PermissionManager` và bước parse permission rule nằm trong `src/harness/permissions/`. Thư mục `agent` mô tả việc điều phối model/tool; `permissions` mô tả policy cấp quyền và chờ quyết định của người dùng. `PermissionRequirement` là ý định permission của tool trước khi runtime gắn request/session ID; `PermissionRequest` là yêu cầu đã có đầy đủ định danh gửi qua luồng duyệt UI.

## Lộ trình đọc: lần theo một prompt từ đầu đến cuối

1. [`WorkspacePage.tsx`](../src/desktop/renderer/pages/WorkspacePage/WorkspacePage.tsx): tạo request ID, gửi `chat.submit` cùng workspace tùy chọn và approval mode, rồi xử lý delta/approval event.
2. [`ConversationStream.tsx`](../src/desktop/renderer/pages/WorkspacePage/components/ConversationStream.tsx): hiển thị text stream và yêu cầu Allow once/Deny.
3. [`env.d.ts`](../src/desktop/renderer/env.d.ts) và [`preload/index.ts`](../src/desktop/preload/index.ts): định nghĩa bridge phía renderer; đọc cùng nhau để biết UI được cấp những khả năng nào.
4. [`commands.ts`](../src/contracts/commands.ts) và [`events.ts`](../src/contracts/events.ts): message có type đi qua ranh giới process/UI.
5. [`main/index.ts`](../src/desktop/main/index.ts): khởi chạy utility process và chuyển tiếp command, event, permission response.
6. [`harness-server/index.ts`](../src/harness-server/index.ts): entrypoint transport/composition; khởi tạo dependency runtime và xử lý message từ utility process.
7. [`runtime.ts`](../src/harness/runtime.ts): vòng đời turn headless, tuần tự hóa theo session, event và lời gọi persistence adapter.
8. [`conversation-store.ts`](../src/harness/session/conversation-store.ts) và [`in-memory-conversation-store.ts`](../src/harness/session/in-memory-conversation-store.ts): ranh giới lưu trữ và adapter hiện tại.
9. [`agent-loop.ts`](../src/harness/agent/agent-loop.ts): gửi message/tool definition, ghép các mảnh tool call được stream, chạy tool rồi tiếp tục loop.
10. [`tool-registry.ts`](../src/harness/agent/tool-registry.ts) và [`permission-manager.ts`](../src/harness/permissions/permission-manager.ts): dispatch tool, yêu cầu preflight, policy và chờ duyệt. `ApprovalMode`, `PermissionDecision`, `PermissionRequirement`, `PermissionRequest` là các tên riêng vì chúng biểu diễn bốn bước khác nhau: lựa chọn của người dùng, kết quả policy, ý định của tool và yêu cầu duyệt đã có định danh đầy đủ.
11. [`execution-environment.ts`](../src/harness/execution/execution-environment.ts) và [`local-execution-environment.ts`](../src/harness/execution/local-execution-environment.ts): ranh giới OS mà tool đang dùng và hợp đồng cho execution adapter sau này.
12. Chọn một tool trong [`src/harness/tools`](../src/harness/tools), rồi lần theo schema, bước chuẩn bị, permission của registry, lời gọi execution environment và kết quả.
13. Với LSP/MCP, lần theo tool adapter → manager/host → protocol client stdio.
14. [`openai-chat-client.ts`](../src/domain/chat/openai-chat-client.ts): HTTP request và SSE decoder; đây là ranh giới gọi endpoint công ty.

Lộ trình học gợi ý theo course outline: (1) kiến trúc harness và ranh giới dependency; (2) agent loop và chín tool cốt lõi; (3) sandbox thực thi và guardrail permission; (4) context, memory, skill, LSP và compaction; (5) subagent; (6) entrypoint remote/headless; (7) eval; (8) ghi và phát lại trace. Với desktop repo này, nên học Bun/TypeScript và Electron main/preload/renderer trước, sau đó đến typed IPC và harness process riêng; phần IPC được làm sớm có chủ ý để luồng duyệt và streaming kết nối thật tới UI.

### Tiến độ course và bước triển khai kế tiếp

- **Lesson 1 — kiến trúc:** phần lớn đã triển khai thành harness headless sau typed Electron IPC, với interface conversation store đang lưu trong memory.
- **Lesson 2 — agent loop và tool:** phần lớn đã triển khai, gồm streaming, tool dispatch, permission, `question`, MCP, LSP và các tool filesystem/search/shell cốt lõi.
- **Lesson 3 — sandbox và guardrail:** đã có permission policy và kiểm tra descriptor khi đọc, nhưng tool vẫn dùng `LocalExecutionEnvironment`; đặc biệt `bash` chạy bằng quyền desktop user. Lesson này chưa hoàn thành vì approval của app không phải OS isolation.
- **Lesson 4 — context engineering:** đã có skill toàn cục trong `.ccodex` và truy vấn LSP cơ bản; chưa có memory bền vững hoặc context-window compaction.

Module tiếp theo của course là Lesson 4, context engineering. Phần sandbox thực thi của Lesson 3 được chủ động để sau: chủ dự án chọn chạy trên host theo cách OpenCode thường dùng, để đơn giản hóa hỗ trợ macOS và Windows. Permission prompt vẫn chỉ là policy/UX ở tầng ứng dụng, không cô lập quyền OS. Tiếp tục Lesson 4 (memory, skill, phản hồi LSP và compaction) trong khi giữ rõ ranh giới bảo mật này; chỉ xem lại Docker hoặc OS sandbox native nếu sản phẩm cần isolation.

Tài liệu tham khảo: [course outline](https://github.com/decodingai-magazine/building-a-coding-agent-from-scratch-course#-course-outline), [hướng dẫn permission OpenCode v2](https://opencode.ai/v2/docs/permissions), [tool question của OpenCode v2](https://dev.opencode.ai/v2/docs/tools), [MCP TypeScript SDK chính thức](https://github.com/modelcontextprotocol/typescript-sdk), [ripgrep wrapper của VS Code](https://github.com/microsoft/vscode-ripgrep) và [API patch của jsdiff](https://github.com/kpdecker/jsdiff).

## Giới hạn implementation hiện tại

- Chưa có SQLite persistence hoặc schema database.
- Nếu chưa chọn workspace, thư mục home của user là execution root hiệu lực (`/Users/<user>` trên macOS và thư mục profile user trên Windows). Phạm vi file này khá rộng; thao tác ghi và shell vẫn tuân theo approval mode và permission rule đã cấu hình.
- Chưa có command hủy prompt hoặc khôi phục bền vững các yêu cầu permission đang chờ.
- Model client timeout sau 30 giây nếu chưa nhận response headers, hoặc 120 giây nếu stream không có chunk mới; không đặt deadline tổng cho lượt sinh. UI/runtime chưa cung cấp khả năng hủy prompt.
- Filesystem tool resolve và cấp quyền cho path trước khi chờ người dùng duyệt, rồi mới thực hiện thao tác. `readTextFile` mở file một lần, xác thực identity của descriptor với canonical path hiện tại và kiểm tra lại ranh giới workspace ban đầu trước khi đọc từ handle đó; vẫn hỗ trợ đọc ngoài workspace sau khi được duyệt rõ ràng. Thao tác thay đổi (`write`, `edit`, ghi/xóa patch) còn rủi ro time-of-check/time-of-use ở parent path và chưa phải OS sandbox nguyên tử. Toàn bộ filesystem boundary vẫn là policy tầng ứng dụng, không phải OS isolation.
- MCP dùng TypeScript SDK chính thức qua stdio local với legacy 2025 protocol negotiation; app chưa cấu hình remote transport/OAuth.
- LSP phụ thuộc executable language server bên ngoài, cấu hình theo phần mở rộng file; chưa có installer, completion hoặc restart/backoff.
- Skill discovery dùng duy nhất `~/.ccodex/skills`; app tạo `~/.ccodex` lúc khởi động, tool skill tạo thư mục con `skills` khi cần. Skill chỉ gồm `SKILL.md`, chưa tải các supporting files được skill tham chiếu.
- `LocalExecutionEnvironment` dùng host shell. Approval không tương đương OS sandbox; không yêu cầu hoặc cài Docker.
- Lịch sử session/sidebar trong renderer vẫn tách với harness storage; cần command snapshot/list session để mở lại hội thoại đang nằm trong memory.
- Permission UI và endpoint công ty chưa được thử cùng model thật có gọi tool.
