import { FormEvent, useEffect, useMemo, useState } from 'react';

const exchanges = ['Binance', 'Bybit', 'OKX', 'Bitget'];
const instruments = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT'];
const playbackSpeeds = ['0.25x', '0.5x', '1x', '2x', '4x'] as const;

const playbackSpeedMultiplier: Record<(typeof playbackSpeeds)[number], number> = {
  '0.25x': 0.25,
  '0.5x': 0.5,
  '1x': 1,
  '2x': 2,
  '4x': 4,
};

const instrumentProfiles: Record<string, { basePrice: number; volatility: number; baseVolume: number }> = {
  'BTC/USDT': { basePrice: 65100, volatility: 26, baseVolume: 1250 },
  'ETH/USDT': { basePrice: 2860, volatility: 9, baseVolume: 820 },
  'SOL/USDT': { basePrice: 158, volatility: 2.1, baseVolume: 640 },
  'XRP/USDT': { basePrice: 0.52, volatility: 0.006, baseVolume: 420 },
};

interface Order {
  id: string;
  type: string;
  instrument: string;
  size: number;
  price?: number;
  status: 'active' | 'filled' | 'cancelled';
}

interface Position {
  instrument: string;
  size: number;
  avgPrice: number;
  liqPrice: number;
}

interface TradeRow {
  time: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
}

interface DepthRow {
  price: number;
  size: number;
}

interface OrderBookSnapshot {
  bids: DepthRow[];
  asks: DepthRow[];
}

interface ChartPoint {
  price: number;
  label: string;
}

interface TickerSnapshot {
  last: number;
  change: number;
  volume: number;
  high: number;
  low: number;
}

function getProfile(symbol: string) {
  return instrumentProfiles[symbol] ?? instrumentProfiles[instruments[0]];
}

function formatTime(date: Date) {
  return date.toLocaleTimeString('ru-RU', { hour12: false });
}

function createTickerSnapshot(symbol: string): TickerSnapshot {
  const { basePrice, baseVolume } = getProfile(symbol);
  return {
    last: basePrice,
    change: 0,
    volume: baseVolume,
    high: basePrice * 1.001,
    low: basePrice * 0.999,
  };
}

function seedTrades(symbol: string): TradeRow[] {
  const profile = getProfile(symbol);
  const now = Date.now();
  return Array.from({ length: 5 }).map((_, index) => {
    const side = index % 2 === 0 ? 'buy' : 'sell';
    const price =
      profile.basePrice + (index - 2) * profile.volatility * (side === 'buy' ? 1.5 : -1.2);
    return {
      time: formatTime(new Date(now - index * 2100)),
      side: side as TradeRow['side'],
      price: Math.max(1, Number(price.toFixed(3))),
      size: Number((Math.random() * 0.8 + 0.05).toFixed(3)),
    };
  });
}

function seedOrderBook(symbol: string): OrderBookSnapshot {
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

function seedChart(symbol: string): ChartPoint[] {
  const { basePrice, volatility } = getProfile(symbol);
  const base = basePrice * 0.98;
  return Array.from({ length: 5 }).map((_, idx) => ({
    price: Math.round(base + idx * volatility * 4 + (Math.random() - 0.5) * volatility * 8),
    label: `${11 + Math.floor(idx / 2)}:${(58 + (idx % 2) * 2).toString().padStart(2, '0')}`,
  }));
}

function mutateTicker(
  previous: TickerSnapshot | null,
  symbol: string,
  dataMode: 'history' | 'realtime',
): TickerSnapshot {
  const profile = getProfile(symbol);
  const driftMultiplier = dataMode === 'realtime' ? 1.2 : 2.1;
  const randomDrift = (Math.random() - 0.5) * profile.volatility * driftMultiplier;
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
    change: Number((((nextLast - profile.basePrice) / profile.basePrice) * 100).toFixed(2)),
    volume: Number((baseVolume + volumeStep).toFixed(1)),
    high: Number(high.toFixed(3)),
    low: Number(low.toFixed(3)),
  };
}

