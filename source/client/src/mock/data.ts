// Dữ liệu mẫu trong bộ nhớ. Phần lõi lấy đúng từ "SQL 2 — Dữ liệu mẫu" trong Quiz_Database.md
// (users 1–5, bộ đề 1, phòng QUIZ01/QUIZ02, trận Vĩ 149 – An 130); phần còn lại bổ sung để demo.
// Dữ liệu reset mỗi lần tải lại trang.

import type {
  ChatMessage,
  Choice,
  Game,
  GameQuestion,
  GamePlayer,
  PlayerRound,
  Question,
  QuestionType,
  QuizSet,
  Room,
  User,
} from '../types';
import { calcScore, mulberry32 } from '../lib/game';

export const DEMO_PASSWORD = 'QuizDemo@123';

// ---------------------------------------------------------------- users
const users: User[] = [
  { id: 1, username: 'admin_demo', email: 'admin@quiz.local', displayName: 'Quản trị', role: 'ADMIN', isGuest: false, status: 'ACTIVE', createdAt: '2026-11-01T08:00:00.000Z' },
  { id: 2, username: 'vi_demo', email: 'vi@quiz.local', displayName: 'Vĩ', role: 'USER', isGuest: false, status: 'ACTIVE', createdAt: '2026-11-01T08:05:00.000Z' },
  { id: 3, username: 'an_demo', email: 'an@quiz.local', displayName: 'An', role: 'USER', isGuest: false, status: 'ACTIVE', createdAt: '2026-11-01T08:10:00.000Z' },
  { id: 4, username: 'huy_demo', email: 'huy@quiz.local', displayName: 'Huy', role: 'USER', isGuest: false, status: 'ACTIVE', createdAt: '2026-11-01T08:15:00.000Z' },
  { id: 5, username: null, email: null, displayName: 'Khách 01', role: 'USER', isGuest: true, status: 'ACTIVE', createdAt: '2026-11-12T09:00:00.000Z' },
  // Bổ sung: các tài khoản do "mock server" điều khiển như người chơi khác
  { id: 6, username: 'lan_demo', email: 'lan@quiz.local', displayName: 'Lan', role: 'USER', isGuest: false, status: 'ACTIVE', createdAt: '2026-11-03T10:00:00.000Z' },
  { id: 7, username: 'minh_demo', email: 'minh@quiz.local', displayName: 'Minh', role: 'USER', isGuest: false, status: 'ACTIVE', createdAt: '2026-11-03T11:00:00.000Z' },
  { id: 8, username: 'tu_demo', email: 'tu@quiz.local', displayName: 'Tú', role: 'USER', isGuest: false, status: 'ACTIVE', createdAt: '2026-11-04T09:30:00.000Z' },
  { id: 9, username: 'ha_demo', email: 'ha@quiz.local', displayName: 'Hà', role: 'USER', isGuest: false, status: 'ACTIVE', createdAt: '2026-11-05T14:00:00.000Z' },
  { id: 10, username: 'spam_bot', email: 'spam@quiz.local', displayName: 'Spam Bot', role: 'USER', isGuest: false, status: 'LOCKED', createdAt: '2026-11-08T02:00:00.000Z' },
];

/** Mật khẩu của từng tài khoản (mock thay cho password_hash). */
const passwords: Record<number, string> = Object.fromEntries(
  users.filter((u) => !u.isGuest).map((u) => [u.id, DEMO_PASSWORD]),
);

// ---------------------------------------------------------------- quiz sets
let questionSeq = 1;
let choiceSeq = 1;

type ChoiceDef = [string, boolean];
interface QDef {
  type: QuestionType;
  content: string;
  choices: ChoiceDef[];
  timeLimitMs?: number | null;
  points?: number;
  explanation?: string;
}

function buildQuestions(quizSetId: number, defs: QDef[]): Question[] {
  return defs.map((d, i) => {
    const id = questionSeq++;
    return {
      id,
      quizSetId,
      type: d.type,
      content: d.content,
      imageUrl: null,
      timeLimitMs: d.timeLimitMs ?? null,
      points: d.points ?? 100,
      explanation: d.explanation ?? null,
      position: i + 1,
      choices: d.choices.map<Choice>(([content, isCorrect], j) => ({
        id: choiceSeq++,
        content,
        position: j + 1,
        isCorrect,
      })),
    };
  });
}

