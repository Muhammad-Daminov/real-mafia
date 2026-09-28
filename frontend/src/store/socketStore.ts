import { create } from 'zustand';

export type SocketStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';

interface SocketState {
  status: SocketStatus;
  lastError: string | null;
  lastEventName: string | null;
}

interface SocketActions {
  setStatus: (status: SocketStatus, lastError?: string | null) => void;
  setLastEvent: (eventName: string) => void;
  reset: () => void;
}

const initialState: SocketState = {
  status: 'idle',
  lastError: null,
  lastEventName: null,
};

export const useSocketStore = create<SocketState & SocketActions>((set) => ({
  ...initialState,

  setStatus: (status, lastError = null) => set({ status, lastError }),
  setLastEvent: (eventName) => set({ lastEventName: eventName }),
  reset: () => set(initialState),
}));
