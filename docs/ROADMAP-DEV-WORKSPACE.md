# FrameMind AI → AI Unity Development & QA Assistant

Ghi chú phân tích và hướng triển khai. **Chưa có code nào được viết cho phần này.**
Ngày ghi: 2026-11-06.

---

## 1. Tóm tắt đề xuất

Mở rộng FrameMind AI từ "so sánh video gameplay" thành trợ lý giúp:

1. Đọc GDD / Creative Brief / Feedback → ra **checklist yêu cầu** chỉnh sửa được.
2. Đối chiếu checklist với **Unity Project** (code, scene, prefab, config).
3. Phân loại từng yêu cầu: Verified / Likely Implemented / Missing / Mismatch / Needs Review, kèm **lý do và bằng chứng**.
4. Theo dõi **tiến độ** theo scenario, lưu lịch sử kiểm tra.
5. Dùng **Video Analysis hiện có** để xác minh phần hình ảnh và flow.

Đề xuất chia 7 tính năng, 3 giai đoạn (MVP → Unity Integration → Advanced QA). Hướng này hợp lý; dưới đây là phân tích chi tiết và những điểm nên điều chỉnh.

---

## 2. Đánh giá nhanh

| Điểm | Nhận xét |
| --- | --- |
| Hướng đi | Đúng: giải quyết việc thật (biết cần làm gì, làm đến đâu, còn thiếu gì) thay vì chỉ phân tích hình ảnh. |
| Ba trạng thái Implemented / Verified / Completed | Rất quan trọng, nên đưa vào **mô hình dữ liệu** ngay từ Feature 01, không chỉ là nhãn hiển thị. |
| Thứ tự MVP trước | Đúng. Feature 01 dùng được ngay kể cả khi chưa có Unity Bridge. |
| Rủi ro lớn nhất | Feature 05 (Runtime QA) khó nhất và dễ "trông như kiểm tra nhưng thực ra không kiểm tra". Nên làm sau cùng, phạm vi hẹp. |
| Điều chỉnh nên có | Tách Feature 03 thành **quét file trên đĩa** (không cần Unity mở) trước, rồi mới đến Unity Live Connection. Xem mục 5. |

---

## 3. Hiện trạng kỹ thuật cần lưu ý trước khi làm

- **Giao diện chính là `submission/index.html`**: một file HTML/JS thuần khoảng 4.200 dòng, mở bằng `file://`, chạy trong bản Portable.
  Thêm cả một Development Workspace vào file này sẽ khiến nó khó bảo trì.
  → **Việc chuẩn bị nên làm trước:** tách trang thành nhiều file JS/CSS trong `submission/` (vẫn chạy offline, vẫn không cần CDN). Cần sửa CSP (`script-src`) cho phép file cục bộ.
- **Bản Next.js trong `frontend/`** đang bị bỏ lại phía sau (các tính năng gần đây chỉ làm ở trang standalone).
  → Cần quyết định: **ngừng cập nhật Next.js** hay giữ song song. Khuyến nghị: chỉ phát triển trang standalone.
- **Backend FastAPI + SQLite**: thêm bảng bằng `create_all` + `ADDED_COLUMNS` (chỉ thêm, không xóa). Phù hợp để mở rộng.
- **Codex CLI** hiện chạy chế độ **chỉ đọc, không mạng, tắt shell**, chỉ nhận ảnh + prompt và trả JSON theo schema.
  - Feature 01 dùng được cơ chế này gần như nguyên vẹn (gửi văn bản thay vì ảnh).
  - Feature 03–04 cần Codex **đọc file trong Unity project** → phải mở quyền đọc thư mục project (vẫn read-only, vẫn không mạng). Đây là thay đổi bảo mật cần cân nhắc riêng.
- **Clear All Data** phải được cập nhật để xóa cả dữ liệu mới (project, tài liệu, requirement…).
- **Hạn mức Codex** theo gói ChatGPT: phân tích GDD dài và quét project lớn sẽ tốn usage → cần chia nhỏ, cache kết quả, chỉ phân tích lại phần thay đổi.

