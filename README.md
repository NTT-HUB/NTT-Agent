# NTT Agent Desktop 0.29

Ứng dụng Windows để chat với AI, sửa code và chạy lệnh từ **thư mục dự án bạn chọn**. Bản 0.26 chạy terminal trực tiếp bằng **Windows PowerShell**, dùng các chương trình trên máy. Gemini và DeepSeek mở web ngay trong app và dùng chung phiên Google. Nhãn kết nối là **Session**.

## Cài và chạy

1. Cài Node.js để chạy mã nguồn. Terminal không yêu cầu Docker Desktop hay Linux containers.
2. Giải nén vào thư mục mới, chạy `start.bat` trong `NTTAgentDesktop`. Có thể chạy `npm install` rồi `npm start` bằng PowerShell.
3. Góc trên trái phải hiện **DESKTOP · v0.29.0**; nhãn terminal là **Windows · PowerShell**.
4. Chọn **Gemini** hoặc **DeepSeek → Session → Kết nối → Mở web trong app**.
5. Đăng nhập ở cửa sổ web vừa mở. Quay về app bấm **Kiểm tra** rồi gửi thử ở chế độ **Hỏi**.

Danh sách nhà cung cấp chỉ còn Gemini, DeepSeek và Other. ChatGPT, các lựa chọn Work/Thinking của ChatGPT và luồng Browser Link đã được gỡ. Không cần Chrome Session, extension hoặc mã kết nối. Cửa sổ Session thuộc Electron của app, không mở Chrome bên ngoài.

## Nâng cấp từ bản cũ

Đóng hẳn app cũ và giải nén bản này vào thư mục mới. Nếu từng cài NTT Browser Link, bạn có thể gỡ extension đó trong Chrome. Bản mới không dùng extension; app dọn đăng ký helper 0.20 khi đăng ký đó trỏ đúng thư mục dữ liệu của app hiện tại. Những bản mã nguồn trước vẫn là các ZIP riêng của bạn.

Từ 0.26, terminal và `run_command` dùng shell native của máy. Lịch sử cũ có thể nhắc Bash hoặc `/workspace`; hướng dẫn Agent mới cung cấp đúng đường dẫn dự án và cú pháp PowerShell. Các thiết lập mạng/RAM container cũ không còn áp dụng và công tắc mạng giả lập đã được gỡ.

Model và API key của nhà cung cấp đã gỡ được xóa khỏi cấu hình khi nâng cấp. Lịch sử chat, đường dẫn dự án và cài đặt Gemini/DeepSeek được giữ.

Bản 0.22 dùng lại profile Gemini của 0.21 làm profile chung, giữ phiên Google đã đăng nhập nếu vẫn dùng cùng thư mục dữ liệu app. Profile DeepSeek riêng cũ không bị xóa nhưng không còn được sử dụng; hãy chọn **Đăng nhập bằng Google** ở DeepSeek một lần để liên kết trong profile chung. Không cần nhập lại mật khẩu nếu Google chấp nhận phiên hiện có; Google vẫn có thể yêu cầu xác minh lại.

## Session trong app

Bản 0.27 tự thử lại request DeepSeek khi máy chủ trả `generation_err`, bao gồm thông báo `服务器暂时不可用`. Cùng `backend_err` và `Failed to fetch`, mỗi bước gọi model được thử tối đa ba lượt, có trạng thái báo đang thử lại. Agent giữ nguyên bước và dữ liệu đã hoàn thành, chỉ gửi lại request model đang lỗi. Nút Dừng hủy cả bước chờ thử lại. Sau ba lượt vẫn lỗi, app hiện thông báo cuối cùng để tránh vòng lặp vô hạn.

Bản 0.25 đối chiếu trực tiếp mã trong `NTTCodeX_v0.6.55_Undo_Redo_Toolbar_SOURCE(2).zip` bạn gửi:

