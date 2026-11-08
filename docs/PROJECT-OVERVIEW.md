# FrameMind AI — Tổng quan dự án (hiện trạng)

Tài liệu mô tả **trạng thái hiện tại** của dự án: có gì, chạy thế nào, dùng công nghệ gì.
Dùng làm ngữ cảnh khi viết tài liệu hoặc lập kế hoạch tiếp theo.

- Cập nhật: 2026-11-06
- Repository: `SCVN-Dylan/FrameMind-AI` (GitHub), nhánh `main`
- Commit gần nhất: `2dbb8b4` — *Feedback: click an evidence frame to view it full screen*

---

## 1. FrameMind AI là gì

Công cụ chạy **hoàn toàn trên máy người dùng** để so sánh hai video gameplay:

- **Reference**: video mẫu / mục tiêu hình ảnh mong muốn.
- **Current**: video bản đang phát triển (build Unity).

Người dùng đánh dấu các khoảnh khắc tương ứng giữa hai video, FrameMind trích frame bằng FFmpeg rồi gửi cho **Codex CLI** (đăng nhập bằng tài khoản ChatGPT của người dùng) để nhận **feedback có cấu trúc kèm hướng sửa trong Unity**.

Đối tượng: developer / artist Unity (mobile game, creative/playable) cần so bản đang làm với bản mẫu.

---

## 2. Tính năng hiện có

### 2.1 So sánh video
- Tải lên 2 video (Reference, Current). Video phát ngay tại chỗ trong khi upload, có thanh tiến trình.
- Trình phát riêng: play/pause, lùi/tiến từng frame, timeline, tốc độ, âm lượng; phát / dừng / đồng bộ cả hai video.
- **Single Frame**: ghép cùng một sự kiện ở hai thời điểm có thể khác nhau (vd. 10 s ↔ 15 s).
- **Short Clip**: mỗi video một đoạn Start/End 0,1–10 s, độ dài hai bên có thể khác nhau.
- **Full Video**: mới có giao diện, đánh dấu *Future*, chưa xử lý.
- Thêm / sửa / xóa cặp khớp; bấm vào cặp để tua cả hai video.
- Trích frame: Single Frame = 1 ảnh mỗi video; Short Clip = chuỗi ảnh (8 fps, tối đa 40 frame mỗi clip). Bấm thumbnail để tua video.
- Khi backend offline: trang vẫn mở video cục bộ và trích frame bằng Canvas của trình duyệt (không phân tích AI được).

### 2.2 Phân tích AI (Codex CLI)
- Dùng **Codex CLI chính thức của OpenAI**, đăng nhập **bằng tài khoản ChatGPT**. **Không dùng và không cần OpenAI API key**; từ chối chạy nếu Codex đăng nhập bằng API key.
- Mỗi lần Analyze: tối đa 5 cặp; clip gửi tối đa 6 frame mỗi video.
- Codex trả JSON theo schema cố định; backend **kiểm tra lại toàn bộ** (không tin đầu ra AI):
  - ID feedback do backend sinh; pair id phải khớp; nhãn frame phải tồn tại; timestamp được "snap" về frame thật đã gửi; bỏ trùng; tối đa 8 vấn đề mỗi cặp.
  - Single Frame: mục *animation* luôn bị hạ độ tin cậy (ảnh tĩnh không thể hiện chuyển động).
- Mỗi feedback gồm: hạng mục (Camera, Composition, Lighting, Colors, Animation, VFX), mức độ (critical / major / minor / suggestion), độ tin cậy, tiêu đề, quan sát, vì sao quan trọng, cách cải thiện, **khuyến nghị Unity**, timestamp hai video, frame bằng chứng.
- Feedback viết bằng ngôn ngữ đang chọn (EN / VI / KO).
- Bấm feedback → tua cả hai video; timeline phân tích theo hạng mục; bộ lọc theo hạng mục.
- Bấm frame bằng chứng → xem ảnh lớn toàn màn hình (chuyển ảnh bằng nút / phím mũi tên, Esc để đóng).
- Job chạy nền, có trạng thái pending / processing / completed / failed; job bị gián đoạn khi tắt backend được đánh dấu failed lúc khởi động lại.

