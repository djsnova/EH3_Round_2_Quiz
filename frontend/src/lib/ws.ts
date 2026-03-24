type EventHandler = (data: unknown) => void;

export class GameWebSocket {
  private ws: WebSocket | null = null;
  private sessionId: string;
  private playerId: string;
  private token: string;
  private handlers: Map<string, EventHandler[]> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 10000;
  private intentionalClose = false;

  constructor(sessionId: string, playerId: string, token: string) {
    this.sessionId = sessionId;
    this.playerId = playerId;
    this.token = token;
  }

  connect() {
    this.intentionalClose = false;
    const wsBase = import.meta.env.VITE_WS_BASE_URL || `ws://${window.location.host}`;
    const url = `${wsBase}/ws/${this.sessionId}/${this.playerId}?token=${this.token}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this.dispatch(msg.type, msg.data);
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  on(eventType: string, handler: EventHandler) {
    const existing = this.handlers.get(eventType) || [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  off(eventType: string, handler: EventHandler) {
    const existing = this.handlers.get(eventType) || [];
    this.handlers.set(
      eventType,
      existing.filter((h) => h !== handler)
    );
  }

  private dispatch(type: string, data: unknown) {
    const handlers = this.handlers.get(type) || [];
    for (const handler of handlers) {
      try {
        handler(data);
      } catch {
        // handler error
      }
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