- Request DeepSeek dùng đúng header 2.2.0/zh_CN, body và chuỗi tạo chat → challenge → Worker → completion của mobile. Cả bốn tổ hợp Thinking/Web Search được so sánh với request ghi nhận khi chạy đoạn JavaScript gốc mobile trong môi trường giả lập.
- Chờ token sẵn sàng tối đa 30 lần, cách nhau 500 ms; không bắt buộc ô nhập web xuất hiện. Đổi Thinking/Web Search vẫn giữ `chat_session_id` và `parent_message_id` như mobile.
- HTTP không thành công, trừ 401/403, được thử một lần với hội thoại mới như mobile. Thông báo `backend_err` có cấu trúc và `Failed to fetch` thử tối đa ba lượt ở tầng gửi. Nếu máy chủ tiếp tục lỗi, app báo lỗi cuối cùng.
- Giữ bộ đọc PC đã sửa: nội dung theo đường dẫn/fragment, BATCH, snapshot, `toast`/`hint`, `finish_reason` và lỗi nghiệp vụ HTTP 200. Phần suy nghĩ/metadata tìm kiếm không được đưa cho Agent như một câu trả lời cuối. Thông báo không có nội dung ghi cấu trúc gói, không ghi giá trị token/cookie/prompt.

Đối chiếu chi tiết trong `MOBILE_DEEPSEEK_PORT.md`. Đây là bản chuyển mã nguồn đã kiểm tra bằng request giả lập, chưa xác nhận gửi thành công bằng tài khoản thật trên Windows.

- Gemini, DeepSeek và các cửa sổ đăng nhập Google dùng chung một profile lưu trên máy. Đăng nhập Google ở một cửa sổ có thể được dùng lại ở cửa sổ còn lại. DeepSeek vẫn cần bước **Đăng nhập bằng Google**/chọn tài khoản hoặc xác nhận khi trang yêu cầu: tài khoản dịch vụ DeepSeek khác tài khoản Gemini. Dữ liệu này tách khỏi Chrome trên máy.
- App mở trang chính thức trong cửa sổ web của Electron. Các cửa sổ đăng nhập phụ dùng cùng partition. Nội dung web không có Node.js hoặc preload của app; context isolation, sandbox và web security được bật.
- **Gemini:** chọn model trong mục Gemini Session rồi gửi như bình thường. Model cần được tài khoản cấp quyền. **4 Argon** dùng route Session của Argon.
- **DeepSeek:** có DeepThink và Web Search bật độc lập hoặc cùng lúc. Hai nút gửi `thinking_enabled`/`search_enabled` trong mỗi request; đổi nút vẫn tiếp tục hội thoại hiện tại. **Dọn chat** bắt đầu hội thoại mới.
- **Đặt lại Session** đóng cửa sổ và popup của nhà cung cấp đang chọn, đặt lại hội thoại và dữ liệu lưu của trang đó. Với DeepSeek, thao tác này xóa thêm cookie DeepSeek nên cần đăng nhập lại. Với Gemini, cookie Google được giữ để không làm mất đăng nhập chung. Không xóa toàn bộ profile/cache của hai bên. **Dọn chat** chỉ xóa lịch sử app và đặt lại hội thoại, giữ phiên đăng nhập.
- App chỉ chạy các hàm Session cố định trên đúng origin nhà cung cấp, không chạy chúng trên trang đăng nhập khác origin. Đóng app sẽ đóng các cửa sổ Session thuộc app.
- Endpoint web và đăng nhập có thể bị nhà cung cấp từ chối. Dùng chung profile không thay đổi việc nhà cung cấp có chấp nhận trình duyệt này hay không. Chưa kiểm tra đăng nhập bằng tài khoản thật trên Windows trong môi trường xây dựng này.
- `Failed to fetch` và thông báo tạm lỗi `backend_err`/`generation_err` được thử tối đa **3 lượt** cho mỗi bước gọi model. Lỗi xác minh hoặc quyền truy cập được báo để bạn kiểm tra cửa sổ web.

## API key và Other

**API key** hỗ trợ Gemini và DeepSeek. Khóa được mã hóa trên máy bằng Electron `safeStorage`/Windows DPAPI. Gemini Argon API dùng Interactions, các model Gemini còn lại dùng GenerateContent.

**Other** cho phép nhập URL backend, model và API key theo giao thức Messages tương thích `/v1/messages`. HTTP chỉ được dùng với localhost; endpoint local có thể không cần key. Model phải được backend đó hỗ trợ.