### 2.3 Settings
- **AI Provider**: đăng nhập / đăng xuất / đổi tài khoản ChatGPT ngay trong app (chạy `codex login` / `codex logout`); làm mới kết nối.
- **Chọn model**: danh sách lấy từ `codex debug models` theo tài khoản; model không nhận ảnh bị vô hiệu; lựa chọn lưu trong SQLite, mỗi job giữ model lúc bắt đầu.
- **Ngôn ngữ giao diện**: EN / VI / KO.
- **Local backend**: nhập pairing code (xem mục 5).
- **Data Management → Clear All Data**: gõ `DELETE` để xác nhận; xóa video, frame, session, cặp, job, feedback; giữ lại database (rỗng), model đã chọn, pairing code, ngôn ngữ, runtime, log và đăng nhập ChatGPT.

### 2.4 Dashboard & History
- Dashboard: thống kê từ các session đã lưu, danh sách session gần đây.
- History: mở lại / xóa session. Tải lại trang vẫn giữ video, cặp, chế độ và frame đã trích.

### 2.5 Đóng gói & khởi chạy (Portable)
- **macOS**: bấm đúp `Start FrameMind.command`.
  - Kiểm tra và **hỏi bằng popup (Yes / Not now)** trước khi cài: Homebrew, Python 3.9–3.13, FFmpeg, Codex CLI.
  - Python packages cài vào virtualenv riêng.
  - Tự chọn cổng trống nếu 8000 bận; mở trình duyệt với pairing code; Control-C / đóng cửa sổ / `Stop FrameMind.command` để dừng.
- **Windows**: `Start FrameMind.bat` / `Stop FrameMind.bat` (PowerShell), cùng cơ chế, cài qua winget. **Chưa được chạy thử trên máy Windows thật.**
- **Codex riêng của FrameMind**: lần đầu hỏi để tải bản Codex mới nhất từ npm registry (kiểm tra SHA-512) vào `runtime/codex/`; mỗi lần Start tự cập nhật; cập nhật lỗi thì giữ bản cũ. Không phụ thuộc Codex cài sẵn trên máy, không cần Node.js.
- Script đóng gói `scripts/build_portable.sh` tạo `dist/FrameMind-Portable/` và `dist/FrameMind-Portable.zip`.
- `service-intro.html`: trang giới thiệu sản phẩm độc lập, 3 ngôn ngữ, có hướng dẫn bắt đầu.

---

## 3. Công nghệ đang dùng

| Thành phần | Công nghệ |
| --- | --- |
| Giao diện chính (bản Portable) | `submission/index.html`: **một file HTML + JavaScript thuần** (~4.200 dòng), không framework, không CDN, mở bằng `file://`. Có CSP chặt (chỉ cho kết nối tới `localhost` / `127.0.0.1`). |
| Giao diện phụ (dev) | `frontend/`: **Next.js 16.4, React 19.3, Tailwind CSS 4, TypeScript 5**. Chạy ở `http://localhost:3000`. **Đang bị bỏ lại phía sau** so với trang standalone (một số tính năng mới chỉ có ở standalone). |
| Backend | **Python 3.9–3.13, FastAPI 0.128, Uvicorn 0.39, Pydantic Settings 2.11** |
| Database | **SQLite** qua **SQLAlchemy 2.0** (file `framemind.db`) |
| Xử lý video | **FFmpeg / FFprobe** (gọi bằng subprocess, có timeout) |
| AI | **OpenAI Codex CLI** (`codex exec`), đăng nhập ChatGPT, output theo JSON Schema |
| Test | **pytest 8.4 + httpx** (backend), script bash cho launcher |
| Launcher | Bash (macOS), PowerShell + .bat (Windows), `osascript` / WinForms cho popup |

Không có: OpenAI API key, dịch vụ cloud, tài khoản người dùng, đồng bộ nhiều máy.

---

## 4. Cấu trúc thư mục

```
FrameMind-AI/
├── Start FrameMind.command / .bat     launcher macOS / Windows
├── Stop FrameMind.command / .bat
├── submission/index.html              giao diện chính (standalone)
├── service-intro.html                 trang giới thiệu sản phẩm
├── frontend/                          bản Next.js (dev)
│   └── src/app, src/components, src/lib (api, i18n, types…)
├── backend/
│   ├── app/main.py                    FastAPI app, middleware pairing + CORS
│   ├── app/api/routes/                health, videos, sessions, media, analysis, ai_provider, data
│   ├── app/services/                  videos, sessions, pairs, extraction, analysis, data_reset, storage, standalone
│   ├── app/services/ai/               codex_cli.py, codex_account.py, prompt.py
│   ├── app/services/video/ffmpeg.py
│   ├── app/db/                        database.py, models.py
│   ├── app/schemas/                   Pydantic schemas
│   ├── tests/                         pytest (126 test)
│   └── requirements.txt
├── scripts/
│   ├── common.sh, check_dependencies.sh, setup.sh, start_backend.sh, stop_backend.sh
│   ├── build_portable.sh
│   ├── windows/common.ps1, start.ps1, stop.ps1
│   └── tests/test_launcher.sh         (103 test)
├── docs/                              PORTABLE.md, PORTABLE-WINDOWS.md, ROADMAP-DEV-WORKSPACE.md, file này
└── storage/                           videos/, frames/ (khi chạy dev)
```