---

## 4. Mô hình dữ liệu đề xuất (nền cho cả 7 tính năng)

```
dev_projects          một creative/dự án (vd. Dragon Burst)
  └─ documents        GDD, brief, feedback đã nhập (file gốc + văn bản trích ra + hash)
  └─ scenarios        Scenario 01..08
       └─ requirements
            ├─ type: mechanic | visual | ui | audio | config | flow | other
            ├─ parameters        (tên, giá trị, đơn vị; vd. aim_angle = ±60°)
            ├─ acceptance_criteria[]   điều kiện nghiệm thu
            ├─ source_refs[]     trích dẫn nguyên văn từ tài liệu (để truy vết)
            ├─ implementation_status   unknown | missing | likely | implemented | mismatch
            ├─ verification_status     not_verified | passed | failed | needs_review
            ├─ completion              open | completed (chỉ người dùng xác nhận)
            ├─ evidence[]        (Feature 03+) code / scene / prefab / config / runtime / video
            └─ history[]         ai sửa gì, khi nào (AI hay người)
  └─ validation_runs  mỗi lần quét/kiểm tra: thời điểm, phạm vi, kết quả
```

Nguyên tắc:

- **Ba trục trạng thái tách riêng**, không gộp thành một cột "status".
- **Verified chỉ được đặt bởi backend** khi có bài kiểm tra/bằng chứng runtime đạt, hoặc người dùng xác nhận. AI tối đa chỉ được đề xuất *Likely Implemented / Missing / Mismatch / Needs Review*.
- **Completed chỉ do người dùng bấm**.
- Mọi kết luận AI phải kèm `reason` + `evidence`; backend kiểm tra bằng chứng có thật (file tồn tại, dòng code khớp, trích dẫn có trong tài liệu).

---

## 5. Phân tích từng tính năng

### Feature 01 — AI Requirement Analyzer + Development Workspace (MVP)

**Làm gì**
- Tạo Development Project.
- Nhập tài liệu: dán văn bản, TXT, Markdown, DOCX, PDF.
- Codex phân tích → scenario → requirement, kèm thông số, điều kiện nghiệm thu, trích dẫn nguồn, **câu hỏi về chỗ mơ hồ**.
- Checklist chỉnh sửa được: thêm/xóa/sửa/sắp xếp/gộp, đánh dấu tiến độ thủ công.
- Nhập **feedback mới** → AI đề xuất thay đổi (yêu cầu mới / sửa / bỏ), người dùng duyệt từng mục; **không ghi đè** phần đã chỉnh tay.

**Điểm kỹ thuật**
- TXT/MD: dễ. DOCX: đọc được bằng thư viện chuẩn Python (zip + XML), không cần cài thêm.
- PDF: cần một thư viện nhỏ (vd. `pypdf`, thuần Python) → **phụ thuộc mới**, phải ghi vào requirements và hỏi trước khi cài. PDF dạng ảnh scan cần OCR → ngoài phạm vi.
- Chống AI "bịa": mỗi requirement phải có `source_quote`; backend kiểm tra trích dẫn có trong văn bản gốc. Không khớp → gắn cờ Needs Review.
- Tài liệu dài: chia theo heading/scenario rồi phân tích từng phần, sau đó gộp.
- Ngôn ngữ EN/VI/KO như Video Analysis.

**Kết quả nghiệm thu**
- Nhập tài liệu Dragon Burst → có checklist 8 scenario, mỗi mục truy được về đoạn gốc.
- Sửa tay, lưu, tải lại trang vẫn còn.
- Nhập feedback → thấy danh sách thay đổi đề xuất, chấp nhận/bỏ từng mục.
- Video Analysis, History, Settings không bị ảnh hưởng.

### Feature 02 — Unity Live Connection

