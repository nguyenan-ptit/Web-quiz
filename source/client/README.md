# MODULE CLIENT

Giao diện React cho hệ thống Quiz nhiều người dùng. **Hiện chạy hoàn toàn bằng mock data**: một "mock server" trong trình duyệt giả lập REST API và cổng WebSocket theo đúng giao thức trong tài liệu thiết kế, nên có thể demo trọn một trận trước khi có backend Spring Boot.

---

## ⚙️ CÔNG NGHỆ SỬ DỤNG

| Thành phần | Công nghệ |
|------------|-----------|
| Ngôn ngữ | TypeScript |
| Framework | React 18 + Vite 5 |
| Định tuyến | React Router 6 |
| Trạng thái phòng / trận | Zustand |
| Gọi REST | TanStack Query |
| Giao thức | REST (mock) + WebSocket JSON (mock, cùng API với `WebSocket` của trình duyệt) |

---

## 🚀 HƯỚNG DẪN CHẠY

```bash
cd source/client
pnpm install
pnpm dev           # http://localhost:5173
pnpm build         # kiểm tra kiểu + build ra dist/
```

Tài khoản demo (mật khẩu `QuizDemo@123`): `huy_demo`, `vi_demo`, `an_demo`, `admin_demo` (ADMIN). Hoặc chọn **Chơi với tư cách khách**.

Dữ liệu mock nằm trong bộ nhớ, **tải lại trang là về dữ liệu ban đầu** (riêng phiên đăng nhập được giữ trong `localStorage`).

---

## 📦 CẤU TRÚC

```
client/src/
├── types.ts            # Kiểu dữ liệu bám theo 14 bảng MySQL
├── protocol.ts         # Thông điệp socket client ↔ server (AUTH, JOIN_ROOM, QUESTION_STARTED…)
├── mock/
│   ├── data.ts         # Seed lấy từ Quiz_Database.md (mục 7) + dữ liệu bổ sung
│   ├── api.ts          # Mock REST: /api/auth, /api/quiz-sets, /api/games, /api/admin…
│   └── server.ts       # Mock WebSocket server: phòng, trận, bộ định thời, chấm điểm, người chơi ảo
├── lib/
│   ├── socket.ts       # QuizSocket + useQuizSocket: AUTH, PING 10s, tự kết nối lại 1/2/4/8s, requestId
│   ├── game.ts         # Công thức điểm, thưởng chuỗi, xáo trộn theo shuffle_seed
│   └── format.ts
├── store/              # Zustand: auth, live (sảnh / phòng / trận / log socket)
├── components/         # Layout, thanh kết nối, toast, panel log socket, UI cơ bản
└── pages/              # Đăng nhập, Sảnh, Phòng chờ, Chơi, Kết quả, Bộ đề, Soạn đề,
                        # Thống kê đề, Lịch sử, Xếp hạng, Hồ sơ, Quản trị
```

---

## 💡 CÁC MÀN HÌNH

| Trang | Đường dẫn | Nội dung |
|-------|-----------|----------|
| Đăng nhập | `/login` | Đăng nhập, đăng ký, vào với tư cách khách |
| Sảnh | `/lobby` | Phòng công khai đang chờ (cập nhật tức thời), vào bằng mã, tạo phòng |
| Phòng chờ | `/rooms/:code` | Thành viên, mời ra / chuyển chủ phòng, cấu hình trận, chat (giới hạn 5 tin / 10 giây) |
| Chơi | `/play` | Đếm ngược, câu hỏi 3 loại, đồng hồ theo `deadlineAt` của server, bảng xếp hạng trực tiếp; chế độ đồng bộ hiện đáp án + số người chọn sau mỗi câu |
| Kết quả | `/games/:id/result` | Bục vinh danh, bảng tổng kết, xem lại từng câu của từng người |
| Bộ đề | `/quiz-sets` | Bộ đề của tôi / thư viện công khai, sao chép, xóa mềm |
| Soạn đề | `/quiz-sets/:id/edit` | Thêm / sửa / sắp xếp câu hỏi, kiểm tra BR09, nhập CSV |
| Thống kê | `/quiz-sets/:id/stats` | Tỷ lệ đúng, thời gian trung bình, số lần hết giờ từng câu |
| Lịch sử | `/history` | Trận đã chơi / đã tổ chức |
| Xếp hạng | `/leaderboard` | Bảng xếp hạng toàn hệ thống |
| Quản trị | `/admin` | Khóa tài khoản, gỡ bộ đề công khai |

### Demo phần mạng

Nút **`</>`** trên thanh trên cùng mở panel **Socket log**: xem từng thông điệp gửi / nhận (bấm để xem JSON), và các nút giả lập:

- **Rớt mạng 5s** – client tự kết nối lại, gửi `AUTH` rồi `RESUME`, nhận `GAME_STATE` với thời hạn cũ (BR18).
- **Rớt mạng 40s** – quá 30 giây nên bị đánh dấu rời trận.
- **Tab khác đăng nhập** – server gửi `SESSION_REPLACED` (BR21).

Phòng có chủ phòng là người chơi ảo (VD `QUIZ02` khi đăng nhập bằng `vi_demo`) sẽ tự bắt đầu trận sau khoảng 25 giây; sau trận, chủ phòng ảo nhường quyền để bạn tự chơi lại.

---

## 🔌 NỐI VỚI BACKEND THẬT

1. Trong `src/lib/socket.ts`, đổi `new MockWebSocket(WS_URL)` thành `new WebSocket(WS_URL)` (giao thức JSON giữ nguyên như `src/protocol.ts`).
2. Trong `src/mock/api.ts`, thay thân mỗi hàm bằng `fetch()` tới endpoint ghi trong chú thích (VD `GET /api/quiz-sets?scope=mine`), gửi token trong header `Authorization`. Chữ ký hàm giữ nguyên nên các trang không phải sửa.
3. Mặc định server ở `http://localhost:8080`, WebSocket ở `ws://localhost:8080/ws`.

## 📝 GHI CHÚ

- Sau khi trả lời ở chế độ tiến độ riêng, mock server chờ 1,5 giây rồi mới mở câu kế tiếp để người chơi kịp thấy kết quả. Theo BR14, server thật mở câu kế tiếp ngay; nếu giữ khoảng dừng này thì nên để phía client xử lý.
- Nhập CSV tách cột bằng dấu phẩy đơn giản; nội dung chứa dấu phẩy hoặc lựa chọn chỉ gồm chữ số sẽ bị đọc sai.
