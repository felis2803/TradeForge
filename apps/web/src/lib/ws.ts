export interface WsEnvelope<T = unknown> {
  type: string;
  ts: number;
  payload: T;
  reqId?: string;
}

export type WsHandler<T = unknown> = (message: WsEnvelope<T>) => void;
export type VoidHandler = () => void;

export interface WsClientOptions {
  heartbeatInterval?: number;
  reconnectDelay?: number;
  logger?: (event: string, details?: unknown) => void;
}

const DEFAULT_OPTIONS: Required<Omit<WsClientOptions, 'logger'>> = {
  heartbeatInterval: 5000,
  reconnectDelay: 2000,
};

export class WsClient {
  private url: string;
  private options: Required<Omit<WsClientOptions, 'logger'>>;
  private logger?: WsClientOptions['logger'];
  private socket: WebSocket | null = null;
  private listeners: Map<string, Set<WsHandler | VoidHandler>> = new Map();
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private manualClose = false;

  constructor(url: string, options: WsClientOptions = {}) {
    this.url = url;
    this.options = {
      heartbeatInterval:
        options.heartbeatInterval ?? DEFAULT_OPTIONS.heartbeatInterval,
      reconnectDelay: options.reconnectDelay ?? DEFAULT_OPTIONS.reconnectDelay,
    };
    this.logger = options.logger;
  }

  connect(): void {
    this.manualClose = false;
    this.clearReconnect();
    this.open();
  }

  disconnect(): void {
    this.manualClose = true;
    this.clearHeartbeat();
    this.clearReconnect();
    this.socket?.close();
    this.socket = null;
  }

  send(type: string, payload: unknown, extra?: { reqId?: string }): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const envelope: WsEnvelope = {
      type,
      ts: Date.now(),
      payload,
      ...(extra ?? {}),
    };
    this.socket.send(JSON.stringify(envelope));
  }

  on(event: string, handler: WsHandler | VoidHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    set.add(handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: WsHandler | VoidHandler): void {
    const set = this.listeners.get(event);
    if (!set) {
      return;
    }
    set.delete(handler);
    if (set.size === 0) {
      this.listeners.delete(event);
    }
  }

  private open(): void {
    this.logger?.('connect.attempt', { url: this.url });
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.logger?.('open');
      this.emit('open');
      this.startHeartbeat();
    });

    socket.addEventListener('close', () => {
      this.logger?.('close');
      this.emit('close');
      this.clearHeartbeat();
      this.socket = null;
      if (!this.manualClose) {
        this.scheduleReconnect();
      }
    });

    socket.addEventListener('error', (event) => {
      this.logger?.('error', event);
      this.emit('error');
    });

    socket.addEventListener('message', (event) => {
      try {
        const data: WsEnvelope = JSON.parse(event.data as string);
        this.emit('message', data);
        if (data?.type) {
          this.emit(data.type, data);
        }
      } catch (error) {
        this.logger?.('parse.error', error);
      }
    });
  }

  private emit(event: string, payload?: WsEnvelope): void {
    const set = this.listeners.get(event);
    if (!set) {
      return;
    }
    set.forEach((handler) => {
      try {
        if (payload) {
          (handler as WsHandler)(payload);
        } else {
          (handler as VoidHandler)();
        }
      } catch (error) {
        this.logger?.('listener.error', { event, error });
      }
    });
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      this.send('heartbeat', { ts: Date.now() });
    }, this.options.heartbeatInterval);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manualClose) {
        this.open();
      }
    }, this.options.reconnectDelay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
