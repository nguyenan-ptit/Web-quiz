import { authApi as mockAuth, ApiError, getToken } from '../mock/api';
import type { User } from '../types';
import { mockEnabled } from './runtime';

export { getToken };
export type Identity = { userId: number; displayName: string; isGuest: boolean };

// The room backend returns identity only; keep the shared UI User contract.
export function toUser(identity: Identity): User {
  return {
    id: identity.userId, displayName: identity.displayName, isGuest: identity.isGuest,
    username: null, email: null, role: 'USER', status: 'ACTIVE', createdAt: '',
  };
}

async function request(path: string, body?: object) {
  const token = getToken();
  const response = await fetch('/api/auth/' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(result.code || 'SERVER_ERROR', result.message || 'Không thể kết nối dịch vụ đăng nhập.');
  return result;
}

async function identify(path: string, body: object): Promise<{ token: string; user: User }> {
  const result = await request(path, body);
  localStorage.setItem('quiz.token', result.token);
  return { token: result.token, user: toUser(result.user) };
}

export const authApi: typeof mockAuth = mockEnabled ? mockAuth : {
  login: (input) => identify('login', input),
  guest: (input) => identify('guest', input),
  register: (input) => identify('register', input),
  me: async () => toUser(await request('me')),
  logout: async () => { localStorage.removeItem('quiz.token'); return true; },
};
