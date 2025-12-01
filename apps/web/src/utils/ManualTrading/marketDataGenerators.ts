import type {
  TradeRow,
  TickerSnapshot,
  OrderBookSnapshot,
  ChartPoint,
  DataMode,
} from '@/types/ManualTrading';
import { formatTime, getProfile } from './orderBookUtils';

/**
 * Build a trade row object
 */
export function buildTradeRow({
  timestamp,
  side,
  price,
  size,
}: {
  timestamp: number;
  side: TradeRow['side'];
  price: number;
  size: number;
}): TradeRow {
  return {
    time: formatTime(new Date(timestamp)),
    timestamp,
    side,
    price,
    size,
  };
}

/**
 * Sort trades by timestamp descending
 */
export function sortTrades(trades: TradeRow[]): TradeRow[] {
  return [...trades].sort((left, right) => right.timestamp - left.timestamp);
}

/**
 * Create initial ticker snapshot for an instrument
 */
export function seedTrades(symbol: string): TradeRow[] {
  const profile = getProfile(symbol);
  const now = Date.now();
  const trades = Array.from({ length: 5 }).map((_, index) => {
    const side = index % 2 === 0 ? 'buy' : 'sell';
    const price =
      profile.basePrice +
      (index - 2) * profile.volatility * (side === 'buy' ? 1.5 : -1.2);
    const timestamp = now - index * 2100;
    return buildTradeRow({
      timestamp,
      side: side as TradeRow['side'],
      price: Math.max(1, Number(price.toFixed(3))),
      size: Number((Math.random() * 0.8 + 0.05).toFixed(3)),
    });
  });

  return sortTrades(trades);
}

/**
 * Generate initial orderbook for an instrument
 */
export function seedOrderBook(symbol: string): OrderBookSnapshot {
  const { basePrice, volatility } = getProfile(symbol);
  const spread = Math.max(1, volatility * 0.8);
  const bids = [4, 3, 2, 1].map((level) => ({
    price: Number((basePrice - level * spread).toFixed(3)),
    size: Number((Math.random() * 1.5 + 0.2).toFixed(3)),
  }));
  const asks = [1, 2, 3, 4].map((level) => ({
    price: Number((basePrice + level * spread).toFixed(3)),
    size: Number((Math.random() * 1.5 + 0.2).toFixed(3)),
  }));
  return { bids, asks };
}

/**
 * Generate initial chart data for an instrument
 */
export function seedChart(symbol: string): ChartPoint[] {
  const { basePrice, volatility } = getProfile(symbol);
  const base = basePrice * 0.98;
  return Array.from({ length: 5 }).map((_, idx) => ({
    price: Math.round(
      base + idx * volatility * 4 + (Math.random() - 0.5) * volatility * 8,
    ),
    label: `${11 + Math.floor(idx / 2)}:${(58 + (idx % 2) * 2).toString().padStart(2, '0')}`,
  }));
}

/**
 * Update ticker snapshot with simulated market movement
 */
export function mutateTicker(
  previous: TickerSnapshot | null,
  symbol: string,
  dataMode: DataMode,
): TickerSnapshot {
  const profile = getProfile(symbol);
  const driftMultiplier = dataMode === 'realtime' ? 1.2 : 2.1;
  const randomDrift =
    (Math.random() - 0.5) * profile.volatility * driftMultiplier;
  const nextLast = Math.max(
    profile.basePrice * 0.35,
    (previous?.last ?? profile.basePrice) + randomDrift,
  );
  const baseVolume = previous?.volume ?? profile.baseVolume;
  const volumeStep = baseVolume * (0.01 + Math.random() * 0.03);
  const high = previous ? Math.max(previous.high, nextLast) : nextLast;
  const low = previous ? Math.min(previous.low, nextLast) : nextLast;

  return {
    last: Number(nextLast.toFixed(3)),
    change: Number(
      (((nextLast - profile.basePrice) / profile.basePrice) * 100).toFixed(2),
    ),
    volume: Number((baseVolume + volumeStep).toFixed(1)),
    high: Number(high.toFixed(3)),
    low: Number(low.toFixed(3)),
  };
}

/**
 * Add new simulated trade to the trades stream
 */
export function mutateTrades(
  previous: TradeRow[],
  symbol: string,
  dataMode: DataMode,
  priceHint?: number,
): TradeRow[] {
  const profile = getProfile(symbol);
  const referencePrice = priceHint ?? previous[0]?.price ?? profile.basePrice;
  const volatilityKick =
    (Math.random() - 0.5) *
    profile.volatility *
    (dataMode === 'realtime' ? 2.4 : 3.8);
  const price = Math.max(1, referencePrice + volatilityKick);
  const side = Math.random() > 0.45 ? 'buy' : 'sell';
  const size = Number(
    (Math.random() * (dataMode === 'realtime' ? 1.5 : 1.1) + 0.05).toFixed(3),
  );
  const timestamp = Date.now();

  const nextTrade = buildTradeRow({
    timestamp,
    side,
    price: Number(price.toFixed(3)),
    size,
  });

  return sortTrades([nextTrade, ...previous]).slice(0, 12);
}

/**
 * Update orderbook with simulated market movement
 */
export function mutateOrderBook(
  previous: OrderBookSnapshot,
  symbol: string,
  midPriceHint?: number,
): OrderBookSnapshot {
  const profile = getProfile(symbol);
  const midPrice = midPriceHint ?? previous.bids[0]?.price ?? profile.basePrice;
  const spread = Math.max(1, profile.volatility * 0.7);

  const bids = (
    previous.bids.length ? previous.bids : seedOrderBook(symbol).bids
  ).map((row, idx) => {
    const delta = Math.random() * spread;
    return {
      price: Number((midPrice - (idx + 1) * spread - delta).toFixed(3)),
      size: Number((row.size * (0.8 + Math.random() * 0.5)).toFixed(3)),
    };
  });

  const asks = (
    previous.asks.length ? previous.asks : seedOrderBook(symbol).asks
  ).map((row, idx) => {
    const delta = Math.random() * spread;
    return {
      price: Number((midPrice + (idx + 1) * spread + delta).toFixed(3)),
      size: Number((row.size * (0.8 + Math.random() * 0.5)).toFixed(3)),
    };
  });

  return { bids, asks };
}

/**
 * Update chart with new price point
 */
export function mutateChart(
  previous: ChartPoint[],
  symbol: string,
  priceHint?: number,
): ChartPoint[] {
  const fallback = previous.length ? previous : seedChart(symbol);
  const nextPrice = Math.round(
    priceHint ??
      fallback[fallback.length - 1]?.price ??
      getProfile(symbol).basePrice,
  );
  const nextPoint: ChartPoint = {
    price: nextPrice,
    label: formatTime(new Date()),
  };
  return [...fallback.slice(-7), nextPoint];
}
