// Giao thức socket (mục "Giao thức socket" trong thiết kế).
// Mọi thông điệp dùng chung vỏ { type, requestId, payload }; server luôn kèm serverTime.

import type {
  ChatMessage,
  LeaderboardEntry,
  LobbyRoom,
  QuestionView,
  Room,
  RoomConfig,
  RoomMode,
  RoundStatus,
  User,
  Visibility,
} from './types';

// ------------------------------------------------------------ client → server
export type ClientMessage =
  | { type: 'AUTH'; payload: { token: string } }
  | { type: 'PING'; payload?: undefined }
  | { type: 'LOBBY_SUBSCRIBE'; payload?: undefined }
  | { type: 'LOBBY_UNSUBSCRIBE'; payload?: undefined }
  | { type: 'CREATE_ROOM'; payload: { title: string; visibility: Visibility; password: string | null } }
  | { type: 'JOIN_ROOM'; payload: { roomCode: string; password?: string } }
  | { type: 'LEAVE_ROOM'; payload?: undefined }
  | { type: 'UPDATE_ROOM_CONFIG'; payload: Partial<RoomConfig> }
  | { type: 'KICK_MEMBER'; payload: { userId: number } }
  | { type: 'TRANSFER_HOST'; payload: { userId: number } }
  | { type: 'SEND_CHAT'; payload: { content: string } }
  | { type: 'START_GAME'; payload?: undefined }
  | { type: 'SUBMIT_ANSWER'; payload: { roundId: string; choiceIds: number[] } }
  | { type: 'RESUME'; payload?: undefined };

export type ClientEnvelope = ClientMessage & { requestId: string };

// ------------------------------------------------------------ server → client
export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_NOT_WAITING'
  | 'ROOM_FULL'
  | 'WRONG_PASSWORD'
  | 'NAME_TAKEN'
  | 'KICKED'
  | 'INVALID_QUIZ_SET'
  | 'ROUND_NOT_ACTIVE'
  | 'INVALID_CHOICE'
  | 'RATE_LIMITED'
  | 'BAD_REQUEST';

export interface RoomStatePayload {
  room: Room;
  quizTitle: string | null;
  quizQuestionCount: number;
  messages: ChatMessage[];
}

export interface QuestionResultPayload {
  gameQuestionId: number;
  roundId: string | null;
  correctChoiceIds: number[];
  explanation: string | null;
  counts: Record<number, number>; // game_choice_id → số người chọn
  answeredCount: number;
  playerCount: number;
  yourResult: RoundStatus | null;
  yourScore: number;
  yourBonus: number;
  nextAt: number | null; // null nếu là câu cuối
}

export type ServerMessage =
  | { type: 'AUTH_OK'; payload: { user: User; roomCode: string | null; gameId: string | null } }
  | { type: 'PONG'; payload: { serverTime: number } }
  | { type: 'LOBBY_ROOMS'; payload: { rooms: LobbyRoom[] } }
  | { type: 'ROOM_STATE'; payload: RoomStatePayload }
  | { type: 'ROOM_UPDATED'; payload: Omit<RoomStatePayload, 'messages'> }
  | { type: 'MEMBER_KICKED'; payload: { roomCode: string; reason: string } }
  | { type: 'CHAT_MESSAGE'; payload: { message: ChatMessage } }
  | { type: 'GAME_STARTED'; payload: { gameId: string; mode: RoomMode; questionCount: number; startsAt: number; quizTitle: string } }
  | { type: 'QUESTION_STARTED'; payload: { question: QuestionView } }
  | {
      type: 'ANSWER_RECORDED';
      payload: { roundId: string; result: 'CORRECT' | 'WRONG'; score: number; bonus: number; totalScore: number; streak: number };
    }
  | { type: 'QUESTION_TIMED_OUT'; payload: { roundId: string; score: 0; totalScore: number } }
  | { type: 'QUESTION_RESULT'; payload: QuestionResultPayload }
  | { type: 'LEADERBOARD_UPDATED'; payload: { entries: LeaderboardEntry[] } }
  | {
      type: 'PLAYER_CONNECTION_CHANGED';
      payload: { userId: number; displayName: string; status: 'DISCONNECTED' | 'RECONNECTED' | 'LEFT' };
    }
  | { type: 'PLAYER_FINISHED'; payload: { totalScore: number; correctCount: number; questionCount: number } }
  | {
      type: 'GAME_STATE';
      payload: {
        gameId: string;
        mode: RoomMode;
        quizTitle: string;
        questionCount: number;
        question: QuestionView | null;
        totalScore: number;
        finished: boolean;
        leaderboard: LeaderboardEntry[];
      };
    }
  | { type: 'GAME_FINISHED'; payload: { gameId: string; standings: LeaderboardEntry[] } }
  | { type: 'SESSION_REPLACED'; payload: Record<string, never> }
  | { type: 'ERROR'; payload: { code: ErrorCode; message: string } };

export type ServerEnvelope = ServerMessage & { requestId?: string; serverTime: number };
