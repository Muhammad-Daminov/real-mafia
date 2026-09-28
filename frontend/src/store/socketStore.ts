import { create } from 'zustand';
import { pushEventLogEntry, type SocketEventLogEntry } from '../socket/eventLog';

export type SocketStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';

interface SocketState {
  status: SocketStatus;
  lastError: string | null;
  /** Newest first, capped — see socket/eventLog.ts's `pushEventLogEntry`. */
  eventLog: SocketEventLogEntry[];
}

interface SocketActions {
  setStatus: (status: SocketStatus, lastError?: string | null) => void;
  pushEvent: (name: string, payload: unknown) => void;
  reset: () => void;
}

const initialState: SocketState = {
  status: 'idle',
  lastError: null,
  eventLog: [],
};

export const useSocketStore = create<SocketState & SocketActions>((set, get) => ({
  ...initialState,

  setStatus: (status, lastError = null) => set({ status, lastError }),
  pushEvent: (name, payload) =>
    set({ eventLog: pushEventLogEntry(get().eventLog, { name, payload, receivedAt: Date.now() }) }),
  reset: () => set(initialState),
}));