## Dự án, bộ nhớ và Agent

Bản 0.29 hướng dẫn Agent tự thực thi file/script qua `run_command` để hoàn thành tác vụ. Cài Python hoặc kiểm tra phiên bản chỉ là bước chuẩn bị: nếu cần script trung gian, Agent phải ghi file, chạy bằng interpreter đã cài (kể cả đường dẫn exe tuyệt đối), đọc output/exit code và kiểm tra kết quả trước khi kết thúc. Khi phát hiện cách nói giao lại bước chạy như “Bạn có thể chạy lệnh dưới đây” trong tác vụ yêu cầu thực thi, app yêu cầu model tiếp tục trả hành động công cụ, tối đa ba lần liên tiếp. App không lấy code trong câu trả lời để chạy trực tiếp. Đây là nhận diện các cách nói phổ biến, không bảo đảm mọi model luôn hoàn thành được tác vụ.

Chế độ Hỏi và yêu cầu chỉ hướng dẫn/không chạy vẫn được giữ. Nếu công cụ báo lỗi thực thi thật, app cho phép báo lỗi đó; câu hỏi cần bạn quyết định vẫn dừng chờ lựa chọn. Lệnh đã chạy thành công và được nhắc lại nguyên văn trong tài liệu sử dụng không bị yêu cầu chạy lại. Luồng này được kiểm tra bằng model giả lập và tiến trình Node thật tạo file kết quả trong thư mục có dấu/khoảng trắng; chưa kiểm tra bằng tài khoản AI thật trên Windows.

Bản 0.28 bỏ hướng dẫn cũ cấm Agent cài phần mềm ngoài dự án. Khi bạn yêu cầu cài hoặc tác vụ đang thiếu runtime/thư viện cần thiết, Agent được tự kiểm tra, cài rồi tiếp tục; ưu tiên phạm vi tài khoản hiện tại và môi trường `.venv` của dự án. Agent dùng quyền Windows hiện có, không tự nâng quyền/vượt UAC; nếu công cụ thực sự yêu cầu thao tác của bạn thì báo lỗi thực tế. Phần mềm vẫn cần được tải từ nguồn chính thức. Sau khi cài phải kiểm tra phiên bản/chạy thử trước khi báo thành công.

Mỗi lệnh PowerShell đọc thêm PATH hiện tại của User/Machine để nhận chương trình vừa cài; chỉ bổ sung PATH cho tiến trình lệnh, không ghi biến môi trường hệ thống. `run_command` cho phép model chọn `timeoutMs` từ 1 giây đến 15 phút, mặc định 2 phút; có thể dùng 10–15 phút cho bộ cài. Nút Dừng vẫn kết thúc cây tiến trình đang chạy. Việc cài thành công còn phụ thuộc WinGet/bộ cài, mạng và quyền tài khoản. Chưa thử cài Python thật trên Windows trong môi trường xây dựng này.

- **Phân vùng bộ nhớ** là thư mục bạn chọn trên máy. File tạo/sửa nằm ngay trong thư mục đó, không sao chép project sang nơi khác.
- **Editor** tự tô màu theo đuôi HTML/XML, CSS, JS/TS, JSON, Python, PHP, Lua, shell, Markdown và SQL. `Ctrl+S` lưu; file lớn chuyển sang văn bản thường để gõ nhanh hơn.
- **Terminal** và `run_command` chạy bằng Windows PowerShell với thư mục bắt đầu là folder dự án đã chọn. Python/Node/PHP/Lua/Git dùng bản đã cài trên Windows và có trong `PATH`. Không còn bước kiểm tra/build Docker image. Nút **Chạy file** chọn đúng lệnh Windows, kể cả tên file có dấu/khoảng trắng; Python ưu tiên `py -3`, sau đó `python`.
- **Phạm vi:** công cụ đọc/ghi file tiếp tục chặn đường dẫn vượt project và symbolic link. Lệnh terminal chạy bằng quyền tài khoản Windows hiện tại; thư mục bắt đầu không phải vùng cách ly hệ điều hành. Không có giới hạn RAM/CPU hay chặn mạng theo container. Agent lưu mã nguồn trong dự án và được cài môi trường cần thiết ngoài dự án theo quyền mô tả trên.
- **Dừng** kết thúc cây tiến trình của lượt đang chạy. Lệnh do Agent gọi có timeout mặc định 2 phút, có thể chọn tối đa 15 phút; lệnh bạn nhập ở Terminal chạy đến khi xong hoặc bấm Dừng. Mỗi lượt bắt đầu lại tại folder dự án, nên `cd` của lượt trước không được giữ. Output giữ tối đa 96 KB, có cờ báo cắt bớt.
- **Hỏi** chỉ trả lời. **Agent** dùng `list_files`, `read_file`, `write_file`, `run_command`; mỗi lệnh cần JSON hợp lệ và lý do. Tối đa 48 bước, tự tiếp tục khi model báo nhầm quota công cụ bằng 0 hoặc yêu cầu nhắn “tiếp”. Khi thật sự cần bạn lựa chọn, app hiện các nút lựa chọn và dừng chờ.