function mutateTrades(
  previous: TradeRow[],
  symbol: string,
  dataMode: 'history' | 'realtime',
  priceHint?: number,
): TradeRow[] {
  const profile = getProfile(symbol);
  const referencePrice = priceHint ?? previous[0]?.price ?? profile.basePrice;
  const volatilityKick = (Math.random() - 0.5) * profile.volatility * (dataMode === 'realtime' ? 2.4 : 3.8);
  const price = Math.max(1, referencePrice + volatilityKick);
  const side = Math.random() > 0.45 ? 'buy' : 'sell';
  const size = Number((Math.random() * (dataMode === 'realtime' ? 1.5 : 1.1) + 0.05).toFixed(3));

  const nextTrade: TradeRow = {
    time: formatTime(new Date()),
    side,
    price: Number(price.toFixed(3)),
    size,
  };

  return [nextTrade, ...previous].slice(0, 12);
}

function mutateOrderBook(
  previous: OrderBookSnapshot,
  symbol: string,
  midPriceHint?: number,
): OrderBookSnapshot {
  const profile = getProfile(symbol);
  const midPrice = midPriceHint ?? (previous.bids[0]?.price ?? profile.basePrice);
  const spread = Math.max(1, profile.volatility * 0.7);

  const bids = (previous.bids.length ? previous.bids : seedOrderBook(symbol).bids).map((row, idx) => {
    const delta = Math.random() * spread;
    return {
      price: Number((midPrice - (idx + 1) * spread - delta).toFixed(3)),
      size: Number((row.size * (0.8 + Math.random() * 0.5)).toFixed(3)),
    };
  });

  const asks = (previous.asks.length ? previous.asks : seedOrderBook(symbol).asks).map((row, idx) => {
    const delta = Math.random() * spread;
    return {
      price: Number((midPrice + (idx + 1) * spread + delta).toFixed(3)),
      size: Number((row.size * (0.8 + Math.random() * 0.5)).toFixed(3)),
    };
  });

  return { bids, asks };
}

function mutateChart(previous: ChartPoint[], symbol: string, priceHint?: number): ChartPoint[] {
  const fallback = previous.length ? previous : seedChart(symbol);
  const nextPrice = Math.round(priceHint ?? fallback[fallback.length - 1]?.price ?? getProfile(symbol).basePrice);
  const nextPoint: ChartPoint = { price: nextPrice, label: formatTime(new Date()) };
  return [...fallback.slice(-7), nextPoint];
}

function getPeriodHours(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diff = endDate.getTime() - startDate.getTime();
  return Number.isFinite(diff) ? Math.max(1, diff / 3_600_000) : 24;
}

function computeUpdateInterval(
  dataMode: 'history' | 'realtime',
  playbackSpeed: (typeof playbackSpeeds)[number],
  periodStart: string,
  periodEnd: string,
) {
  const speed = playbackSpeedMultiplier[playbackSpeed] ?? 1;
  const base = dataMode === 'realtime' ? 1200 : 1800;

  if (dataMode === 'history') {
    const periodHours = getPeriodHours(periodStart, periodEnd);
    const periodFactor = Math.min(4, Math.max(0.5, periodHours / 24));
    return Math.max(350, Math.round((base * periodFactor) / speed));
  }

  return Math.max(450, Math.round(base / speed));
}