---

## 5. Kiến trúc & bảo mật

```
Trình duyệt (submission/index.html, file://)
        │  HTTP + header X-FrameMind-Pairing
        ▼
FastAPI backend (chỉ nghe 127.0.0.1, cổng 8000 mặc định)
        ├── SQLite (framemind.db)
        ├── storage/videos, storage/frames
        ├── FFmpeg / FFprobe
        └── Codex CLI (exec, read-only, không mạng) ── ChatGPT account
```

- Backend **chỉ nghe localhost**.
- Trang mở từ `file://` gửi `Origin: null` → mọi request (trừ `/api/health`) phải kèm **pairing code** (12 ký tự, lưu ở `standalone_pairing_code.txt`, quyền chỉ chủ sở hữu). Launcher tự điền code vào trang.
- CORS chỉ cho `http://localhost:3000` (Next.js) và `null` (standalone).
- Codex chạy với **permission profile riêng**: hệ thống file mặc định bị chặn, chỉ đọc thư mục làm việc tạm; tắt shell tool, tắt web search, không mạng; không nạp `AGENTS.md`. Nếu một phiên bản Codex mới không khởi động được với profile này, tự thử lại một lần bằng profile read-only có sẵn của Codex và nhớ lựa chọn theo phiên bản.
- File video không bao giờ đặt tên theo tên gốc; mọi lệnh FFmpeg dùng danh sách tham số (không shell) và có timeout.
- Clear All Data: chặn ghi mới, hủy job AI, xóa trong một transaction, chỉ xóa bên trong thư mục storage hợp lệ, không theo symlink, kiểm tra lại sau khi xóa.

---

## 6. Dữ liệu

### Vị trí (bản Portable)
- macOS: `~/Library/Application Support/FrameMind AI/`
- Windows: thư mục dữ liệu riêng của người dùng (xem `docs/PORTABLE-WINDOWS.md`)

```
framemind.db                  database
videos/  frames/              video đã tải, frame đã trích
standalone_pairing_code.txt   pairing code
runtime/venv/                 Python env (xóa được, tự tạo lại)
runtime/codex/                Codex riêng (xóa được, tự tải lại)
logs/backend.log
launcher.conf                 tùy chọn (vd. PORT=8765)
```
Đăng nhập ChatGPT do Codex lưu ở `~/.codex`, FrameMind không đọc.

### Bảng SQLite
| Bảng | Nội dung |
| --- | --- |
| `videos` | metadata video (thời lượng, độ phân giải, fps, codec, đường dẫn lưu) |
| `analysis_sessions` | một lần so sánh: video Reference, Current, chế độ, tên |
| `matching_pairs` | cặp khớp: single_frame (2 timestamp) hoặc short_clip (2 khoảng) |
| `extracted_media` | frame đã trích (vai trò, timestamp thật, đường dẫn) |
| `analysis_jobs` | mỗi lần Analyze: trạng thái, model, phiên bản Codex, ngôn ngữ, tóm tắt, lỗi |
| `feedback_items` | từng vấn đề AI đã được kiểm tra, kèm bằng chứng (JSON) |
| `app_settings` | cài đặt (model đã chọn); không chứa thông tin đăng nhập |

Migration: chỉ **thêm** bảng / cột (`create_all` + danh sách `ADDED_COLUMNS`), không bao giờ xóa dữ liệu.

---

## 7. API (tiền tố `/api`)

| Nhóm | Endpoint |
| --- | --- |
| Health | `GET /health` |
| Videos | `POST /videos` (upload), `GET /videos/{id}`, `GET /videos/{id}/file` |
| Sessions | `GET/POST /sessions`, `GET/PATCH/DELETE /sessions/{id}` |
| Pairs | `GET/POST /sessions/{id}/pairs`, `PATCH/DELETE /sessions/{id}/pairs/{pair_id}` |
| Frames | `POST /sessions/{id}/pairs/{pair_id}/extract`, `GET /sessions/{id}/pairs/{pair_id}/media`, `GET /media/{id}`, `GET /media/{id}/file` |
| Analysis | `POST /analysis/{session_id}/run`, `GET /analysis/{session_id}/status`, `GET /analysis/{session_id}/results`, `GET /analysis/{session_id}/jobs` |
| AI provider | `GET /ai/provider/status`, `POST/GET/DELETE /ai/provider/login`, `POST /ai/provider/logout`, `GET /ai/provider/models`, `PUT /ai/provider/model` |
| Data | `DELETE /data/all` (Clear All Data) |