const TF = (correct: boolean): ChoiceDef[] => [
  ['Đúng', correct],
  ['Sai', !correct],
];

function quizSet(
  id: number,
  ownerId: number,
  title: string,
  description: string,
  visibility: QuizSet['visibility'],
  createdAt: string,
  defs: QDef[],
  copiedFromId: number | null = null,
): QuizSet {
  return {
    id,
    ownerId,
    title,
    description,
    visibility,
    copiedFromId,
    deletedAt: null,
    createdAt,
    updatedAt: createdAt,
    questions: buildQuestions(id, defs),
  };
}

const networkBasics: QDef[] = [
  {
    type: 'SINGLE',
    content: 'Giao thức nào ở tầng giao vận bảo đảm truyền tin cậy và đúng thứ tự?',
    choices: [['TCP', true], ['UDP', false], ['IP', false], ['ICMP', false]],
    explanation: 'TCP dùng số thứ tự, báo nhận và truyền lại.',
  },
  {
    type: 'MULTIPLE',
    content: 'Những phát biểu nào đúng về WebSocket?',
    choices: [
      ['Bắt tay ban đầu bằng yêu cầu HTTP Upgrade', true],
      ['Server có thể chủ động gửi dữ liệu cho client', true],
      ['Chạy trên UDP', false],
      ['Mỗi tin nhắn phải mở một kết nối mới', false],
    ],
    explanation: 'WebSocket bắt tay bằng HTTP Upgrade rồi giữ một kết nối TCP hai chiều.',
  },
  {
    type: 'TRUE_FALSE',
    content: 'HTTP là giao thức không trạng thái (stateless).',
    choices: TF(true),
    timeLimitMs: 20000,
    explanation: 'Mỗi yêu cầu HTTP độc lập; trạng thái được giữ bằng cookie hoặc token.',
  },
];

