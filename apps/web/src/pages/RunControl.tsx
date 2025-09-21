import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

interface RunControlProps {
  apiBase: string;
}

interface RunStatusResponse {
  status: string;
  config?: {
    mode: 'history' | 'realtime';
    speed: string;
  } | null;
}

const speeds = ['realtime', '1x', '2x', 'as_fast_as_possible'];

export default function RunControl({ apiBase }: RunControlProps): JSX.Element {
  const queryClient = useQueryClient();
  const { data, isFetching, refetch } = useQuery<RunStatusResponse>({
    queryKey: ['run-status'],
    queryFn: async () => {
      const response = await fetch(`${apiBase}/v1/runs/status`);
      if (!response.ok) {
        throw new Error('Не удалось получить статус запуска');
      }
      return response.json();
    },
    refetchInterval: 5000,
  });

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [selectedSpeed, setSelectedSpeed] = useState<string>('1x');

  const status = data?.status ?? 'idle';
  const isRunning = status === 'running';
  const isIdle = status === 'idle';
  const isStopped = status === 'stopped';
  const mode = data?.config?.mode ?? 'realtime';

  const execute = async (endpoint: string, body?: Record<string, unknown>) => {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Операция завершилась ошибкой');
      }
      const payload = await response.json();
      setMessage(`Статус: ${payload.status}`);
      await queryClient.invalidateQueries({ queryKey: ['run-status'] });
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка');
    } finally {
      setPending(false);
    }
  };

  const handleStart = () => {
    const body = mode === 'history' ? { speed: selectedSpeed } : undefined;
    void execute('/v1/runs/start', body);
  };

  const handlePause = () => {
    void execute('/v1/runs/pause');
  };

  const handleStop = () => {
    void execute('/v1/runs/stop');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-300">
        <span>
          Текущий статус: <span className="font-semibold text-slate-100">{status}</span>
        </span>
        {isFetching && <span className="text-xs text-slate-500">обновляем…</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleStart}
          disabled={pending || isRunning}
          className="rounded-md border border-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Старт
        </button>
        <button
          type="button"
          onClick={handlePause}
          disabled={pending || !isRunning}
          className="rounded-md border border-amber-500 px-4 py-2 text-sm font-semibold text-amber-300 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Пауза
        </button>
        <button
          type="button"
          onClick={handleStop}
          disabled={pending || isIdle || isStopped}
          className="rounded-md border border-red-500 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Стоп
        </button>
        {mode === 'history' && (
          <label className="ml-auto flex items-center gap-2 text-sm text-slate-300">
            Скорость:
            <select
              value={selectedSpeed}
              onChange={(event) => setSelectedSpeed(event.target.value)}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
            >
              {speeds.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {message && <span className="text-emerald-300">{message}</span>}
        {error && <span className="text-red-300">{error}</span>}
      </div>
    </div>
  );
}
