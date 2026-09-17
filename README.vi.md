<p align="center">
  <img src="assets/readme/hero.svg" width="960" alt="Chuyển sang web model. Tiếp tục dùng Codex. Dùng gói ChatGPT của bạn. Giữ nguyên workflow. Tận dụng tối đa khả năng.">
</p>

<p align="center">
  <a href="https://github.com/dokaka1997/Codex-Chat-GPT-Web/releases/download/v5.0.10/codex-web-gpt-5.0.10-win-x64.exe"><img src="assets/readme/download-windows.svg" width="224" height="64" alt="Windows · x64"></a>&nbsp;
  <a href="https://github.com/dokaka1997/Codex-Chat-GPT-Web/releases/download/v5.0.10/codex-web-gpt-5.0.10-mac-arm64.dmg"><img src="assets/readme/download-macos.svg" width="224" height="64" alt="macOS · Apple silicon"></a>&nbsp;
  <a href="https://github.com/dokaka1997/Codex-Chat-GPT-Web/releases/download/v5.0.10/codex-web-gpt-5.0.10-linux-x64.AppImage"><img src="assets/readme/download-linux.svg" width="224" height="64" alt="Linux · x64"></a>
</p>

<p align="center">
  <a href="https://github.com/dokaka1997/Codex-Chat-GPT-Web/releases/download/v5.0.10/codex-web-gpt-5.0.10-mac-x64.dmg">macOS Intel</a> · <a href="https://github.com/dokaka1997/Codex-Chat-GPT-Web/releases/latest">Tất cả bản phát hành</a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <img src="assets/demo.gif" width="960" alt="Một lượt ChatGPT Web trực tiếp chạy trong Codex harness gốc">
</p>

<p align="center">
  <a href="#bat-dau">Bắt đầu</a> · <a href="https://github.com/dokaka1997/Codex-Chat-GPT-Web/releases">Có gì mới</a> · <a href="docs/architecture.md">Kiến trúc</a> · <a href="TROUBLESHOOTING.md">Xử lý lỗi</a>
</p>

Dùng các model ChatGPT Web có sẵn trên tài khoản của bạn, bao gồm Pro, ngay trong model picker gốc của Codex — sử dụng hạn mức riêng của ChatGPT Web mà không tiêu quota Work hoặc Codex. Giữ nguyên giao diện, task, ảnh và streaming.

Chế độ Full harness kết nối ChatGPT với file, terminal, tool và approval của task hiện tại thông qua MCP. Cuộc hội thoại vẫn gắn với task Codex đang làm để bạn có thể tiếp tục khi context tăng lên.

<div id="bat-dau"><a id="quick-start"></a></div>

## Bắt đầu

**Model khả dụng:** Free/Go → **Luna / Think**. Tài khoản có reasoning controls → **Instant–High**, cộng thêm **Extra High** và **Pro** khi tài khoản được phép dùng. Launcher tự phát hiện khả năng của tài khoản.

1. **Cài launcher** bằng bản tải phù hợp với hệ điều hành ở phía trên.
2. **Đăng nhập ChatGPT** trong trình duyệt tích hợp và chạy browser smoke test.
3. **Cài model**, khởi động lại Codex một lần rồi chọn model **ChatGPT Web — …**.
4. **Để code với tools**, mở **MCP** trong launcher và hoàn tất thiết lập Full harness bên dưới.

App đã bao gồm trình duyệt và runtime. Không cần cài riêng Chrome, Node hay Bun.

<details>
<summary><strong>Cài bằng terminal, cập nhật & sửa lỗi</strong></summary>

Thoát launcher trước khi cập nhật. Các installer này tự chọn platform và architecture, xác minh checksum đã phát hành và giữ nguyên ChatGPT profile cùng cài đặt launcher của bạn.

**macOS / Linux**

```bash
curl -fsSL https://github.com/dokaka1997/Codex-Chat-GPT-Web/releases/latest/download/install-launcher.sh | sh
```