const quizSets: QuizSet[] = [
  quizSet(1, 2, 'Lập trình mạng cơ bản', 'TCP, WebSocket và HTTP', 'PUBLIC', '2026-11-02T10:00:00.000Z', [
    ...networkBasics,
    {
      type: 'SINGLE',
      content: 'Cổng mặc định của HTTPS là gì?',
      choices: [['80', false], ['443', true], ['8080', false], ['22', false]],
      explanation: 'HTTPS mặc định dùng cổng 443, HTTP dùng cổng 80.',
    },
    {
      type: 'SINGLE',
      content: 'Bắt tay ba bước của TCP gồm chuỗi gói nào?',
      choices: [
        ['SYN → SYN-ACK → ACK', true],
        ['SYN → ACK → FIN', false],
        ['HELLO → ACK → DATA', false],
        ['ACK → SYN → SYN-ACK', false],
      ],
      explanation: 'Client gửi SYN, server trả SYN-ACK, client xác nhận ACK.',
    },
  ]),
  quizSet(2, 3, 'Mạng máy tính – Mô hình OSI', 'Bảy tầng OSI và các giao thức tiêu biểu', 'PUBLIC', '2026-11-04T08:00:00.000Z', [
    {
      type: 'SINGLE',
      content: 'Mô hình OSI có bao nhiêu tầng?',
      choices: [['5', false], ['6', false], ['7', true], ['4', false]],
      explanation: 'Physical, Data Link, Network, Transport, Session, Presentation, Application.',
    },
    {
      type: 'SINGLE',
      content: 'Router hoạt động chủ yếu ở tầng nào?',
      choices: [['Tầng vật lý', false], ['Tầng liên kết dữ liệu', false], ['Tầng mạng', true], ['Tầng ứng dụng', false]],
      explanation: 'Router định tuyến gói IP, thuộc tầng 3 (Network).',
    },
    {
      type: 'MULTIPLE',
      content: 'Những giao thức nào thuộc tầng ứng dụng?',
      choices: [['HTTP', true], ['DNS', true], ['TCP', false], ['SMTP', true], ['ARP', false]],
      explanation: 'TCP thuộc tầng giao vận; ARP nằm giữa tầng 2 và 3.',
    },
    {
      type: 'TRUE_FALSE',
      content: 'Địa chỉ MAC được dùng ở tầng liên kết dữ liệu.',
      choices: TF(true),
      timeLimitMs: 15000,
    },
    {
      type: 'SINGLE',
      content: 'Giao thức nào phân giải tên miền thành địa chỉ IP?',
      choices: [['DHCP', false], ['DNS', true], ['FTP', false], ['NAT', false]],
    },
    {
      type: 'TRUE_FALSE',
      content: 'UDP có cơ chế truyền lại khi mất gói.',
      choices: TF(false),
      timeLimitMs: 15000,
      explanation: 'UDP không có báo nhận hay truyền lại; ứng dụng phải tự xử lý.',
    },
  ]),
  quizSet(3, 4, 'Java Socket', 'ServerSocket, luồng I/O và đa luồng trong Java', 'PUBLIC', '2026-11-06T13:00:00.000Z', [
    {
      type: 'SINGLE',
      content: 'Phương thức nào của ServerSocket chờ và nhận một kết nối mới?',
      choices: [['listen()', false], ['accept()', true], ['connect()', false], ['bind()', false]],
      explanation: 'accept() chặn cho đến khi có client kết nối, trả về một Socket.',
    },
    {
      type: 'MULTIPLE',
      content: 'Cách nào giúp server phục vụ nhiều client cùng lúc?',
      choices: [
        ['Mỗi client một Thread', true],
        ['Dùng ExecutorService (thread pool)', true],
        ['Dùng NIO Selector', true],
        ['Gọi accept() nhiều lần trên cùng một luồng mà không tạo luồng mới', false],
      ],
    },
    {
      type: 'TRUE_FALSE',
      content: 'Socket.getInputStream() trả về luồng để đọc dữ liệu từ phía bên kia.',
      choices: TF(true),
      timeLimitMs: 15000,
    },
    {
      type: 'SINGLE',
      content: 'Ngoại lệ nào thường gặp khi kết nối tới cổng không có server lắng nghe?',
      choices: [
        ['ConnectException', true],
        ['NullPointerException', false],
        ['ClassCastException', false],
        ['ArithmeticException', false],
      ],
    },
    {
      type: 'SINGLE',
      content: 'Lớp nào dùng để gửi gói tin UDP trong Java?',
      choices: [['DatagramSocket', true], ['ServerSocket', false], ['HttpClient', false], ['URLConnection', false]],
      points: 150,
    },
  ]),
  quizSet(4, 4, 'Ôn thi cuối kỳ (nháp)', 'Bộ đề riêng của Huy, chưa hoàn thiện', 'PRIVATE', '2026-11-11T20:00:00.000Z', [
    {
      type: 'SINGLE',
      content: 'Lệnh nào kiểm tra kết nối tới một máy bằng ICMP?',
      choices: [['ping', true], ['ls', false], ['ssh', false]],
    },
    {
      type: 'TRUE_FALSE',
      content: 'IPv6 dùng địa chỉ 128 bit.',
      choices: TF(true),
    },
  ]),
  quizSet(5, 7, 'JavaScript cơ bản', 'Kiểu dữ liệu, hàm, bất đồng bộ', 'PUBLIC', '2026-11-07T09:00:00.000Z', [
    {
      type: 'SINGLE',
      content: 'typeof null trả về gì?',
      choices: [['"null"', false], ['"object"', true], ['"undefined"', false], ['"number"', false]],
      explanation: 'Đây là một lỗi lịch sử của JavaScript được giữ lại để tương thích.',
    },
    {
      type: 'MULTIPLE',
      content: 'Những giá trị nào là falsy?',
      choices: [['0', true], ['""', true], ['[]', false], ['null', true], ['"0"', false]],
    },
    {
      type: 'TRUE_FALSE',
      content: 'await chỉ dùng được bên trong hàm async (trừ top-level module).',
      choices: TF(true),
    },
    {
      type: 'SINGLE',
      content: 'Phương thức nào tạo mảng mới từ kết quả gọi hàm trên mỗi phần tử?',
      choices: [['forEach', false], ['map', true], ['reduce', false], ['some', false]],
    },
  ]),
  quizSet(
    6,
    4,
    'Lập trình mạng cơ bản (bản sao)',
    'Sao chép từ bộ đề của Vĩ',
    'PRIVATE',
    '2026-11-12T07:00:00.000Z',
    networkBasics,
    1,
  ),
];

