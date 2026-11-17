import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { quizSocket } from './lib/socket';
import { useAuth } from './store/auth';
import LoginPage from './pages/LoginPage';
import LobbyPage from './pages/LobbyPage';
import RoomPage from './pages/RoomPage';
import PlayPage from './pages/PlayPage';
import ResultPage from './pages/ResultPage';
import QuizSetsPage from './pages/QuizSetsPage';
import QuizEditorPage from './pages/QuizEditorPage';
import QuizStatsPage from './pages/QuizStatsPage';
import HistoryPage from './pages/HistoryPage';
import LeaderboardPage from './pages/LeaderboardPage';
import ProfilePage from './pages/ProfilePage';
import AdminPage from './pages/AdminPage';
import { Empty } from './components/ui';

function Guard({ children, noGuest, admin }: { children: ReactNode; noGuest?: boolean; admin?: boolean }) {
  const user = useAuth((s) => s.user);
  const loc = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (noGuest && user.isGuest)
    return (
      <div className="page narrow">
        <Empty title="Khách không dùng được chức năng này">
          Đăng ký tài khoản để tạo bộ đề, tạo phòng và xem lịch sử trận.
        </Empty>
      </div>
    );
  if (admin && user.role !== 'ADMIN')
    return (
      <div className="page narrow">
        <Empty title="Chỉ dành cho quản trị viên" />
      </div>
    );
  return <>{children}</>;
}

export default function App() {
  const { ready, user, token, init } = useAuth();

  useEffect(() => {
    init();
  }, [init]);

  // Một kết nối socket cho mỗi tab, mở khi đã có token phiên
  useEffect(() => {
    if (token) quizSocket.connect(token);
  }, [token]);

  if (!ready) return <Spinner label="Đang khởi động…" />;


  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/lobby" replace /> : <LoginPage />} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route index element={<Navigate to="/lobby" replace />} />
        <Route path="/lobby" element={<LobbyPage />} />
        <Route path="/rooms/:code" element={<RoomPage />} />
        <Route path="/play" element={<PlayPage />} />
        <Route path="/games/:id/result" element={<ResultPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/quiz-sets" element={<Guard noGuest><QuizSetsPage /></Guard>} />
        <Route path="/quiz-sets/:id/edit" element={<Guard noGuest><QuizEditorPage /></Guard>} />
        <Route path="/quiz-sets/:id/stats" element={<Guard noGuest><QuizStatsPage /></Guard>} />
        <Route path="/history" element={<Guard noGuest><HistoryPage /></Guard>} />
        <Route path="/profile" element={<Guard noGuest><ProfilePage /></Guard>} />
        <Route path="/admin" element={<Guard admin><AdminPage /></Guard>} />
        <Route path="*" element={<div className="page narrow"><Empty title="Không tìm thấy trang" /></div>} />
      </Route>
    </Routes>
  );
}