- Unity Editor package (thư mục `Packages/` hoặc cài qua git URL), có một cửa sổ Editor nhỏ.
- **Unity gọi FrameMind** (HTTP tới `127.0.0.1`), không làm ngược lại: gửi heartbeat (project, scene, Unity version, Play Mode).
- FrameMind muốn yêu cầu quét → đặt lệnh vào hàng đợi, Unity **tự hỏi định kỳ** rồi thực hiện.
- Xác thực: mã ghép đôi giống pairing code hiện có, nhập trong cửa sổ Unity.
- Chú ý: domain reload, nhiều project mở cùng lúc, Unity bị treo/tắt giữa chừng.

### Feature 03 — AI Project Scanner (đề xuất chia 2 bước)

**3a. Quét file trên đĩa (làm trước, không cần Unity mở)**
- Người dùng chọn thư mục project → backend đọc **chỉ thư mục `Assets/`** (bỏ qua Library, Temp, Plugins/ThirdParty theo danh sách cho phép).
- Đọc C# scripts, file `.unity` / `.prefab` / `.asset` dạng YAML (cần project bật *Force Text serialization*).
- Codex được quyền **đọc** thư mục project (read-only, không mạng) để tìm bằng chứng cho từng requirement, trả về đường dẫn + số dòng + trích đoạn; backend xác minh lại.

**3b. Quét qua Unity Bridge (sau Feature 02)**
- Unity xuất snapshot có cấu trúc: hierarchy scene, component, giá trị serialized, ScriptableObject config.
- Chính xác hơn YAML thô (giải được GUID, giá trị thật trong Inspector).

Giới hạn: kích thước snapshot, loại trừ thư mục nhạy cảm, không gửi asset nhị phân.

### Feature 04 — AI Requirement Validation

- Với mỗi requirement: Codex nhận requirement + bằng chứng đã tìm → đề xuất trạng thái + lý do + bằng chứng.
- Backend áp luật:
  - Chỉ thấy code liên quan → tối đa **Likely Implemented**.
  - Thông số lệch (vd. clamp 45° thay vì 60°) → **Mismatch**, có trích dòng code.
  - Không tìm thấy gì → **Missing** (kèm phạm vi đã quét, để biết "không thấy" ≠ "không có").
  - Mơ hồ / bằng chứng mâu thuẫn → **Needs Review**.
- Lưu từng lần chạy (validation_run) để so sánh.

### Feature 05 — Unity Runtime QA (khó nhất, làm sau cùng)

Các mức có thể làm, từ dễ đến khó:
1. **Thu log/sự kiện runtime**: package cung cấp API nhỏ `FrameMind.Event("powerup_collected", ammo=12)`; developer tự gắn vào code. FrameMind đọc log Play Mode để kiểm tra điều kiện.
2. **Chạy test có sẵn**: kích hoạt Unity Test Framework (PlayMode tests) và đọc kết quả.
3. **AI sinh test**: AI viết PlayMode test cho requirement → **phải hỏi trước khi ghi file vào project**, có Undo.
4. Mô phỏng input tự động: phức tạp, chỉ nên nghĩ đến sau.

Chỉ kết quả từ mức 1–3 đạt mới được tính **Verified**.

### Feature 06 — Development Progress Tracker

- Tính từ trạng thái requirement: % theo scenario, mechanic, nhóm việc.
- Lưu snapshot sau mỗi validation_run → biểu đồ tiến độ theo thời gian.
- Đánh dấu **"cần kiểm tra lại"** khi file liên quan thay đổi (so hash) sau lần verify cuối.

### Feature 07 — Video QA Integration

- Bảng liên kết feedback video ↔ requirement.
- Khi chạy Video Analysis cho một scenario, đưa điều kiện nghiệm thu của requirement vào prompt để AI kiểm tra đúng tiêu chí.
- Feedback video có thể đổi requirement thành Mismatch / Needs Review, nhưng **không tự đặt Verified**.

