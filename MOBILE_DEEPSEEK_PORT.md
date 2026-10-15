# Chuyển DeepSeek từ NTT Code X mobile sang PC — 0.25

Nguồn: `NTTCodeX_v0.6.55_Undo_Redo_Toolbar_SOURCE(2).zip`.
File chính: `app/src/main/java/com/nttcode/mobile/ai/DeepSeekPrivateSessionClient.kt`.
SHA-256 của file nguồn: `456e7c4a4ff65484362c28bcdc1adc2c41ed756a952c057a73b97bdc1daf37af`.

File DeepSeek trong ZIP này giống bản mobile đã dùng làm cơ sở cho PC trước đó. Bản 0.25 khôi phục những hành vi PC đã đổi khác, kèm so sánh request độc lập với mã mobile gốc.

| Mobile | PC 0.25 |
| --- | --- |
| `waitUntilReady`: kiểm tra `userToken`, 30 lần × 500 ms | `WebSessions.waitUntilReady`, trạng thái DeepSeek dựa trên token, không dựa vào textarea |
| `buildRequestScript`: header 2.2.0, locale zh_CN | `lib/session-scripts/deepseek.js`: cùng bộ header |
| Tạo chat, tạo challenge, chạy Worker, gửi completion | Cùng endpoint, thứ tự request, credentials và cách tạo proof header |
| Hai cờ từ `AppSettings` | Hai công tắc DeepThink/Web Search lưu trên PC, gửi ở mỗi lượt |
| SharedPreferences giữ session + parent ID khi đổi cờ | `session-lineage.json` giữ hội thoại khi đổi cờ, parent ID dạng số trong request |
| Thử lại một HTTP lỗi không phải 401/403 với chat mới | Cùng hành vi; mỗi lần phục hồi trong một lượt được giới hạn |
| WebView là runtime đăng nhập và fetch | BrowserWindow Electron là runtime đăng nhập và fetch, cùng profile Google với Gemini |

Không sao chép phần Android UI, `Handler`, `SharedPreferences` hoặc Android WebView sang Windows. Các thành phần tương ứng dùng Electron/Node và dữ liệu hiện có trên PC. Nội dung web vẫn không có Node.js/preload của app.

## Đã kiểm tra

Chạy chính đoạn JavaScript `buildRequestScript` lấy từ file Kotlin gốc trong một browser harness cô lập, rồi ghi bộ request tham chiếu vào `test/fixtures/deepseek-mobile-wire.json`. Token, challenge, Worker và HTTP trong kiểm tra đều là dữ liệu giả, không gọi tài khoản thật.

`test/mobile-deepseek-parity.test.cjs` chạy script PC và so sánh toàn bộ request/headers/body/credentials/result với bộ tham chiếu cho bốn tổ hợp: tắt cả hai, chỉ Search, chỉ Thinking, bật cả hai. Kiểm tra bridge bổ sung xác nhận đổi cờ vẫn gửi đúng parent ID và tiếp nối chat hiện tại. Kiểm tra readiness xác nhận chờ và hủy được bước chờ.

Bộ đọc phản hồi trên PC giữ các sửa lỗi định dạng và thông báo từ máy chủ đã có ở 0.23/0.24. PC chỉ tự thử lại `backend_err` khi có cờ lỗi có cấu trúc, tối đa ba lượt ở tầng gửi, thay vì dựa vào từ ngữ trong văn bản trả lời.

Kiểm tra request chứng minh cách gửi khớp mobile trong các trường hợp đã mô phỏng. Nó không chứng minh tài khoản/IP/runtime Electron sẽ được máy chủ chấp nhận, và không xác nhận DeepSeek đã hết `backend_err` trên máy người dùng.