## Mã nguồn và kiểm tra

| Đường dẫn | Vai trò |
| --- | --- |
| `main.cjs`, `preload.cjs` | Cửa sổ app và IPC |
| `lib/web-session.cjs` | Cửa sổ web trong app, partition và kiểm tra origin |
| `lib/private-session.cjs`, `lib/session-scripts/` | Request/parser Gemini và DeepSeek Session |
| `lib/deepseek-response.cjs` | Đọc nội dung, trạng thái và lỗi DeepSeek; dùng chung trong app và kiểm tra |
| `test/mobile-deepseek-parity.test.cjs`, `test/fixtures/deepseek-mobile-wire.json` | So sánh request PC với JavaScript gốc trong file mobile vừa gửi |
| `lib/agent.cjs`, `lib/territory.cjs` | Luồng Agent, đường dẫn dự án và thao tác file |
| `lib/native-terminal.cjs`, `renderer/terminal-commands.js` | PowerShell native, timeout/dừng tiến trình và lệnh Chạy file |
| `lib/providers.cjs`, `lib/settings.cjs` | API, key và lịch sử |
| `renderer/` | Giao diện và tô màu code |

Chạy `npm test` để kiểm tra logic Agent, request/parser, partition/cửa sổ Session giả lập, đường dẫn dự án và terminal. Kiểm tra native trên môi trường hiện tại chạy tiến trình Node thật, bao gồm tạo file, output UTF-8, mã lỗi, dừng và timeout. Nhánh PowerShell/taskkill được kiểm tra giả lập, chưa chạy bản Electron thực tế trên Windows. Tạo bộ cài Windows bằng `npm run dist:win` sau khi cài dependencies.

Ví dụ nhập ở Terminal Windows, sau khi đã chọn folder dự án:

```powershell
Get-Location
Get-ChildItem
py -3 main.py
node app.js
npm.cmd install
php index.php
lua main.lua
```

PowerShell ở đây là bản 5.1 của Windows; nối lệnh bằng dòng mới hoặc `;`, dùng `npm.cmd`/`npx.cmd` cho npm. App không tự đổi execution policy hay chạy bằng quyền quản trị. Tham khảo: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_exe?view=powershell-5.1 và https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill

Tham khảo API profile và xóa dữ liệu theo origin: https://www.electronjs.org/docs/latest/api/session

Hướng dẫn cài phần mềm/định danh gói và phạm vi cài WinGet: https://learn.microsoft.com/en-us/windows/package-manager/winget/install ; Python trên Windows: https://docs.python.org/3/using/windows.html

Đối chiếu cấu trúc DeepSeek với các mẫu stream do tác giả dự án này công bố (quan sát của bên thứ ba, không phải giao thức chính thức): https://github.com/l-spaces/deepseek-api/blob/master/docs/DeepSeekSSE%E8%A1%8C%E4%B8%BA%E7%BB%93%E6%9E%84%E8%AF%B4%E6%98%8E-2026-04-05.md

Các sự kiện `toast`/`hint`, trường `finish_reason`/`clear_response` được đối chiếu mã JavaScript công khai của https://chat.deepseek.com/ ngày 15/10/2026. Header ở bản này theo đúng source mobile bạn cung cấp.
