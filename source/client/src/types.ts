// Kiểu dữ liệu phía client, bám theo schema MySQL (Quiz_Database.md) và DTO trong thiết kế.
// Cột snake_case trong DB được đổi sang camelCase như JSON mà Spring Boot sẽ trả về.

// ---------- Tài khoản ----------
export type Role = 'USER' | 'ADMIN';
export type UserStatus = 'ACTIVE' | 'LOCKED';

export interface User {
  id: number;
  username: string | null; // NULL với khách
  email: string | null;
  displayName: string;
  role: Role;
  isGuest: boolean;
  status: UserStatus;
  createdAt: string;
}

// ---------- Nội dung ----------
export type Visibility = 'PUBLIC' | 'PRIVATE';
export type QuestionType = 'SINGLE' | 'MULTIPLE' | 'TRUE_FALSE';

export interface Choice {
  id: number;
  content: string;
  position: number; // 1..6
  isCorrect: boolean;
}

export interface Question {
  id: number;
  quizSetId: number;
  type: QuestionType;
  content: string;
  imageUrl: string | null;
  timeLimitMs: number | null; // NULL = dùng thời gian của phòng
  points: number;
  explanation: string | null;
  position: number;
  choices: Choice[];
}

export interface QuizSet {
  id: number;
  ownerId: number;
  title: string;
  description: string;
  visibility: Visibility;
  copiedFromId: number | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  questions: Question[];
}

/** DTO danh sách bộ đề: không có đáp án. */
export interface QuizSetSummary {
  id: number;
  ownerId: number;
  ownerName: string;
  title: string;
  description: string;
  visibility: Visibility;
  copiedFromId: number | null;
  questionCount: number;
  playCount: number;
  updatedAt: string;
}

// ---------- Phòng ----------
export type RoomMode = 'SELF_PACED' | 'LIVE';
export type RoomStatus = 'WAITING' | 'PLAYING' | 'CLOSED';
export type MemberStatus = 'JOINED' | 'LEFT' | 'KICKED';

export interface RoomMember {
  userId: number;
  displayName: string;
  isGuest: boolean;
  status: MemberStatus;
  joinedAt: string;
}

export interface RoomConfig {
  quizSetId: number | null;
  mode: RoomMode;
  questionTimeMs: number;
  maxPlayers: number;
  shuffleQuestions: boolean;
  shuffleChoices: boolean;
  streakBonus: boolean;
}

export interface Room extends RoomConfig {
  id: string; // UUID
  roomCode: string;
  title: string;
  hostUserId: number;
  visibility: Visibility;
  hasPassword: boolean;
  status: RoomStatus;
  createdAt: string;
  members: RoomMember[];
}

export interface ChatMessage {
  id: number;
  roomId: string;
  userId: number;
  displayName: string;
  content: string;
  sentAt: string;
}

/** Một dòng trong sảnh (LOBBY_ROOMS). */
export interface LobbyRoom {
  id: string;
  roomCode: string;
  title: string;
  hostName: string;
  quizTitle: string | null;
  mode: RoomMode;
  memberCount: number;
  maxPlayers: number;
  hasPassword: boolean;
  status: RoomStatus;
}

// ---------- Trận và kết quả ----------
export type GameStatus = 'RUNNING' | 'FINISHED' | 'CANCELLED';
export type PlayerStatus = 'PLAYING' | 'DISCONNECTED' | 'COMPLETED' | 'LEFT';
export type RoundStatus = 'ACTIVE' | 'CORRECT' | 'WRONG' | 'TIMEOUT' | 'CANCELLED';

export interface GameChoice {
  id: number;
  content: string;
  position: number;
  isCorrect: boolean;
}

export interface GameQuestion {
  id: number;
  sourceQuestionId: number | null;
  type: QuestionType;
  content: string;
  imageUrl: string | null;
  timeLimitMs: number;
  points: number;
  explanation: string | null;
  position: number;
  choices: GameChoice[];
}

export interface GamePlayer {
  id: number;
  userId: number;
  displayName: string;
  status: PlayerStatus;
  shuffleSeed: number;
  totalScore: number;
  correctCount: number;
  currentStreak: number;
  bestStreak: number;
  finalRank: number | null;
  completedAt: string | null;
}

export interface PlayerRound {
  id: string; // UUID = roundId
  gamePlayerId: number;
  gameQuestionId: number;
  status: RoundStatus;
  startedAt: string;
  deadlineAt: string;
  answeredAt: string | null;
  score: number;
  bonus: number;
  choiceIds: number[]; // round_choices
}

export interface Game {
  id: string;
  roomId: string;
  roomCode: string;
  roomTitle: string;
  quizSetId: number;
  quizTitleSnapshot: string;
  mode: RoomMode;
  questionTimeMs: number;
  shuffleQuestions: boolean;
  shuffleChoices: boolean;
  streakBonus: boolean;
  status: GameStatus;
  startedBy: number;
  startedAt: string;
  endedAt: string | null;
  cancelReason: string | null;
  questions: GameQuestion[];
  players: GamePlayer[];
  rounds: PlayerRound[];
}

/** Câu hỏi gửi xuống client khi đang chơi: không có đáp án đúng. */
export interface QuestionView {
  roundId: string;
  index: number; // 0-based thứ tự câu của người này
  total: number;
  type: QuestionType;
  content: string;
  imageUrl: string | null;
  points: number;
  timeLimitMs: number;
  choices: { id: number; content: string }[];
  startedAt: number;
  deadlineAt: number;
}

export interface LeaderboardEntry {
  userId: number;
  displayName: string;
  totalScore: number;
  answeredCount: number;
  correctCount: number;
  status: PlayerStatus;
  rank: number;
}

export interface GameHistoryItem {
  id: string;
  roomCode: string;
  roomTitle: string;
  quizTitle: string;
  mode: RoomMode;
  status: GameStatus;
  startedAt: string;
  endedAt: string | null;
  playerCount: number;
  questionCount: number;
  hostName: string;
  myRank: number | null;
  myScore: number | null;
}

export interface QuestionStat {
  questionId: number;
  position: number;
  content: string;
  type: QuestionType;
  attempts: number;
  correctRate: number; // 0..1
  avgTimeMs: number;
  timeoutCount: number;
}

export interface GlobalLeaderboardEntry {
  userId: number;
  displayName: string;
  gamesPlayed: number;
  wins: number;
  totalScore: number;
  correctRate: number;
}