// ---------------------------------------------------------------- rooms
const rooms: Room[] = [
  {
    id: '7b1e0c52-1a2b-4c3d-8e4f-000000000001',
    roomCode: 'QUIZ01',
    title: 'Ôn tập giữa kỳ',
    hostUserId: 2,
    quizSetId: 1,
    visibility: 'PUBLIC',
    hasPassword: false,
    maxPlayers: 20,
    mode: 'SELF_PACED',
    questionTimeMs: 30000,
    shuffleQuestions: false,
    shuffleChoices: false,
    streakBonus: false,
    status: 'CLOSED',
    createdAt: '2026-11-10T12:55:00.000Z',
    members: [
      { userId: 2, displayName: 'Vĩ', isGuest: false, status: 'LEFT', joinedAt: '2026-11-10T12:55:00.000Z' },
      { userId: 3, displayName: 'An', isGuest: false, status: 'LEFT', joinedAt: '2026-11-10T12:57:00.000Z' },
    ],
  },
  {
    id: '7b1e0c52-1a2b-4c3d-8e4f-000000000002',
    roomCode: 'QUIZ02',
    title: 'Luyện tập buổi tối',
    hostUserId: 4,
    quizSetId: 1,
    visibility: 'PUBLIC',
    hasPassword: false,
    maxPlayers: 10,
    mode: 'LIVE',
    questionTimeMs: 20000,
    shuffleQuestions: false,
    shuffleChoices: false,
    streakBonus: false,
    status: 'WAITING',
    createdAt: '2026-11-12T09:00:00.000Z',
    members: [
      { userId: 4, displayName: 'Huy', isGuest: false, status: 'JOINED', joinedAt: '2026-11-12T09:00:00.000Z' },
      { userId: 5, displayName: 'Khách 01', isGuest: true, status: 'JOINED', joinedAt: '2026-11-12T09:01:00.000Z' },
    ],
  },
  {
    id: '7b1e0c52-1a2b-4c3d-8e4f-000000000005',
    roomCode: 'OSI777',
    title: 'Giải lao 15 phút – OSI',
    hostUserId: 3,
    quizSetId: 2,
    visibility: 'PUBLIC',
    hasPassword: false,
    maxPlayers: 8,
    mode: 'SELF_PACED',
    questionTimeMs: 20000,
    shuffleQuestions: true,
    shuffleChoices: true,
    streakBonus: true,
    status: 'WAITING',
    createdAt: '2026-11-17T13:40:00.000Z',
    members: [
      { userId: 3, displayName: 'An', isGuest: false, status: 'JOINED', joinedAt: '2026-11-17T13:40:00.000Z' },
      { userId: 6, displayName: 'Lan', isGuest: false, status: 'JOINED', joinedAt: '2026-11-17T13:41:00.000Z' },
      { userId: 8, displayName: 'Tú', isGuest: false, status: 'JOINED', joinedAt: '2026-11-17T13:42:00.000Z' },
    ],
  },
  {
    id: '7b1e0c52-1a2b-4c3d-8e4f-000000000006',
    roomCode: 'JS2026',
    title: 'Đấu nhanh JavaScript',
    hostUserId: 7,
    quizSetId: 5,
    visibility: 'PUBLIC',
    hasPassword: true, // mật khẩu: js
    maxPlayers: 6,
    mode: 'LIVE',
    questionTimeMs: 15000,
    shuffleQuestions: false,
    shuffleChoices: true,
    streakBonus: true,
    status: 'WAITING',
    createdAt: '2026-11-17T13:50:00.000Z',
    members: [
      { userId: 7, displayName: 'Minh', isGuest: false, status: 'JOINED', joinedAt: '2026-11-17T13:50:00.000Z' },
      { userId: 9, displayName: 'Hà', isGuest: false, status: 'JOINED', joinedAt: '2026-11-17T13:51:00.000Z' },
    ],
  },
  {
    id: '7b1e0c52-1a2b-4c3d-8e4f-000000000007',
    roomCode: 'NHOM04',
    title: 'Phòng kín nhóm 04',
    hostUserId: 2,
    quizSetId: 3,
    visibility: 'PRIVATE',
    hasPassword: true, // mật khẩu: 1234
    maxPlayers: 4,
    mode: 'SELF_PACED',
    questionTimeMs: 30000,
    shuffleQuestions: false,
    shuffleChoices: false,
    streakBonus: false,
    status: 'WAITING',
    createdAt: '2026-11-17T12:00:00.000Z',
    members: [{ userId: 2, displayName: 'Vĩ', isGuest: false, status: 'JOINED', joinedAt: '2026-11-17T12:00:00.000Z' }],
  },
  {
    id: '7b1e0c52-1a2b-4c3d-8e4f-000000000008',
    roomCode: 'JAVA99',
    title: 'Java Socket marathon',
    hostUserId: 8,
    quizSetId: 3,
    visibility: 'PUBLIC',
    hasPassword: false,
    maxPlayers: 30,
    mode: 'LIVE',
    questionTimeMs: 20000,
    shuffleQuestions: false,
    shuffleChoices: false,
    streakBonus: false,
    status: 'PLAYING',
    createdAt: '2026-11-17T13:30:00.000Z',
    members: [
      { userId: 8, displayName: 'Tú', isGuest: false, status: 'JOINED', joinedAt: '2026-11-17T13:30:00.000Z' },
      { userId: 9, displayName: 'Hà', isGuest: false, status: 'JOINED', joinedAt: '2026-11-17T13:31:00.000Z' },
    ],
  },
];

