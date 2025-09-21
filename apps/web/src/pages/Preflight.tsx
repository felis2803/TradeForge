import { FormEvent, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface PreflightProps {
  apiBase: string;
}

interface InstrumentRow {
  symbol: string;
  makerBp: number;
  takerBp: number;
}

type Mode = 'history' | 'realtime';

const exchanges = ['Binance', 'Bybit', 'Bitfinex'];
const operators = ['Internal', 'Binance Loader'];

export default function Preflight({ apiBase }: PreflightProps): JSX.Element {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('realtime');
  const [exchange, setExchange] = useState(exchanges[0]);
  const [dataOperator, setDataOperator] = useState(operators[0]);
  const [maxActiveOrders, setMaxActiveOrders] = useState(50);
  const [heartbeatTimeoutSec, setHeartbeatTimeoutSec] = useState(6);
  const [historyRange, setHistoryRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [instruments, setInstruments] = useState<InstrumentRow[]>([
    { symbol: 'BTCUSDT', makerBp: 1.0, takerBp: 1.0 },
  ]);
  const [dataReady, setDataReady] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runId = useMemo(() => `run-${Date.now()}`, []);

  const handleInstrumentChange = (index: number, key: keyof InstrumentRow, value: string) => {
    setInstruments((prev) => {
      const next = [...prev];
      const row = { ...next[index] };
      if (key === 'symbol') {
        row.symbol = value;
      } else {
        row[key] = Number(value);
      }
      next[index] = row;
      return next;
    });
  };

  const addInstrument = () => {
    setInstruments((prev) => [...prev, { symbol: '', makerBp: 0, takerBp: 0 }]);
  };

  const removeInstrument = (index: number) => {
    setInstruments((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const payload = {
        id: runId,
        mode,
        speed: mode === 'history' ? '1x' : 'realtime',
        exchange,
        dataOperator,
        instruments: instruments.filter((row) => row.symbol.trim().length > 0),
        maxActiveOrders,
        heartbeatTimeoutSec,
        dataReady,
      };

      const response = await fetch(`${apiBase}/v1/runs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Не удалось применить конфигурацию');
      }

      setMessage('Конфигурация обновлена');
      await queryClient.invalidateQueries({ queryKey: ['run-status'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка');
    } finally {
      setLoading(false);
    }
  };

  const handleHistoryLoad = () => {
    if (!historyRange.from || !historyRange.to) {
      setError('Укажите период истории');
      return;
    }
    setError(null);
    setDataReady(true);
    setMessage('Исторические данные готовы к запуску');
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col">
          <label className="text-sm font-medium text-slate-300">Биржа</label>
          <select
            value={exchange}
            onChange={(event) => setExchange(event.target.value)}
            className="mt-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
          >
            {exchanges.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-sm font-medium text-slate-300">Оператор данных</label>
          <select
            value={dataOperator}
            onChange={(event) => setDataOperator(event.target.value)}
            className="mt-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
          >
            {operators.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-slate-300">Режим</span>
          <div className="mt-1 flex gap-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="mode"
                value="realtime"
                checked={mode === 'realtime'}
                onChange={() => {
                  setMode('realtime');
                  setDataReady(true);
                }}
              />
              <span>Realtime</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="mode"
                value="history"
                checked={mode === 'history'}
                onChange={() => {
                  setMode('history');
                  setDataReady(false);
                }}
              />
              <span>History</span>
            </label>
          </div>
        </div>
      </div>

      {mode === 'history' && (
        <div className="flex flex-wrap items-end gap-4 rounded-md border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex flex-col">
            <label className="text-sm font-medium text-slate-300">Начало периода</label>
            <input
              type="date"
              value={historyRange.from}
              onChange={(event) => setHistoryRange((prev) => ({ ...prev, from: event.target.value }))}
              className="mt-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-sm font-medium text-slate-300">Окончание периода</label>
            <input
              type="date"
              value={historyRange.to}
              onChange={(event) => setHistoryRange((prev) => ({ ...prev, to: event.target.value }))}
              className="mt-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={handleHistoryLoad}
            className="rounded-md border border-emerald-500 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/10"
          >
            Загрузить
          </button>
          <div className="text-sm text-slate-400">
            Статус данных: <span className={dataReady ? 'text-emerald-300' : 'text-amber-300'}>{dataReady ? 'Готово' : 'Ожидание'}</span>
          </div>
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between text-sm font-medium text-slate-300">
          <span>Инструменты и комиссии</span>
          <button
            type="button"
            onClick={addInstrument}
            className="rounded-md border border-slate-700 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-300 hover:bg-emerald-500/10"
          >
            Добавить
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800 text-sm">
            <thead className="bg-slate-900/60 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Тикер</th>
                <th className="px-3 py-2 font-medium">Maker (bps)</th>
                <th className="px-3 py-2 font-medium">Taker (bps)</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {instruments.map((row, index) => (
                <tr key={index}>
                  <td className="px-3 py-2">
                    <input
                      value={row.symbol}
                      onChange={(event) => handleInstrumentChange(index, 'symbol', event.target.value)}
                      className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 focus:border-emerald-400 focus:outline-none"
                      placeholder="BTCUSDT"
                      aria-label="Тикер"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      value={row.makerBp}
                      onChange={(event) => handleInstrumentChange(index, 'makerBp', event.target.value)}
                      className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 focus:border-emerald-400 focus:outline-none"
                      aria-label="Maker (bps)"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      value={row.takerBp}
                      onChange={(event) => handleInstrumentChange(index, 'takerBp', event.target.value)}
                      className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 focus:border-emerald-400 focus:outline-none"
                      aria-label="Taker (bps)"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {instruments.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeInstrument(index)}
                        className="rounded-md border border-red-500 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-300 hover:bg-red-500/10"
                      >
                        Удалить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col text-sm">
          <span className="font-medium text-slate-300">Лимит активных ордеров</span>
          <input
            type="number"
            value={maxActiveOrders}
            onChange={(event) => setMaxActiveOrders(Number(event.target.value))}
            className="mt-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 focus:border-emerald-400 focus:outline-none"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="font-medium text-slate-300">Таймаут heartbeat (сек)</span>
          <input
            type="number"
            value={heartbeatTimeoutSec}
            onChange={(event) => setHeartbeatTimeoutSec(Number(event.target.value))}
            className="mt-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 focus:border-emerald-400 focus:outline-none"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md border border-emerald-500 px-5 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Применяем…' : 'Применить конфигурацию'}
        </button>
        {message && <span className="text-sm text-emerald-300">{message}</span>}
        {error && <span className="text-sm text-red-300">{error}</span>}
      </div>
    </form>
  );
}
