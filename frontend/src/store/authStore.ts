import { create } from 'zustand';
import { ApiError, authenticateWithTelegram, setToken } from '../api/client';
import { getRawInitData, NotInTelegramError } from '../telegram/initData';
import type { TelegramUser } from '../api/types';

export type AuthStatus = 'idle' | 'authenticating' | 'authenticated' | 'not_in_telegram' | 'error';

interface AuthState {
  status: AuthStatus;
  user: TelegramUser | null;
  error: string | null;
  /**
   * Runs the full Telegram login flow and updates the store. Also used as
   * the re-auth attempt on socket `connect_error` (see socketClient.ts) —
   * returns the fresh token on success so the caller can retry the socket
   * connect without waiting on a state subscription.
   */
  authenticate: () => Promise<string | null>;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'idle',
  user: null,
  error: null,

  authenticate: async () => {
    set({ status: 'authenticating', error: null });

    let initData: string;
    try {
      initData = getRawInitData();
    } catch (error) {
      if (error instanceof NotInTelegramError) {
        set({ status: 'not_in_telegram', error: error.message });
        return null;
      }
      set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      return null;
    }

    try {
      const response = await authenticateWithTelegram(initData);
      setToken(response.accessToken);
      set({ status: 'authenticated', user: response.user, error: null });
      return response.accessToken;
    } catch (error) {
      setToken(null);
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      set({ status: 'error', user: null, error: message });
      return null;
    }
  },
}));
