export type OrderIntentSide = 'BUY' | 'SELL';

export interface OrderIntent {
  side: OrderIntentSide;
  price: string;
  qty: string;
}

export interface ExistingOrderView extends OrderIntent {
  id: string;
}

export type IntentAction =
  | { kind: 'place'; intent: OrderIntent }
  | { kind: 'cancel'; orderId: string }
  | { kind: 'replace'; orderId: string; intent: OrderIntent };

export interface ReconcileParams {
  want?: OrderIntent;
  existing?: ExistingOrderView;
  lastActionSimTs?: number;
  now: number;
  minActionGapMs: number;
  replaceAsCancelPlace?: boolean;
  verbose?: boolean;
}

export interface ReconcileResult {
  actions: IntentAction[];
  nextActionTs?: number;
}

function sameIntent(a?: OrderIntent, b?: OrderIntent): boolean {
  if (!a || !b) {
    return false;
  }
  return a.side === b.side && a.price === b.price && a.qty === b.qty;
}

export function reconcile(params: ReconcileParams): ReconcileResult {
  const {
    want,
    existing,
    now,
    lastActionSimTs,
    minActionGapMs,
    replaceAsCancelPlace,
    verbose = false,
  } = params;
  const gap = Math.max(0, minActionGapMs);
  if (lastActionSimTs !== undefined && now - lastActionSimTs < gap) {
    if (verbose) {
      const delta = now - lastActionSimTs;
      console.log(`[intent] debounced: ΔsimMs=${delta} < ${gap}`);
    }
    return { actions: [] };
  }
  if (!want && !existing) {
    return { actions: [] };
  }
  if (!want && existing) {
    return {
      actions: [{ kind: 'cancel', orderId: existing.id }],
      nextActionTs: now,
    };
  }
  if (want && !existing) {
    return {
      actions: [{ kind: 'place', intent: want }],
      nextActionTs: now,
    };
  }
  if (!existing || !want) {
    return { actions: [] };
  }
  if (sameIntent(want, existing)) {
    return { actions: [] };
  }
  if (want.side !== existing.side) {
    return {
      actions: [
        { kind: 'cancel', orderId: existing.id },
        { kind: 'place', intent: want },
      ],
      nextActionTs: now,
    };
  }
  if (replaceAsCancelPlace) {
    return {
      actions: [
        { kind: 'cancel', orderId: existing.id },
        { kind: 'place', intent: want },
      ],
      nextActionTs: now,
    };
  }
  return {
    actions: [{ kind: 'replace', orderId: existing.id, intent: want }],
    nextActionTs: now,
  };
}
