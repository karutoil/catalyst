import { useAuthStore } from '../../stores/authStore';
import type { WebSocketMessage } from './types';

type Callbacks = {
  onOpen?: () => void;
  onClose?: () => void;
  onMessage?: (message: WebSocketMessage) => void;
  onError?: (error: Event) => void;
};

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly subscriptions = new Set<string>();
  private candidateUrls: string[] = [];
  private candidateIndex = 0;

  private buildWsUrl() {
    const normalizeScheme = (url: string) => {
      if (url.startsWith('http://')) return `ws://${url.slice('http://'.length)}`;
      if (url.startsWith('https://')) return `wss://${url.slice('https://'.length)}`;
      return url;
    };

    const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
    let wsUrl: URL;

    if (envUrl) {
      wsUrl = new URL(normalizeScheme(envUrl), window.location.origin);
      if (!wsUrl.pathname || wsUrl.pathname === '/') {
        wsUrl.pathname = '/ws';
      }
    } else {
      wsUrl = new URL('/ws', window.location.origin);
      wsUrl.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    }

    if (import.meta.env.DEV) {
      if (wsUrl.hostname === 'localhost' || wsUrl.hostname === '::1') {
        wsUrl.hostname = '127.0.0.1';
      }
    }
    if (wsUrl.hostname === '0.0.0.0') {
      wsUrl.hostname = window.location.hostname || '127.0.0.1';
    }

    return wsUrl.toString();
  }

  connect(callbacks?: Callbacks) {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const url = this.buildWsUrl();
    this.candidateUrls = this.buildCandidateUrls(url);
    this.candidateIndex = 0;
    this.openWithCandidate(callbacks);
  }

  private buildCandidateUrls(primary: string) {
    const urls = new Set<string>([primary]);
    try {
      const parsed = new URL(primary);
      if (parsed.hostname === '127.0.0.1') {
        const alt = new URL(primary);
        alt.hostname = 'localhost';
        urls.add(alt.toString());
      } else if (parsed.hostname === 'localhost') {
        const alt = new URL(primary);
        alt.hostname = '127.0.0.1';
        urls.add(alt.toString());
      }
    } catch {
      // Ignore malformed URLs; fallback to primary only.
    }
    return Array.from(urls);
  }

  private openWithCandidate(callbacks?: Callbacks) {
    const url = this.candidateUrls[this.candidateIndex];
    this.ws = new WebSocket(url);
    let opened = false;

    this.ws.onopen = () => {
      const token = useAuthStore.getState().token;
      console.log('[WebSocket] Connection opened, token available:', !!token);
      if (token) {
        console.log('[WebSocket] Sending client_handshake');
        this.ws?.send(JSON.stringify({ type: 'client_handshake', token }));
      } else {
        console.warn('[WebSocket] No token available for authentication');
      }
      opened = true;
      this.reconnectAttempts = 0;
      callbacks?.onOpen?.();
      this.subscriptions.forEach((serverId) => this.subscribe(serverId));
    };

    this.ws.onclose = () => {
      callbacks?.onClose?.();
      if (!opened && this.candidateIndex < this.candidateUrls.length - 1) {
        this.candidateIndex += 1;
        this.openWithCandidate(callbacks);
        return;
      }
      this.scheduleReconnect(callbacks);
    };

    this.ws.onerror = (error) => {
      callbacks?.onError?.(error);
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as WebSocketMessage;
      callbacks?.onMessage?.(message);
    };
  }

  subscribe(serverId: string) {
    this.subscriptions.add(serverId);
    this.send({ type: 'subscribe', serverId });
  }

  unsubscribe(serverId: string) {
    this.subscriptions.delete(serverId);
    this.send({ type: 'unsubscribe', serverId });
  }

  sendCommand(serverId: string, command: string) {
    this.send({ type: 'console_input', serverId, data: command });
  }

  private send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private scheduleReconnect(callbacks?: Callbacks) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnectAttempts += 1;
    const delay = 1000 * this.reconnectAttempts;
    setTimeout(() => this.connect(callbacks), delay);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  reconnect(callbacks?: Callbacks) {
    console.log('[WebSocketManager] Reconnecting...');
    this.disconnect();
    this.reconnectAttempts = 0;
    this.connect(callbacks);
  }
}