export default function ManualTrading(): JSX.Element {
  const [selectedExchange, setSelectedExchange] = useState(exchanges[0]);
  const [dataMode, setDataMode] = useState<'history' | 'realtime'>('history');
  const [periodStart, setPeriodStart] = useState('2024-05-01T09:00');
  const [periodEnd, setPeriodEnd] = useState('2024-05-15T18:00');
  const [playbackSpeed, setPlaybackSpeed] = useState<(typeof playbackSpeeds)[number]>(playbackSpeeds[2]);
  const [balance, setBalance] = useState(10000);
  const [selectedInstrument, setSelectedInstrument] = useState(instruments[0]);
  const [orderType, setOrderType] = useState('limit');
  const [orderSize, setOrderSize] = useState(0.1);
  const [orderPrice, setOrderPrice] = useState(65000);
  const [orders, setOrders] = useState<Order[]>([
    {
      id: 'ord-1',
      type: 'Limit',
      instrument: 'BTC/USDT',
      size: 0.25,
      price: 64850,
      status: 'active',
    },
    {
      id: 'ord-2',
      type: 'Stop',
      instrument: 'ETH/USDT',
      size: 5,
      price: 2850,
      status: 'filled',
    },
  ]);
  const [positions, setPositions] = useState<Position[]>([
    { instrument: 'BTC/USDT', size: 0.5, avgPrice: 64600, liqPrice: 52000 },
    { instrument: 'SOL/USDT', size: 120, avgPrice: 158, liqPrice: 96 },
  ]);
  const [connectionMessage, setConnectionMessage] = useState<string>('');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [ticker, setTicker] = useState<TickerSnapshot>(() => createTickerSnapshot(instruments[0]));
  const [trades, setTrades] = useState<TradeRow[]>(() => seedTrades(instruments[0]));
  const [orderBook, setOrderBook] = useState<OrderBookSnapshot>(() => seedOrderBook(instruments[0]));
  const [syntheticChart, setSyntheticChart] = useState<ChartPoint[]>(() => seedChart(instruments[0]));
  const [dataUnavailable, setDataUnavailable] = useState(false);
  const [lastUpdateAt, setLastUpdateAt] = useState<Date | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('manual-trading:connection');
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved) as {
        selectedExchange?: string;
        dataMode?: 'history' | 'realtime';
        periodStart?: string;
        periodEnd?: string;
        playbackSpeed?: (typeof playbackSpeeds)[number];
        balance?: number;
      };

      if (parsed.selectedExchange && exchanges.includes(parsed.selectedExchange)) {
        setSelectedExchange(parsed.selectedExchange);
      }
      if (parsed.dataMode === 'history' || parsed.dataMode === 'realtime') {
        setDataMode(parsed.dataMode);
      }
      if (parsed.periodStart) {
        setPeriodStart(parsed.periodStart);
      }
      if (parsed.periodEnd) {
        setPeriodEnd(parsed.periodEnd);
      }
      if (parsed.playbackSpeed && playbackSpeeds.includes(parsed.playbackSpeed)) {
        setPlaybackSpeed(parsed.playbackSpeed);
      }
      if (typeof parsed.balance === 'number' && parsed.balance > 0) {
        setBalance(parsed.balance);
      }
    } catch (error) {
      console.warn('Не удалось восстановить настройки подключения', error);
    }
  }, []);

  useEffect(() => {
    const payload = {
      selectedExchange,
      dataMode,
      periodStart,
      periodEnd,
      playbackSpeed,
      balance,
    };
    localStorage.setItem('manual-trading:connection', JSON.stringify(payload));
  }, [balance, dataMode, periodEnd, periodStart, playbackSpeed, selectedExchange]);

  useEffect(() => {
    setTicker(createTickerSnapshot(selectedInstrument));
    setTrades(seedTrades(selectedInstrument));
    setOrderBook(seedOrderBook(selectedInstrument));
    setSyntheticChart(seedChart(selectedInstrument));
    setDataUnavailable(false);
    setLastUpdateAt(null);
  }, [selectedInstrument]);

  const updateIntervalMs = useMemo(
    () => computeUpdateInterval(dataMode, playbackSpeed, periodStart, periodEnd),
    [dataMode, periodEnd, periodStart, playbackSpeed],
  );

  useEffect(() => {
    if (dataUnavailable) return;

    const intervalId = window.setInterval(() => {
      let priceForChildren = ticker.last;
      setTicker((prev) => {
        const next = mutateTicker(prev, selectedInstrument, dataMode);
        priceForChildren = next.last;
        return next;
      });
      setTrades((prev) => mutateTrades(prev, selectedInstrument, dataMode, priceForChildren));
      setOrderBook((prev) => mutateOrderBook(prev, selectedInstrument, priceForChildren));
      setSyntheticChart((prev) => mutateChart(prev, selectedInstrument, priceForChildren));
      setLastUpdateAt(new Date());
    }, updateIntervalMs);

    return () => clearInterval(intervalId);
  }, [dataUnavailable, dataMode, selectedInstrument, ticker.last, updateIntervalMs]);

  const handleConnect = () => {
    setConnectionError(null);

    if (balance <= 0) {
      setConnectionError('Введите положительный стартовый баланс');
      return;
    }

    if (dataMode === 'history') {
      if (!periodStart || !periodEnd) {
        setConnectionError('Укажите дату и время начала и окончания периода');
        return;
      }

      const start = new Date(periodStart);
      const end = new Date(periodEnd);

      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        setConnectionError('Некорректный формат периода');
        return;
      }

      if (start >= end) {
        setConnectionError('Дата начала должна быть раньше даты окончания');
        return;
      }

      if (!playbackSpeed) {
        setConnectionError('Выберите скорость воспроизведения');
        return;
      }

      setConnectionMessage(
        `Историческое воспроизведение: ${start.toLocaleString('ru-RU')} → ${end.toLocaleString('ru-RU')} @ ${playbackSpeed}. Стартовый баланс: ${balance.toLocaleString('ru-RU')} USDT`,
      );
      return;
    }

    setConnectionMessage(
      `Realtime поток на ${selectedExchange}. Баланс и позиции инициализированы на ${balance.toLocaleString('ru-RU')} USDT`,
    );
  };

  const handleSubmitOrder = (event: FormEvent) => {
    event.preventDefault();
    const id = `ord-${Date.now()}`;
    setOrders((prev) => [
      {
        id,
        instrument: selectedInstrument,
        type: orderType === 'market' ? 'Market' : orderType === 'stop' ? 'Stop' : 'Limit',
        size: orderSize,
        price: orderType === 'market' ? undefined : orderPrice,
        status: 'active',
      },
      ...prev,
    ]);
    setPositions((prev) => {
      const existing = prev.find((pos) => pos.instrument === selectedInstrument);
      if (existing) {
        return prev.map((pos) =>
          pos.instrument === selectedInstrument
            ? {
                ...pos,
                size: pos.size + orderSize,
                avgPrice:
                  orderType === 'market'
                    ? pos.avgPrice
                    : (pos.avgPrice * pos.size + orderPrice * orderSize) /
                      (pos.size + orderSize),
              }
            : pos,
        );
      }
      return [
        { instrument: selectedInstrument, size: orderSize, avgPrice: orderPrice, liqPrice: orderPrice * 0.6 },
        ...prev,
      ];
    });
  };

  const totalExposure = useMemo(
    () => positions.reduce((sum, position) => sum + position.size * position.avgPrice, 0),
    [positions],
  );

  const exposurePct = balance > 0 ? Math.min((totalExposure / balance) * 100, 999) : 0;
  const hasOrderBook = orderBook.bids.length > 0 && orderBook.asks.length > 0 && !dataUnavailable;
  const hasTrades = trades.length > 0 && !dataUnavailable;
  const hasChart = syntheticChart.length > 0 && !dataUnavailable;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-slate-900/40">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-wide text-slate-400">Режим</p>
            <h2 className="text-xl font-semibold text-slate-50">Ручная торговля</h2>
          </div>
          <span className="rounded-full border border-emerald-500/60 px-3 py-1 text-xs font-semibold uppercase text-emerald-300">
            Beta
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-2">
            <span className="text-sm text-slate-300">Биржа</span>
            <select
              value={selectedExchange}
              onChange={(event) => setSelectedExchange(event.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
            >
              {exchanges.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm text-slate-300">Режим данных</span>
            <div className="flex rounded-md border border-slate-700 bg-slate-950 p-1 text-sm">
              {(['history', 'realtime'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setDataMode(mode)}
                  className={`flex-1 rounded px-3 py-2 font-medium capitalize transition ${
                    dataMode === mode
                      ? 'bg-emerald-500/20 text-emerald-200'
                      : 'text-slate-300 hover:text-slate-100'
                  }`}
                >
                  {mode === 'history' ? 'Исторические' : 'Realtime'}
                </button>
              ))}
            </div>
          </label>
          <label className="space-y-2">
            <span className="text-sm text-slate-300">Стартовый баланс (USDT)</span>
            <input
              type="number"
              min={100}
              step={100}
              value={balance}
              onChange={(event) => setBalance(Number(event.target.value))}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
            />
          </label>
          <div className="flex items-end justify-end gap-2">
            <button
              type="button"
              onClick={handleConnect}
              className="w-full rounded-md border border-emerald-500 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/20 md:w-auto"
            >
              Подключиться
            </button>
            <button
              type="button"
              onClick={() => setDataUnavailable(true)}
              className="rounded-md border border-amber-400 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-400/20"
            >
              Симулировать обрыв
            </button>
            <button
              type="button"
              disabled={!dataUnavailable}
              onClick={() => {
                setDataUnavailable(false);
                setTicker(createTickerSnapshot(selectedInstrument));
                setTrades(seedTrades(selectedInstrument));
                setOrderBook(seedOrderBook(selectedInstrument));
                setSyntheticChart(seedChart(selectedInstrument));
                setConnectionMessage('Поток данных восстановлен');
                setLastUpdateAt(new Date());
              }}
              className="rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-emerald-400 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Вернуть поток
            </button>
          </div>
        </div>
        {dataMode === 'history' && (
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <span className="text-sm text-slate-300">Период от</span>
              <input
                type="datetime-local"
                value={periodStart}
                onChange={(event) => setPeriodStart(event.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm text-slate-300">Период до</span>
              <input
                type="datetime-local"
                value={periodEnd}
                onChange={(event) => setPeriodEnd(event.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm text-slate-300">Скорость воспроизведения</span>
              <select
                value={playbackSpeed}
                onChange={(event) => setPlaybackSpeed(event.target.value as (typeof playbackSpeeds)[number])}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
              >
                {playbackSpeeds.map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {connectionError && (
          <div className="rounded-md border border-red-600/50 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {connectionError}
          </div>
        )}
        {connectionMessage && (
          <div className="rounded-md border border-emerald-600/50 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {connectionMessage}
          </div>
        )}
        {dataUnavailable && (
          <div className="rounded-md border border-amber-500/60 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Данные недоступны: показаны заглушки до восстановления потока.
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 shadow-lg shadow-slate-900/30">
          <p className="text-xs uppercase tracking-wide text-slate-400">Баланс</p>
          <p className="text-2xl font-semibold text-emerald-200">
            {balance.toLocaleString('ru-RU')} <span className="text-sm text-slate-400">USDT</span>
          </p>
          <p className="text-xs text-slate-400">Задаётся на экране подключения</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 shadow-lg shadow-slate-900/30">
          <p className="text-xs uppercase tracking-wide text-slate-400">Экспозиция позиций</p>
          <p className="text-xl font-semibold text-slate-50">
            {totalExposure.toLocaleString('ru-RU')} <span className="text-sm text-slate-400">USDT</span>
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-emerald-300"
              style={{ width: `${Math.min(100, exposurePct).toFixed(1)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-slate-400">{exposurePct.toFixed(1)}% от стартового баланса</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 shadow-lg shadow-slate-900/30">
          <p className="text-xs uppercase tracking-wide text-slate-400">Режим данных</p>
          <p className="text-lg font-semibold text-slate-50">
            {dataMode === 'history' ? 'Исторические' : 'Realtime'}
          </p>
          {dataMode === 'history' ? (
            <p className="text-sm text-slate-300">
              {new Date(periodStart).toLocaleString('ru-RU')} → {new Date(periodEnd).toLocaleString('ru-RU')} @ {playbackSpeed}
            </p>
          ) : (
            <p className="text-sm text-slate-300">Параметры периода недоступны в режиме Realtime</p>
          )}
          <p className="mt-2 text-xs text-slate-400">
            Частота обновления: ~{updateIntervalMs} мс ·{' '}
            {lastUpdateAt ? `последнее ${formatTime(lastUpdateAt)}` : 'ожидание обновлений'}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-4 rounded-lg border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-slate-900/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Текущий инструмент</p>
              <p className="text-2xl font-semibold text-slate-50">{selectedInstrument}</p>
              <p className="text-sm text-slate-400">
                {dataUnavailable
                  ? 'Нет рыночных данных — отображаются заглушки'
                  : `Ticker обновляется каждые ~${updateIntervalMs} мс`}
              </p>
            </div>
            <div className="text-right text-sm text-slate-300">
              <p className="text-3xl font-semibold text-emerald-200">
                {dataUnavailable ? '—' : ticker.last.toLocaleString('ru-RU')}
              </p>
              <p className={ticker.change >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                {dataUnavailable ? 'нет изменения' : `${ticker.change >= 0 ? '+' : ''}${ticker.change}%`}
              </p>
              <p className="text-xs text-slate-400">
                Vol {dataUnavailable ? '—' : ticker.volume.toLocaleString('ru-RU')} · Hi/Lo{' '}
                {dataUnavailable ? '—' : `${ticker.high.toLocaleString('ru-RU')} / ${ticker.low.toLocaleString('ru-RU')}`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {instruments.map((symbol) => (
              <button
                key={symbol}
                type="button"
                onClick={() => setSelectedInstrument(symbol)}
                className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
                  selectedInstrument === symbol
                    ? 'border border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
                    : 'border border-slate-800 text-slate-300 hover:border-slate-700 hover:text-slate-100'
                }`}
              >
                {symbol}
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-md border border-slate-800 bg-slate-950/60 p-4">
              <div className="mb-3 flex items-center justify-between text-sm text-slate-400">
                <span>Поток сделок</span>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                  {dataMode === 'history' ? 'Replay' : 'Live'}
                </span>
              </div>
              {hasTrades ? (
                <div className="space-y-2 text-sm">
                  {trades.map((trade) => (
                    <div
                      key={`${trade.time}-${trade.price}-${trade.size}`}
                      className="flex items-center justify-between rounded border border-slate-800 bg-slate-900/60 px-3 py-2"
                    >
                      <span className="text-slate-400">{trade.time}</span>
                      <span className={trade.side === 'buy' ? 'text-emerald-300' : 'text-red-300'}>
                        {trade.side === 'buy' ? 'BUY' : 'SELL'}
                      </span>
                      <span className="font-semibold text-slate-50">{trade.price.toLocaleString('ru-RU')}</span>
                      <span className="text-slate-300">{trade.size}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-400">
                  Поток сделок недоступен — показываем заглушку для проверки отказоустойчивости.
                </div>
              )}
            </div>

            <div className="rounded-md border border-slate-800 bg-slate-950/60 p-4">
              <div className="mb-3 flex items-center justify-between text-sm text-slate-400">
                <span>Ордербук</span>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">L2</span>
              </div>
              {hasOrderBook ? (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-emerald-300">Bids</p>
                    {orderBook.bids.map((row) => (
                      <div
                        key={`bid-${row.price}`}
                        className="flex items-center justify-between rounded border border-slate-800 bg-emerald-500/5 px-3 py-1.5 text-emerald-100"
                      >
                        <span className="font-semibold">{row.price.toLocaleString('ru-RU')}</span>
                        <span className="text-emerald-200">{row.size}</span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-red-300">Asks</p>
                    {orderBook.asks.map((row) => (
                      <div
                        key={`ask-${row.price}`}
                        className="flex items-center justify-between rounded border border-slate-800 bg-red-500/5 px-3 py-1.5 text-red-100"
                      >
                        <span className="font-semibold">{row.price.toLocaleString('ru-RU')}</span>
                        <span className="text-red-200">{row.size}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-400">
                  Ордербук пуст: поток не отвечает или пришёл пустой ответ.
                </div>
              )}
            </div>

            <div className="rounded-md border border-slate-800 bg-slate-950/60 p-4">
              <div className="mb-3 flex items-center justify-between text-sm text-slate-400">
                <span>График</span>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">Preview</span>
              </div>
              {hasChart ? (
                <div className="grid h-48 grid-cols-4 items-end gap-2">
                  {syntheticChart.map((bar) => (
                    <div key={bar.label} className="flex flex-col items-center">
                      <div
                        className="w-full rounded-t bg-gradient-to-t from-emerald-500/30 to-emerald-300/60"
                        style={{ height: `${Math.max(20, (bar.price % 300) / 4)}px` }}
                      />
                      <span className="mt-2 text-xs text-slate-400">{bar.label}</span>
                      <span className="text-xs font-semibold text-slate-200">{bar.price}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex h-48 items-center justify-center rounded border border-slate-800 bg-slate-900/40 text-sm text-slate-400">
                  График временно недоступен — можно проверить обработку отсутствующих данных.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-slate-900/40">
          <h3 className="text-lg font-semibold text-slate-50">Ордеры</h3>
          <form onSubmit={handleSubmitOrder} className="space-y-3 rounded-md border border-slate-800 bg-slate-950/60 p-4 text-sm">
            <label className="space-y-1">
              <span className="text-slate-300">Инструмент</span>
              <select
                value={selectedInstrument}
                onChange={(event) => setSelectedInstrument(event.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 focus:border-emerald-400 focus:outline-none"
              >
                {instruments.map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {symbol}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-slate-300">Тип ордера</span>
              <select
                value={orderType}
                onChange={(event) => setOrderType(event.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 focus:border-emerald-400 focus:outline-none"
              >
                <option value="market">Рыночный</option>
                <option value="limit">Лимитный</option>
                <option value="stop">Стоп</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-slate-300">Размер</span>
              <input
                type="number"
                min={0.001}
                step={0.001}
                value={orderSize}
                onChange={(event) => setOrderSize(Number(event.target.value))}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 focus:border-emerald-400 focus:outline-none"
              />
            </label>
            {orderType !== 'market' && (
              <label className="space-y-1">
                <span className="text-slate-300">Цена</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={orderPrice}
                  onChange={(event) => setOrderPrice(Number(event.target.value))}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 focus:border-emerald-400 focus:outline-none"
                />
              </label>
            )}
            <button
              type="submit"
              className="w-full rounded-md border border-emerald-500 bg-emerald-500/10 px-4 py-2 font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
            >
              Разместить ордер
            </button>
          </form>

          <div className="space-y-2 text-sm">
            {orders.map((order) => (
              <div
                key={order.id}
                className="rounded border border-slate-800 bg-slate-950/60 px-3 py-2 text-slate-200"
              >
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>{order.id}</span>
                  <span
                    className={
                      order.status === 'active'
                        ? 'text-amber-300'
                        : order.status === 'filled'
                          ? 'text-emerald-300'
                          : 'text-slate-400'
                    }
                  >
                    {order.status}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold">
                    <span className="rounded bg-slate-800 px-2 py-1 text-xs uppercase text-slate-200">{order.type}</span>
                    <span>{order.instrument}</span>
                  </div>
                  <div className="text-sm text-slate-200">
                    {order.size}{' '}
                    {order.price ? `@ ${order.price.toLocaleString('ru-RU')}` : 'market'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-slate-900/40">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-50">Позиции</h3>
            <span className="text-xs text-slate-400">{positions.length} активных</span>
          </div>
          <div className="space-y-2 text-sm">
            {positions.map((position) => (
              <div
                key={position.instrument}
                className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/60 px-3 py-2"
              >
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-slate-400">{position.instrument}</p>
                  <p className="text-slate-100">
                    Размер: <span className="font-semibold">{position.size}</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    Доля баланса:{' '}
                    <span className="font-semibold text-emerald-200">
                      {balance > 0
                        ? ((position.size * position.avgPrice) / balance * 100).toFixed(2)
                        : '0.00'}
                      %
                    </span>
                  </p>
                </div>
                <div className="text-right text-xs text-slate-300">
                  <p>
                    Средняя цена:{' '}
                    <span className="font-semibold text-slate-100">{position.avgPrice.toLocaleString('ru-RU')}</span>
                  </p>
                  <p>
                    Ликвидация:{' '}
                    <span className="font-semibold text-red-300">{position.liqPrice.toLocaleString('ru-RU')}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-slate-900/40">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-50">Активные ордера</h3>
            <span className="text-xs text-slate-400">
              {orders.filter((order) => order.status === 'active').length} шт
            </span>
          </div>
          <div className="space-y-2 text-sm">
            {orders.map((order) => (
              <div
                key={`summary-${order.id}`}
                className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/60 px-3 py-2"
              >
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">{order.instrument}</p>
                  <p className="text-slate-100">
                    {order.type} · {order.size}{' '}
                    {order.price ? `@ ${order.price.toLocaleString('ru-RU')}` : 'market'}
                  </p>
                </div>
                <span
                  className={
                    order.status === 'active'
                      ? 'rounded bg-amber-500/20 px-2 py-1 text-xs font-semibold text-amber-200'
                      : order.status === 'filled'
                        ? 'rounded bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-200'
                        : 'rounded bg-slate-800 px-2 py-1 text-xs font-semibold text-slate-300'
                  }
                >
                  {order.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
