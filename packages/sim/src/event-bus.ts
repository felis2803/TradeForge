import type { EngineEvents } from './types.js';

type EventMap = {
  [K in keyof EngineEvents]: Set<EngineEvents[K]>;
};

export class EngineEventBus {
  private readonly listeners: EventMap = {
    orderAccepted: new Set(),
    orderUpdated: new Set(),
    orderFilled: new Set(),
    orderCanceled: new Set(),
    orderRejected: new Set(),
    tradeSeen: new Set(),
  };

  on<E extends keyof EngineEvents>(event: E, cb: EngineEvents[E]): () => void {
    const set = this.listeners[event];
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  emit<E extends keyof EngineEvents>(
    event: E,
    payload: Parameters<EngineEvents[E]>[0],
  ): void {
    for (const cb of this.listeners[event]) {
      cb(payload);
    }
  }
}