/** Mật khẩu phòng (mock thay cho password_hash). */
const roomPasswords: Record<string, string> = {
  JS2026: 'js',
  NHOM04: '1234',
};

const roomMessages: ChatMessage[] = [
  { id: 1, roomId: rooms[0].id, userId: 3, displayName: 'An', content: 'Sẵn sàng rồi!', sentAt: '2026-11-10T12:58:00.000Z' },
  { id: 2, roomId: rooms[0].id, userId: 2, displayName: 'Vĩ', content: 'Bắt đầu nhé', sentAt: '2026-11-10T12:59:30.000Z' },
  { id: 3, roomId: rooms[1].id, userId: 4, displayName: 'Huy', content: 'Chờ thêm vài bạn rồi mình bắt đầu', sentAt: '2026-11-12T09:01:30.000Z' },
  { id: 4, roomId: rooms[1].id, userId: 5, displayName: 'Khách 01', content: 'Ok anh', sentAt: '2026-11-12T09:02:00.000Z' },
  { id: 5, roomId: rooms[2].id, userId: 6, displayName: 'Lan', content: 'Bộ đề OSI này khó không mọi người?', sentAt: '2026-11-17T13:41:30.000Z' },
];

// ---------------------------------------------------------------- games

/** Chụp bộ đề thành game_questions / game_choices. */
export function snapshotQuestions(set: QuizSet, roomTimeMs: number): GameQuestion[] {
  return set.questions
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((q) => ({
      id: q.id,
      sourceQuestionId: q.id,
      type: q.type,
      content: q.content,
      imageUrl: q.imageUrl,
      timeLimitMs: q.timeLimitMs ?? roomTimeMs,
      points: q.points,
      explanation: q.explanation,
      position: q.position,
      choices: q.choices.map((c) => ({ ...c })),
    }));
}

const iso = (ms: number) => new Date(ms).toISOString();

