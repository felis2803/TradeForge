import type {
  OrderStatus,
  OrderType,
  OrderView,
  Side,
  SubmitOrder,
} from './types.js';

export interface InternalOrder {
  id: string;
  clientId?: string;
  type: OrderType;
  side: Side;
  qty: bigint;
  price?: bigint;
  ts: number;
  status: OrderStatus;
  remainingQty: bigint;
  filledQty: bigint;
  awaitingTrade: boolean;
  sequence: number;
  lastUpdateTs: number;
  request: SubmitOrder;
}

export class OrderStore {
  private readonly orders = new Map<string, InternalOrder>();
  private readonly pendingBySide: Record<Side, Set<string>> = {
    BUY: new Set(),
    SELL: new Set(),
  };
  private sequence = 0;

  has(orderId: string): boolean {
    return this.orders.has(orderId);
  }

  get(orderId: string): InternalOrder | undefined {
    return this.orders.get(orderId);
  }

  create(
    orderId: string,
    submit: SubmitOrder,
    acceptedTs: number,
  ): InternalOrder {
    const order: InternalOrder = {
      id: orderId,
      clientId: submit.clientId,
      type: submit.type,
      side: submit.side,
      qty: submit.qty,
      price: submit.price,
      ts: acceptedTs,
      status: 'OPEN',
      remainingQty: submit.qty,
      filledQty: 0n,
      awaitingTrade: submit.type === 'LIMIT',
      sequence: ++this.sequence,
      lastUpdateTs: acceptedTs,
      request: { ...submit },
    };
    this.orders.set(orderId, order);
    if (order.awaitingTrade) {
      this.pendingBySide[order.side].add(orderId);
    }
    return order;
  }

  markAwaiting(order: InternalOrder, waiting: boolean): void {
    order.awaitingTrade = waiting;
    if (waiting) {
      this.pendingBySide[order.side].add(order.id);
    } else {
      this.pendingBySide[order.side].delete(order.id);
    }
  }

  cancel(order: InternalOrder, ts: number): OrderView {
    order.status = 'CANCELED';
    order.remainingQty = 0n;
    order.lastUpdateTs = ts;
    this.pendingBySide[order.side].delete(order.id);
    return this.toView(order);
  }

  reject(orderId: string): void {
    const order = this.orders.get(orderId);
    if (!order) {
      return;
    }
    order.status = 'REJECTED';
    order.remainingQty = 0n;
    this.pendingBySide[order.side].delete(order.id);
  }

  applyFill(order: InternalOrder, fill: { qty: bigint; ts: number }): void {
    order.remainingQty -= fill.qty;
    order.filledQty += fill.qty;
    order.lastUpdateTs = fill.ts;
    if (order.remainingQty <= 0n) {
      order.remainingQty = 0n;
      order.status = 'FILLED';
      this.pendingBySide[order.side].delete(order.id);
    } else {
      order.status = 'PARTIALLY_FILLED';
    }
  }

  getPendingForSide(side: Side): InternalOrder[] {
    const result: InternalOrder[] = [];
    const pending = this.pendingBySide[side];
    for (const id of pending) {
      const order = this.orders.get(id);
      if (!order) {
        pending.delete(id);
        continue;
      }
      if (!this.isActive(order) || !order.awaitingTrade) {
        continue;
      }
      result.push(order);
    }
    result.sort((a, b) => a.sequence - b.sequence);
    return result;
  }

  getActiveOrders(): InternalOrder[] {
    const list: InternalOrder[] = [];
    for (const order of this.orders.values()) {
      if (this.isActive(order)) {
        list.push(order);
      }
    }
    return list;
  }

  toView(order: InternalOrder): OrderView {
    return {
      id: order.id,
      clientId: order.clientId,
      type: order.type,
      side: order.side,
      qty: order.qty,
      price: order.price,
      ts: order.ts,
      status: order.status,
      remainingQty: order.remainingQty,
      filledQty: order.filledQty,
    };
  }

  private isActive(order: InternalOrder): boolean {
    return order.status === 'OPEN' || order.status === 'PARTIALLY_FILLED';
  }
}

export function cloneOrderView(view: OrderView): OrderView {
  return { ...view };
}
