# MODULE CLIENT

Giao diện React cho hệ thống Quiz nhiều người dùng. **Mặc định kết nối backend thật cho phần tài khoản, phòng và người chơi**. Các trang demo bộ đề/trận của giao diện gốc được giữ trong chế độ mock riêng.

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
npm install
npm run dev        # http://localhost:5173
npm run build         # kiểm tra kiểu + build ra dist/
```

Chỉ trong chế độ mock: tài khoản demo (mật khẩu `QuizDemo@123`): `huy_demo`, `vi_demo`, `an_demo`, `admin_demo` (ADMIN). Hoặc chọn **Chơi với tư cách khách**.

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

## 🔌 BACKEND THẬT VÀ MOCK

Mặc định `VITE_MOCK_MODE=false`. Chạy Spring Boot và MySQL theo README ở thư mục gốc, sau đó chạy FE. Vite chuyển tiếp `/api` và `/ws` tới `BACKEND_URL` trong `.env` gốc (mặc định `http://localhost:8080`). Origin FE cần nằm trong `QUIZ_ORIGINS` của backend.

- Nhập tên khách: `POST /api/auth/guest`.
- Đăng ký tài khoản: `POST /api/auth/register`, tự đăng nhập sau khi tạo thành công.
- Đăng nhập tài khoản: `POST /api/auth/login`; khôi phục: `GET /api/auth/me`.
- WebSocket `/ws`: AUTH đầu tiên, UUID cho requestId, payload luôn là object; PING mỗi 10 giây.
- Phòng: CREATE_ROOM, JOIN_ROOM, LEAVE_ROOM, TRANSFER_HOST, KICK_MEMBER; nhận snapshot trực tiếp ROOM_STATE/ROOM_UPDATED và các sự kiện rời/đóng/bị mời ra.
- Adapter `lib/backend-room-socket.ts` đổi DTO backend sang kiểu dữ liệu dùng chung của giao diện gốc. `connection.ts` giữ yêu cầu chờ khi mất mạng và gửi lại cùng UUID.
- Backend chưa có danh sách phòng công khai, chat, cấu hình trận và bắt đầu trận; các nút này chỉ có trong mock. Khách chỉ vào phòng, tài khoản thật mới tạo phòng.
- Đăng xuất hiện xóa token trên trình duyệt; backend chưa có API thu hồi phiên.

Để xem lại toàn bộ demo gốc, đặt `VITE_MOCK_MODE=true` trong `.env` gốc rồi khởi động lại Vite. Token mock và token thật không dùng thay thế cho nhau; đăng nhập lại khi chuyển chế độ. Mock chỉ chạy trong từng trình duyệt, không chứng minh việc đồng bộ nhiều người dùng thật.

### Kiểm tra luồng phòng

1. Mở tài khoản thật ở trình duyệt thứ nhất, tạo phòng và sao chép mã.
2. Mở cửa sổ ẩn danh, nhập tên khách và vào bằng mã. Kiểm tra danh sách cập nhật ở cả hai phía.
3. Thử sai mật khẩu, trùng tên, phòng đầy và mã không tồn tại; lỗi giữ nguyên form để sửa.
4. Dùng tài khoản thật thứ hai để thử chuyển quyền; khách không được nhận quyền chủ phòng.
5. Thử mời ra, vào lại, rời phòng và đóng phòng khi chủ phòng cuối cùng rời.
6. Ngắt mạng rồi bật lại để kiểm tra trạng thái trực tuyến, nối lại và mốc giữ chỗ 2 phút. Mở cùng tài khoản ở tab khác để kiểm tra phiên bị thay thế.

## 📝 GHI CHÚ

- Sau khi trả lời ở chế độ tiến độ riêng, mock server chờ 1,5 giây rồi mới mở câu kế tiếp để người chơi kịp thấy kết quả. Theo BR14, server thật mở câu kế tiếp ngay; nếu giữ khoảng dừng này thì nên để phía client xử lý.
- Nhập CSV tách cột bằng dấu phẩy đơn giản; nội dung chứa dấu phẩy hoặc lựa chọn chỉ gồm chữ số sẽ bị đọc sai.
