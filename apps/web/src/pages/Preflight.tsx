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
  const [historyRange, setHistoryRange] = useState<{
    from: string;
    to: string;
  }>({ from: '', to: '' });
  const [instruments, setInstruments] = useState<InstrumentRow[]>([
    { symbol: 'BTCUSDT', makerBp: 1.0, takerBp: 1.0 },
  ]);
  const [dataReady, setDataReady] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runId = useMemo(() => `run-${Date.now()}`, []);

  const handleInstrumentChange = (
    index: number,
    key: keyof InstrumentRow,
    value: string,
  ) => {
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
          <label className="text-sm font-medium text-textMuted mb-1">Биржа</label>
          <select
            value={exchange}
            onChange={(event) => setExchange(event.target.value)}
            className="input-field bg-surface/50 text-text"
          >
            {exchanges.map((option) => (
              <option key={option} className="bg-surface text-text">{option}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-sm font-medium text-textMuted mb-1">
            Оператор данных
          </label>
          <select
            value={dataOperator}
            onChange={(event) => setDataOperator(event.target.value)}
            className="input-field bg-surface/50 text-text"
          >
            {operators.map((option) => (
              <option key={option} className="bg-surface text-text">{option}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-textMuted mb-1">Режим</span>
          <div className="flex gap-3 text-sm h-[42px] items-center">
            <label className="inline-flex items-center gap-2 cursor-pointer group">
              <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${mode === 'realtime' ? 'border-primary' : 'border-textMuted group-hover:border-primary/50'}`}>
                {mode === 'realtime' && <div className="w-2 h-2 rounded-full bg-primary" />}
              </div>
              <input
                type="radio"
                name="mode"
                value="realtime"
                checked={mode === 'realtime'}
                onChange={() => {
                  setMode('realtime');
                  setDataReady(true);
                }}
                className="hidden"
              />
              <span className="text-text group-hover:text-white transition-colors">Realtime</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer group">
              <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${mode === 'history' ? 'border-primary' : 'border-textMuted group-hover:border-primary/50'}`}>
                {mode === 'history' && <div className="w-2 h-2 rounded-full bg-primary" />}
              </div>
              <input
                type="radio"
                name="mode"
                value="history"
                checked={mode === 'history'}
                onChange={() => {
                  setMode('history');
                  setDataReady(false);
                }}
                className="hidden"
              />
              <span className="text-text group-hover:text-white transition-colors">History</span>
            </label>
          </div>
        </div>
      </div>

      {mode === 'history' && (
        <div className="flex flex-wrap items-end gap-4 rounded-xl border border-white/5 bg-surface/30 p-4 animate-fade-in">
          <div className="flex flex-col">
            <label className="text-sm font-medium text-textMuted mb-1">
              Начало периода
            </label>
            <input
              type="date"
              value={historyRange.from}
              onChange={(event) =>
                setHistoryRange((prev) => ({
                  ...prev,
                  from: event.target.value,
                }))
              }
              className="input-field text-text"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-sm font-medium text-textMuted mb-1">
              Окончание периода
            </label>
            <input
              type="date"
              value={historyRange.to}
              onChange={(event) =>
                setHistoryRange((prev) => ({ ...prev, to: event.target.value }))
              }
              className="input-field text-text"
            />
          </div>
          <button
            type="button"
            onClick={handleHistoryLoad}
            className="glass-button rounded-lg px-4 py-2 text-sm font-medium text-primary hover:text-white hover:bg-primary/20 hover:border-primary/30"
          >
            Загрузить
          </button>
          <div className="text-sm text-textMuted pb-2">
            Статус данных:{' '}
            <span className={`font-medium ${dataReady ? 'text-success' : 'text-warning'}`}>
              {dataReady ? 'Готово' : 'Ожидание'}
            </span>
          </div>
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between text-sm font-medium text-textMuted">
          <span>Инструменты и комиссии</span>
          <button
            type="button"
            onClick={addInstrument}
            className="glass-button rounded-lg px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary hover:text-white hover:bg-primary/20 hover:border-primary/30"
          >
            Добавить
          </button>
        </div>
        <div className="overflow-hidden rounded-xl border border-white/5 bg-surface/30">
          <table className="min-w-full divide-y divide-white/5 text-sm">
            <thead className="bg-white/5 text-left">
              <tr>
                <th className="px-4 py-3 font-medium text-textMuted">Тикер</th>
                <th className="px-4 py-3 font-medium text-textMuted">Maker (bps)</th>
                <th className="px-4 py-3 font-medium text-textMuted">Taker (bps)</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {instruments.map((row, index) => (
                <tr key={index} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-2">
                    <input
                      value={row.symbol}
                      onChange={(event) =>
                        handleInstrumentChange(
                          index,
                          'symbol',
                          event.target.value,
                        )
                      }
                      className="w-full bg-transparent border-none focus:ring-0 text-text placeholder:text-textMuted/30 p-0"
                      placeholder="BTCUSDT"
                      aria-label="Тикер"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      step="0.01"
                      value={row.makerBp}
                      onChange={(event) =>
                        handleInstrumentChange(
                          index,
                          'makerBp',
                          event.target.value,
                        )
                      }
                      className="w-full bg-transparent border-none focus:ring-0 text-text p-0"
                      aria-label="Maker (bps)"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      step="0.01"
                      value={row.takerBp}
                      onChange={(event) =>
                        handleInstrumentChange(
                          index,
                          'takerBp',
                          event.target.value,
                        )
                      }
                      className="w-full bg-transparent border-none focus:ring-0 text-text p-0"
                      aria-label="Taker (bps)"
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    {instruments.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeInstrument(index)}
                        className="text-xs font-medium text-error/70 hover:text-error transition-colors"
                      >
                        УДАЛИТЬ
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
          <span className="font-medium text-textMuted mb-1">
            Лимит активных ордеров
          </span>
          <input
            type="number"
            value={maxActiveOrders}
            onChange={(event) => setMaxActiveOrders(Number(event.target.value))}
            className="input-field text-text"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="font-medium text-textMuted mb-1">
            Таймаут heartbeat (сек)
          </span>
          <input
            type="number"
            value={heartbeatTimeoutSec}
            onChange={(event) =>
              setHeartbeatTimeoutSec(Number(event.target.value))
            }
            className="input-field text-text"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4 pt-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white shadow-[0_0_20px_rgba(112,0,255,0.3)] hover:bg-primaryHover hover:shadow-[0_0_30px_rgba(112,0,255,0.5)] active:scale-95 transition-all disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
        >
          {loading ? 'Применяем…' : 'Применить конфигурацию'}
        </button>
        {message && <span className="text-sm text-success animate-fade-in">{message}</span>}
        {error && <span className="text-sm text-error animate-fade-in">{error}</span>}
      </div>
    </form>
  );
}
