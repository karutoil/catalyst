import { create } from 'zustand';
import { WebSocketManager } from '../services/websocket/WebSocketManager';
import type { WebSocketMessage } from '../services/websocket/types';

type MessageHandler = (message: WebSocketMessage) => void;

interface WebSocketState {
  isConnected: boolean;
  subscriptions: Set<string>;
  messageHandlers: Set<MessageHandler>;
  connect: () => void;
  subscribe: (serverId: string) => void;
  unsubscribe: (serverId: string) => void;
  sendCommand: (serverId: string, command: string) => void;
  onMessage: (handler: MessageHandler) => () => void;
}

const manager = new WebSocketManager();

export const useWebSocketStore = create<WebSocketState>((set, get) => ({
  isConnected: false,
  subscriptions: new Set<string>(),
  messageHandlers: new Set<MessageHandler>(),
  connect: () => {
    manager.connect({
      onOpen: () => set({ isConnected: true }),
      onClose: () => set({ isConnected: false }),
      onMessage: (message) => {
        const handlers = get().messageHandlers;
        handlers.forEach((handler) => handler(message));
      },
    });
  },
  subscribe: (serverId) => {
    manager.subscribe(serverId);
    const next = new Set(get().subscriptions);
    next.add(serverId);
    set({ subscriptions: next });
  },
  unsubscribe: (serverId) => {
    manager.unsubscribe(serverId);
    const next = new Set(get().subscriptions);
    next.delete(serverId);
    set({ subscriptions: next });
  },
  sendCommand: (serverId, command) => manager.sendCommand(serverId, command),
  onMessage: (handler) => {
    const handlers = get().messageHandlers;
    handlers.add(handler);
    set({ messageHandlers: handlers });
    return () => {
      handlers.delete(handler);
      set({ messageHandlers: new Set(handlers) });
    };
  },
}));