// Trận mẫu từ seed: Vĩ 149 (hạng 1), An 130 (hạng 2)
function seedGame(): Game {
  const set = quizSets[0];
  const questions = snapshotQuestions({ ...set, questions: set.questions.slice(0, 3) }, 30000);
  const gid = '3f9a6d10-5b2c-4e7f-9a10-000000000001';
  const t0 = Date.parse('2026-11-10T13:00:00.000Z');
  const r = (
    id: string,
    pid: number,
    qid: number,
    status: PlayerRound['status'],
    s: number,
    d: number,
    a: number | null,
    score: number,
    choiceIds: number[],
  ): PlayerRound => ({
    id,
    gamePlayerId: pid,
    gameQuestionId: qid,
    status,
    startedAt: iso(t0 + s * 1000),
    deadlineAt: iso(t0 + d * 1000),
    answeredAt: a == null ? null : iso(t0 + a * 1000),
    score,
    bonus: 0,
    choiceIds,
  });
  return {
    id: gid,
    roomId: rooms[0].id,
    roomCode: 'QUIZ01',
    roomTitle: 'Ôn tập giữa kỳ',
    quizSetId: 1,
    quizTitleSnapshot: 'Lập trình mạng cơ bản',
    mode: 'SELF_PACED',
    questionTimeMs: 30000,
    shuffleQuestions: false,
    shuffleChoices: false,
    streakBonus: false,
    status: 'FINISHED',
    startedBy: 2,
    startedAt: iso(t0),
    endedAt: iso(t0 + 35000),
    cancelReason: null,
    questions,
    players: [
      { id: 1, userId: 2, displayName: 'Vĩ', status: 'COMPLETED', shuffleSeed: 918273645, totalScore: 149, correctCount: 2, currentStreak: 0, bestStreak: 2, finalRank: 1, completedAt: iso(t0 + 35000) },
      { id: 2, userId: 3, displayName: 'An', status: 'COMPLETED', shuffleSeed: 564738291, totalScore: 130, correctCount: 2, currentStreak: 1, bestStreak: 1, finalRank: 2, completedAt: iso(t0 + 24000) },
    ],
    rounds: [
      r('a0000000-0000-4000-8000-000000000101', 1, 1, 'CORRECT', 0, 30, 5, 83, [1]),
      r('a0000000-0000-4000-8000-000000000102', 1, 2, 'CORRECT', 5, 35, 15, 66, [5, 6]),
      r('a0000000-0000-4000-8000-000000000103', 1, 3, 'TIMEOUT', 15, 35, null, 0, []),
      r('a0000000-0000-4000-8000-000000000201', 2, 1, 'CORRECT', 0, 30, 15, 50, [1]),
      r('a0000000-0000-4000-8000-000000000202', 2, 2, 'WRONG', 15, 45, 20, 0, [5, 7]),
      r('a0000000-0000-4000-8000-000000000203', 2, 3, 'CORRECT', 20, 40, 24, 80, [9]),
    ],
  };
}

let gamePlayerSeq = 100;

