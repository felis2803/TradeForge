import type {
  Balances,
  ExecutionReport,
  PriceInt,
  QtyInt,
} from '@tradeforge/core';

export interface MetricsFinalizeParams {
  balances: Record<string, Balances>;
  baseCurrency: string;
  quoteCurrency: string;
  priceScale: number;
  qtyScale: number;
  lastPrice?: PriceInt;
  initialQuote: bigint;
}

export interface MetricsSummary {
  fills: number;
  fees: { maker: string; taker: string; total: string };
  ordersPlaced: number;
  cancels: number;
  finalBalances: Record<string, { free: string; locked: string }>;
  pnl: string;
}

interface FeeTotals {
  maker: bigint;
  taker: bigint;
}

function toRaw(value: PriceInt | QtyInt | undefined): bigint | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value as unknown as bigint;
}

function formatScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  if (scale <= 0) {
    return `${negative ? '-' : ''}${abs.toString(10)}`;
  }
  const padded = abs.toString(10).padStart(scale + 1, '0');
  const intPart = padded.slice(0, -scale) || '0';
  const fracPart = padded.slice(-scale).replace(/0+$/, '');
  const body = fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
  return negative ? `-${body}` : body;
}

function formatBalance(
  balance: Balances,
  scale: number,
): {
  free: string;
  locked: string;
} {
  const freeStr = formatScaled(balance.free, scale);
  const lockedStr = formatScaled(balance.locked, scale);
  return { free: freeStr, locked: lockedStr };
}

function ensureBalance(
  balances: Record<string, Balances>,
  currency: string,
): Balances {
  const entry = balances[currency];
  if (!entry) {
    return { free: 0n, locked: 0n } satisfies Balances;
  }
  return entry;
}

export function createMetrics() {
  const fees: FeeTotals = { maker: 0n, taker: 0n };
  const perOrderFees = new Map<string, FeeTotals>();
  let fills = 0;
  let ordersPlaced = 0;
  let cancels = 0;

  function onPlace(): void {
    ordersPlaced += 1;
  }

  function onCancel(): void {
    cancels += 1;
  }

  function onFill(report: ExecutionReport): void {
    if (report.kind !== 'FILL') {
      return;
    }
    fills += 1;
    if (!report.orderId || !report.patch?.fees) {
      return;
    }
    const key = String(report.orderId);
    const prev = perOrderFees.get(key) ?? { maker: 0n, taker: 0n };
    const maker = report.patch.fees.maker ?? 0n;
    const taker = report.patch.fees.taker ?? 0n;
    const deltaMaker = maker - prev.maker;
    const deltaTaker = taker - prev.taker;
    if (deltaMaker !== 0n) {
      fees.maker += deltaMaker;
    }
    if (deltaTaker !== 0n) {
      fees.taker += deltaTaker;
    }
    perOrderFees.set(key, { maker, taker });
  }

  function finalize(params: MetricsFinalizeParams): MetricsSummary {
    const baseBalance = ensureBalance(params.balances, params.baseCurrency);
    const quoteBalance = ensureBalance(params.balances, params.quoteCurrency);
    const baseTotal = baseBalance.free + baseBalance.locked;
    const quoteTotal = quoteBalance.free + quoteBalance.locked;
    const lastPriceRaw = toRaw(params.lastPrice) ?? 0n;
    const denom = 10n ** BigInt(params.qtyScale);
    const baseValue =
      lastPriceRaw > 0n && baseTotal > 0n
        ? (lastPriceRaw * baseTotal) / denom
        : 0n;
    const finalQuote = quoteTotal;
    const pnlRaw = baseValue + finalQuote - params.initialQuote;

    const finalBalances: MetricsSummary['finalBalances'] = {
      [params.baseCurrency]: formatBalance(baseBalance, params.qtyScale),
      [params.quoteCurrency]: formatBalance(quoteBalance, params.priceScale),
    };

    const totalFees = fees.maker + fees.taker;

    return {
      fills,
      fees: {
        maker: formatScaled(fees.maker, params.priceScale),
        taker: formatScaled(fees.taker, params.priceScale),
        total: formatScaled(totalFees, params.priceScale),
      },
      ordersPlaced,
      cancels,
      finalBalances,
      pnl: formatScaled(pnlRaw, params.priceScale),
    };
  }

  return { onPlace, onCancel, onFill, finalize };
}
