import { FormEvent, useMemo, useState } from 'react';

const exchanges = ['Binance', 'Bybit', 'OKX', 'Bitget'];
const instruments = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT'];
const playbackSpeeds = ['0.25x', '0.5x', '1x', '2x', '4x'];

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

export default function ManualTrading(): JSX.Element {
  const [selectedExchange, setSelectedExchange] = useState(exchanges[0]);
  const [dataMode, setDataMode] = useState<'history' | 'realtime'>('history');
  const [periodStart, setPeriodStart] = useState('2024-05-01');
  const [periodEnd, setPeriodEnd] = useState('2024-05-15');
  const [playbackSpeed, setPlaybackSpeed] = useState(playbackSpeeds[2]);
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

  const trades = useMemo(
    () => [
      { time: '12:01:03', side: 'buy', price: 65120, size: 0.12 },
      { time: '12:01:00', side: 'sell', price: 65100, size: 0.6 },
      { time: '12:00:57', side: 'buy', price: 65110, size: 0.28 },
      { time: '12:00:54', side: 'sell', price: 65070, size: 0.18 },
      { time: '12:00:50', side: 'buy', price: 65090, size: 0.25 },
    ],
    [],
  );

  const orderBook = useMemo(
    () => ({
      bids: [
        { price: 65110, size: 1.2 },
        { price: 65105, size: 0.8 },
        { price: 65100, size: 1.6 },
        { price: 65095, size: 0.4 },
      ],
      asks: [
        { price: 65125, size: 1.1 },
        { price: 65130, size: 0.7 },
        { price: 65135, size: 1.3 },
        { price: 65140, size: 0.5 },
      ],
    }),
    [],
  );

  const syntheticChart = useMemo(
    () => [
      { price: 64900, label: '11:58' },
      { price: 65020, label: '11:59' },
      { price: 65110, label: '12:00' },
      { price: 65060, label: '12:01' },
      { price: 65130, label: '12:02' },
    ],
    [],
  );

  const handleConnect = () => {
    const modeLabel =
      dataMode === 'history'
        ? `история ${periodStart} → ${periodEnd} @ ${playbackSpeed}`
        : 'realtime';
    setConnectionMessage(
      `Подключение к ${selectedExchange}, режим данных: ${modeLabel}, баланс: ${balance.toLocaleString('ru-RU')} USDT`,
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
          <div className="flex items-end justify-end">
            <button
              type="button"
              onClick={handleConnect}
              className="w-full rounded-md border border-emerald-500 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/20 md:w-auto"
            >
              Подключиться
            </button>
          </div>
        </div>
        {dataMode === 'history' && (
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <span className="text-sm text-slate-300">Период от</span>
              <input
                type="date"
                value={periodStart}
                onChange={(event) => setPeriodStart(event.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm text-slate-300">Период до</span>
              <input
                type="date"
                value={periodEnd}
                onChange={(event) => setPeriodEnd(event.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm text-slate-300">Скорость воспроизведения</span>
              <select
                value={playbackSpeed}
                onChange={(event) => setPlaybackSpeed(event.target.value)}
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
        {connectionMessage && (
          <div className="rounded-md border border-emerald-600/50 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {connectionMessage}
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-4 rounded-lg border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-slate-900/40">
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
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">Live</span>
              </div>
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
            </div>

            <div className="rounded-md border border-slate-800 bg-slate-950/60 p-4">
              <div className="mb-3 flex items-center justify-between text-sm text-slate-400">
                <span>Ордербук</span>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">L2</span>
              </div>
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
            </div>

            <div className="rounded-md border border-slate-800 bg-slate-950/60 p-4">
              <div className="mb-3 flex items-center justify-between text-sm text-slate-400">
                <span>График</span>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">Preview</span>
              </div>
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
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-slate-900/40">
          <h3 className="text-lg font-semibold text-slate-50">Ордеры</h3>
          <form onSubmit={handleSubmitOrder} className="space-y-3 rounded-md border border-slate-800 bg-slate-950/60 p-4 text-sm">
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
                    Размер:{' '}
                    <span className="font-semibold">{position.size}</span>
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