/** Sinh một trận đã kết thúc với kết quả giả lập (dùng hạt giống cố định để ổn định). */
function simulatedGame(opts: {
  id: string;
  roomCode: string;
  roomTitle: string;
  quizSetId: number;
  mode: Game['mode'];
  startedBy: number;
  startedAt: string;
  players: [number, string, number][]; // userId, tên, độ chính xác 0..1
  seed: number;
}): Game {
  const set = quizSets.find((s) => s.id === opts.quizSetId)!;
  const questions = snapshotQuestions(set, 20000);
  const rand = mulberry32(opts.seed);
  const t0 = Date.parse(opts.startedAt);
  const rounds: PlayerRound[] = [];
  let maxEnd = t0;
  const players: GamePlayer[] = opts.players.map(([userId, name, acc]) => {
    const pid = gamePlayerSeq++;
    let t = t0;
    let total = 0;
    let correct = 0;
    let streak = 0;
    let best = 0;
    questions.forEach((q, i) => {
      const used = Math.floor(q.timeLimitMs * (0.15 + rand() * 0.9));
      const timeout = used >= q.timeLimitMs;
      const ok = !timeout && rand() < acc;
      const right = q.choices.filter((c) => c.isCorrect).map((c) => c.id);
      const wrong = q.choices.filter((c) => !c.isCorrect).map((c) => c.id);
      const score = ok ? calcScore(q.points, q.timeLimitMs - used, q.timeLimitMs) : 0;
      streak = ok ? streak + 1 : 0;
      best = Math.max(best, streak);
      if (ok) correct++;
      total += score;
      rounds.push({
        id: `${opts.id.slice(0, 8)}-r${pid}-${i}`,
        gamePlayerId: pid,
        gameQuestionId: q.id,
        status: timeout ? 'TIMEOUT' : ok ? 'CORRECT' : 'WRONG',
        startedAt: iso(t),
        deadlineAt: iso(t + q.timeLimitMs),
        answeredAt: timeout ? null : iso(t + used),
        score,
        bonus: 0,
        choiceIds: timeout ? [] : ok ? right : [wrong[Math.floor(rand() * wrong.length)]],
      });
      t += Math.min(used, q.timeLimitMs);
    });
    maxEnd = Math.max(maxEnd, t);
    return {
      id: pid,
      userId,
      displayName: name,
      status: 'COMPLETED',
      shuffleSeed: Math.floor(rand() * 1e9),
      totalScore: total,
      correctCount: correct,
      currentStreak: streak,
      bestStreak: best,
      finalRank: null,
      completedAt: iso(t),
    };
  });
  assignRanks(players);
  return {
    id: opts.id,
    roomId: `room-${opts.roomCode}`,
    roomCode: opts.roomCode,
    roomTitle: opts.roomTitle,
    quizSetId: opts.quizSetId,
    quizTitleSnapshot: set.title,
    mode: opts.mode,
    questionTimeMs: 20000,
    shuffleQuestions: false,
    shuffleChoices: false,
    streakBonus: false,
    status: 'FINISHED',
    startedBy: opts.startedBy,
    startedAt: opts.startedAt,
    endedAt: iso(maxEnd),
    cancelReason: null,
    questions,
    players,
    rounds,
  };
}

/** Xếp hạng đồng hạng kiểu 1, 1, 3. */
export function assignRanks(players: GamePlayer[]) {
  const sorted = players.slice().sort((a, b) => b.totalScore - a.totalScore);
  sorted.forEach((p, i) => {
    p.finalRank = i > 0 && sorted[i - 1].totalScore === p.totalScore ? sorted[i - 1].finalRank : i + 1;
  });
}

const games: Game[] = [
  seedGame(),
  simulatedGame({
    id: '3f9a6d10-5b2c-4e7f-9a10-000000000002',
    roomCode: 'JV8K2P',
    roomTitle: 'Thử sức Java',
    quizSetId: 3,
    mode: 'LIVE',
    startedBy: 4,
    startedAt: '2026-11-13T14:00:00.000Z',
    players: [[4, 'Huy', 0.8], [2, 'Vĩ', 0.7], [6, 'Lan', 0.6], [7, 'Minh', 0.5]],
    seed: 42,
  }),
  simulatedGame({
    id: '3f9a6d10-5b2c-4e7f-9a10-000000000003',
    roomCode: 'OSI101',
    roomTitle: 'OSI sáng thứ bảy',
    quizSetId: 2,
    mode: 'SELF_PACED',
    startedBy: 3,
    startedAt: '2026-11-15T02:00:00.000Z',
    players: [[3, 'An', 0.85], [4, 'Huy', 0.65], [8, 'Tú', 0.6], [9, 'Hà', 0.4]],
    seed: 7,
  }),
  simulatedGame({
    id: '3f9a6d10-5b2c-4e7f-9a10-000000000004',
    roomCode: 'NET555',
    roomTitle: 'Luyện tập buổi tối',
    quizSetId: 1,
    mode: 'LIVE',
    startedBy: 4,
    startedAt: '2026-11-16T13:00:00.000Z',
    players: [[4, 'Huy', 0.75], [5, 'Khách 01', 0.5], [6, 'Lan', 0.7], [3, 'An', 0.8], [7, 'Minh', 0.6]],
    seed: 2026,
  }),
];

// ---------------------------------------------------------------- export
export const db = {
  users,
  passwords,
  quizSets,
  rooms,
  roomPasswords,
  roomMessages,
  games,
  seq: {
    user: 100,
    quizSet: 100,
    question: 1000,
    choice: 5000,
    message: 100,
    gamePlayer: 1000,
    gameChoice: 10000,
  },
};

export type Db = typeof db;