**Windows PowerShell**

```powershell
irm https://github.com/dokaka1997/Codex-Chat-GPT-Web/releases/latest/download/install-launcher.ps1 | iex
```

</details>

<details>
<summary><strong>Model, chế độ & thiết lập MCP</strong></summary>

<a id="modes"></a>

Các chế độ Automatic cung cấp Luna/Think nếu tài khoản không có reasoning selector; nếu có, launcher cung cấp Instant–High, cùng Extra High và Pro khi tài khoản được hỗ trợ.

| Chế độ | Gửi tin nhắn | Công cụ Codex cục bộ |
| --- | --- | --- |
| **Browser-only** | Tự động | Không |
| **Full harness (With Automation)** | Tự động | Có, qua MCP |
| **Zero Risk** | Tự dán và gửi | Có, qua một MCP connector riêng |

Zero Risk không đọc hoặc thao tác trên trang ChatGPT. Bạn tự chọn model và connector `Codex Zero Risk`, dán và gửi prompt đã chuẩn bị, sau đó xác nhận **Đã gửi** trong launcher. Mỗi model Automatic sẽ chọn cố định một chế độ ChatGPT; các dòng Effort và Speed của Codex không ghi đè lựa chọn đó.

<a id="full-harness"></a>

### Full harness

Full mode kết nối tool call của ChatGPT trở lại task Codex hiện tại thông qua [OpenAI tunnel-client](https://github.com/openai/tunnel-client) chính thức. Tunnel chỉ đi outbound: không mở public IP, không mở inbound port và không cần port forwarding trên router.

Trang **MCP** của launcher hướng dẫn đầy đủ các bước. Để xem chính xác thao tác bấm, xem [video hướng dẫn](TROUBLESHOOTING.md).

> **Giới hạn**
>
> Xem [Limits](https://github.com/dokaka1997/Codex-Chat-GPT-Web/discussions/309) để biết hạn mức tin nhắn hiện tại của ChatGPT cho **GPT-5.6 Sol Pro** và **GPT-6 Astra**. Giới hạn context phụ thuộc loại tài khoản và effort đã chọn. Plus Medium/High dùng cửa sổ đo được khoảng 90.000 token, hoặc tối đa 270.000 token khi bật **3× context** thử nghiệm, đồng thời vẫn hỗ trợ compaction gốc của Codex.

1. Hoàn tất phần thiết lập bắt buộc, mở **MCP**, tạo Tunnel và API key thông thường, sau đó bấm **Connect harness**.
2. Bật **Developer Mode** trong ChatGPT và tạo một Tunnel connector mới có tên chính xác **Codex Native2**, với **Authentication: None** và **Allow all actions**.
3. Chạy **Verify runtime** để xác nhận **Codex Native2** đã được gắn và khả dụng.

Các thao tác ghi/sửa cũng cần ChatGPT workspace và chính sách quản trị cho phép. Xem [developer mode and MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt). Các approval bất ngờ sẽ fail closed trừ khi bật rõ `--auto-approve-tool-calls`; tùy chọn đó chỉ bấm **Allow once**, không cấp quyền vĩnh viễn.

</details>

<details>
<summary><strong>Chẩn đoán & subagent</strong></summary>

<a id="operations"></a>

Dùng **Activity** cho chẩn đoán cục bộ an toàn và **Settings → Run doctor** để kiểm tra end-to-end. Settings cũng có thể hủy browser turn đang giữ lại hoặc gỡ tích hợp Codex trước khi uninstall.

Chỉ đặt `CODEX_CHATGPT_WEB_BROWSER_DIAGNOSTICS=1` khi bạn cần screenshot ở mọi browser checkpoint.

Bản cài mới dùng **Compatibility V1** cho subagent cross-backend. **Native** giữ nguyên feature setting của Codex và bật Web-to-Web V2 delegation dạng plaintext. Khởi động lại Codex và bắt đầu task mới sau khi đổi protocol:

```bash
codex-chatgpt-web subagents status
codex-chatgpt-web subagents compatibility-v1
codex-chatgpt-web subagents native
```

</details>

<details>
<summary><strong>Yêu cầu & bảo mật</strong></summary>

<a id="limitations-and-security"></a>

- Đây là browser automation không chính thức, không phải OpenAI API. Thay đổi UI của ChatGPT có thể làm selector hỏng; hệ thống sẽ báo lỗi rõ ràng thay vì âm thầm đổi model hoặc transport.
- Browser state là dữ liệu đăng nhập nhạy cảm, và loopback listener có thể được truy cập bởi process chạy dưới cùng local user. Không chia sẻ launcher profile; chỉ dùng trên máy đáng tin cậy.
- Release hiện hỗ trợ macOS 13+ (arm64/x64), Windows x64 và Linux x64. Runtime, test và packaging đều được kiểm tra trên cả ba trong CI; các flow phụ thuộc tài khoản cho browser và MCP dùng [release validation](docs/release-validation.md) riêng.
- Build hiện chưa được ký theo platform, vì vậy Gatekeeper hoặc SmartScreen có thể cảnh báo. Installer xác minh SHA-256 manifest đã phát hành trước khi cài.

Đọc đầy đủ [architecture](docs/architecture.md) và [security model](docs/security-model.md) trước khi bật full mode. Báo lỗi bảo mật qua [SECURITY.md](SECURITY.md).

Temporary Chat là một [chế độ riêng tư của ChatGPT](https://help.openai.com/en/articles/8914046-temporary-chat-faq); prompt vẫn được OpenAI xử lý.

Phạm vi kiểm thử: [release validation](docs/release-validation.md).

Đây là phần mềm độc lập, không liên kết hoặc được OpenAI chứng thực. Chỉ sử dụng với tài khoản của chính bạn và tuân thủ [Terms of Use](https://openai.com/policies/terms-of-use/) cũng như chính sách workspace áp dụng; phần mềm không vượt qua authentication hoặc access control.

</details>

<details>
<summary><strong>Chạy từ source & phát triển</strong></summary>

<a id="development"></a>

```bash
git clone https://github.com/dokaka1997/Codex-Chat-GPT-Web.git && \
cd codex-chatgpt-web && \
bun run app
```

Đường chạy từ source yêu cầu Bun 1.4.0. Lệnh trên cài dependency theo lockfile và mở app.

```bash
bun run app
bun run dev:launcher
bun run src/cli.ts dev status
bun run dev:chat compaction-lab "Reply with exactly: DEV READY"
bun run verify
bun run smoke:subagents
bun run app:package
```

`dev:launcher` dùng profile và account riêng tại `~/.codex-chatgpt-web-dev`. `dev:chat` kiểm thử browser thật và compaction path với simulated tool result rõ ràng mà không thay đổi route Codex bình thường. Xem [DEV chat harness](docs/dev-chat.md) để biết cách thiết lập và các command.

</details>

## Star History

<a href="https://www.star-history.com/?repos=dokaka1997%2FCodex-Chat-GPT-Web&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=dokaka1997/Codex-Chat-GPT-Web&type=date&theme=dark&legend=top-left">
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=dokaka1997/Codex-Chat-GPT-Web&type=date&legend=top-left">
    <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=dokaka1997/Codex-Chat-GPT-Web&type=date&legend=top-left">
  </picture>
</a>

---

[Troubleshooting](TROUBLESHOOTING.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [MIT license](LICENSE) · [CI](https://github.com/dokaka1997/Codex-Chat-GPT-Web/actions/workflows/ci.yml)

Cũng từ tôi: <img src="assets/readme/persona-voice.svg" width="20" height="20" alt=""> [ChatGPT Persona Voice](https://github.com/dokaka1997/ChatGPT-Persona-Voice) — giọng tùy chỉnh local, gần thời gian thực cho ChatGPT và Codex.