---

## 6. Thứ tự triển khai khuyến nghị

| Bước | Nội dung | Ghi chú |
| --- | --- | --- |
| 0 | Chuẩn bị: tách `submission/index.html` thành nhiều file; quyết định về bản Next.js | Giảm rủi ro khi thêm giao diện lớn |
| 1 | **Feature 01**: Workspace + Import + Requirement Analyzer + Checklist | MVP, dùng được ngay |
| 2 | Feature 06 (bản đơn giản): % tiến độ từ checklist thủ công | Gần như miễn phí sau bước 1 |
| 3 | Feature 03a: quét file Assets trên đĩa | Chưa cần Unity package |
| 4 | Feature 04: Validation (Likely / Missing / Mismatch / Needs Review) | Giá trị lớn nhất của hệ thống |
| 5 | Feature 02 + 03b: Unity Live Connection + snapshot | Tăng độ chính xác |
| 6 | Feature 07: liên kết Video Analysis với requirement | Tận dụng thứ đã có |
| 7 | Feature 05: Runtime QA (bắt đầu từ log/sự kiện) | Khó nhất |

Mỗi bước: làm xong, test, commit riêng; không thay thế tính năng đang chạy bằng bản chưa xong.

---

## 7. Feature 01 — kế hoạch chi tiết (khi bắt đầu làm)

1. **Database**: bảng `dev_projects`, `documents`, `scenarios`, `requirements` (có 3 trục trạng thái), `requirement_history`, `analysis_runs`. Cập nhật Clear All Data.
2. **Import tài liệu**: API upload/dán văn bản → trích văn bản (TXT/MD/DOCX; PDF nếu đồng ý thêm `pypdf`) → lưu file gốc + văn bản + hash.
3. **Prompt + JSON schema** cho Codex: scenario, requirement, type, parameters, acceptance_criteria, source_quote, open_questions.
4. **Kiểm tra đầu ra**: trích dẫn phải có trong tài liệu; ID do backend sinh; loại bỏ trùng lặp.
5. **API checklist**: CRUD requirement, sắp xếp, đổi trạng thái thủ công, lịch sử thay đổi.
6. **Re-import feedback**: AI so tài liệu mới với checklist hiện tại → danh sách thay đổi đề xuất → người dùng duyệt.
7. **Giao diện**: mục "Development" trên sidebar → danh sách project → trang project (tài liệu, checklist theo scenario, chi tiết requirement, tóm tắt tiến độ). EN/VI/KO.
8. **Test**: parser từng định dạng, schema validation, trích dẫn giả bị gắn cờ, chỉnh tay không bị ghi đè, Clear All Data xóa sạch dữ liệu mới, hồi quy toàn bộ test cũ.

---

## 8. Câu hỏi cần trả lời trước khi bắt đầu

1. **Tài liệu GDD** thường ở định dạng nào (Google Docs xuất PDF/DOCX, Notion, Markdown)? Ngôn ngữ gì?
2. Gửi lại file **Dragon Burst GDD** (`Pasted text(20261106-024025).txt`) để dùng làm dữ liệu test — hiện mình chưa có file này.
3. **Unity**: phiên bản nào? URP hay Built-in? Project có bật *Force Text serialization* không? Dùng git không? Project lớn cỡ nào?
4. Ai dùng: chỉ bạn hay cả team? Có cần **chia sẻ checklist giữa nhiều máy** không? (SQLite hiện chỉ lưu trên một máy.)
5. Có chấp nhận thêm thư viện `pypdf` để đọc PDF không?
6. Có chấp nhận cho Codex **đọc thư mục Unity project** (read-only, không mạng) ở Feature 03 không?
7. Giữ hay ngừng phát triển bản Next.js trong `frontend/`?
8. Hạn mức Codex của gói ChatGPT bạn dùng có đủ cho việc phân tích tài liệu dài và quét project thường xuyên không?
