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
    const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
    
    // Build URL from env or use same origin as page
    let wsUrl: URL;
    if (envUrl) {
      // Handle absolute URLs with scheme normalization
      if (envUrl.startsWith('http://') || envUrl.startsWith('https://') || 
          envUrl.startsWith('ws://') || envUrl.startsWith('wss://')) {
        const normalized = envUrl
          .replace(/^http:\/\//, 'ws://')
          .replace(/^https:\/\//, 'wss://');
        wsUrl = new URL(normalized);
      } else {
        // Relative path like "/ws" - use same origin
        wsUrl = new URL(envUrl, window.location.origin);
      }
    } else {
      wsUrl = new URL('/ws', window.location.origin);
    }
    
    // Ensure WebSocket protocol
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    
    // Ensure path is set
    if (!wsUrl.pathname || wsUrl.pathname === '/') {
      wsUrl.pathname = '/ws';
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
    console.log('[WebSocket] Connecting to:', url);
    this.ws = new WebSocket(url);
    let opened = false;

    this.ws.onopen = () => {
      console.log('[WebSocket] Connection opened to:', url);
      // Send handshake without token - auth is done via cookies on the upgrade request
      this.ws?.send(JSON.stringify({ type: 'client_handshake' }));
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
    console.log('[WebSocketManager] sendCommand', { serverId, command, wsState: this.ws?.readyState });
    this.send({ type: 'console_input', serverId, data: command });
  }

  private send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify(data);
      console.log('[WebSocketManager] Sending:', payload);
      this.ws.send(payload);
    } else {
      console.warn('[WebSocketManager] Cannot send - WebSocket not open', { readyState: this.ws?.readyState });
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