---

## 8. Cấu hình chính (`backend/.env` hoặc biến môi trường)

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `STORAGE_DIR` | `storage` | thư mục dữ liệu |
| `MAX_UPLOAD_BYTES` | 1 GB | giới hạn mỗi video |
| `CLIP_SAMPLE_FPS` / `CLIP_MAX_FRAMES` | 8 / 40 | trích frame clip |
| `FRAME_MAX_WIDTH` | 1280 | chiều rộng tối đa frame |
| `CODEX_CLI_PATH` | `codex` | đường dẫn Codex |
| `CODEX_MODEL` | (trống = mặc định của Codex) | model |
| `CODEX_TIMEOUT_SECONDS` | 180 | timeout mỗi lần chạy |
| `CODEX_MAX_CONCURRENT_JOBS` | 1 | số job song song |
| `AI_MAX_FRAMES_PER_CLIP` / `AI_MAX_PAIRS_PER_JOB` | 6 / 5 | giới hạn gửi cho AI |
| `CODEX_ALLOW_API_KEY_AUTH` | false | cấm đăng nhập Codex bằng API key |

---

## 9. Kiểm thử

- Backend: `python -m pytest` trong `backend/` — **126 test, đều đạt** (lần chạy gần nhất). Test dùng thư mục storage tạm, video thử được tạo bằng FFmpeg.
- Launcher: `scripts/tests/test_launcher.sh <thư-mục-tạm>` — **103 test, đều đạt**. Dùng sandbox và mock (curl, osascript…).
- Chưa có test tự động cho giao diện standalone.

---

## 10. Giới hạn & việc còn dở

- **Full Video** chưa có xử lý (chỉ giao diện).
- **Windows launcher** chưa chạy thử trên máy Windows thật.
- **Bản Next.js** không còn đồng bộ với trang standalone.
- **`dist/FrameMind-Portable.zip`** chưa đóng gói lại sau các thay đổi gần nhất.
- Launcher **chưa ký số / notarize** → lần đầu mở macOS Gatekeeper sẽ chặn, người dùng phải cho phép thủ công.
- AI chỉ nhìn **frame rời rạc**, không xem video liên tục → không đánh giá chính xác timing / độ mượt chuyển động.
- Phân tích tiêu tốn **hạn mức Codex** của gói ChatGPT.
- Dữ liệu chỉ lưu trên **một máy**, không chia sẻ nhóm.
- Đã thử và **đã gỡ bỏ** (theo quyết định của chủ dự án): Visual Compare (side-by-side / slider / overlay / heatmap), công cụ Reset riêng, file mở System Settings.

---

## 11. Nguyên tắc dự án cần giữ khi phát triển tiếp

- **Không yêu cầu OpenAI API key** hay dịch vụ trả phí bắt buộc; dùng Codex CLI + tài khoản ChatGPT.
- Backend **chỉ localhost**, giữ cơ chế **pairing code**.
- Codex chạy **read-only**, không mạng, không tự sửa file của người dùng.
- **Không tin đầu ra AI**: mọi kết quả phải được backend kiểm tra lại.
- Database chỉ **thêm**, không xóa / tạo lại; không mất dữ liệu người dùng.
- Không dùng CDN / thư viện ngoài cho trang standalone; giữ kiến trúc Portable.
- Hỏi trước khi cài bất kỳ phụ thuộc mới nào.
- Hỗ trợ đủ **EN / VI / KO**.
- Test không bao giờ chạy trên dữ liệu thật; không chạy Clear All Data trên dữ liệu thật khi phát triển.

---

## 12. Hướng phát triển đang cân nhắc

Xem `docs/ROADMAP-DEV-WORKSPACE.md`: mở rộng thành **AI Unity Development & QA Assistant** (phân tích GDD thành checklist, quét Unity project, đối chiếu yêu cầu, theo dõi tiến độ, liên kết với Video Analysis). Bước đầu đề xuất: *Feature 01 — AI Requirement Analyzer + Development Workspace*. Chưa bắt đầu triển khai.
