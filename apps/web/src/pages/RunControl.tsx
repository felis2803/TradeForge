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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
        <div className="flex items-center gap-3">
          <span className="text-textMuted">Текущий статус:</span>
          <div
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 border ${
              status === 'running'
                ? 'bg-success/10 border-success/20 text-success'
                : status === 'stopped'
                  ? 'bg-error/10 border-error/20 text-error'
                  : 'bg-warning/10 border-warning/20 text-warning'
            }`}
          >
            <div
              className={`w-2 h-2 rounded-full ${
                status === 'running'
                  ? 'bg-success animate-pulse'
                  : status === 'stopped'
                    ? 'bg-error'
                    : 'bg-warning'
              }`}
            />
            <span className="font-semibold uppercase tracking-wider">
              {status}
            </span>
          </div>
        </div>
        {isFetching && (
          <span className="text-xs text-primary animate-pulse">обновляем…</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleStart}
          disabled={pending || isRunning}
          className="flex-1 rounded-xl bg-success/10 border border-success/20 px-4 py-3 text-sm font-semibold text-success hover:bg-success/20 hover:shadow-[0_0_15px_rgba(0,255,148,0.2)] active:scale-95 transition-all disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
        >
          Старт
        </button>
        <button
          type="button"
          onClick={handlePause}
          disabled={pending || !isRunning}
          className="flex-1 rounded-xl bg-warning/10 border border-warning/20 px-4 py-3 text-sm font-semibold text-warning hover:bg-warning/20 hover:shadow-[0_0_15px_rgba(255,184,0,0.2)] active:scale-95 transition-all disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
        >
          Пауза
        </button>
        <button
          type="button"
          onClick={handleStop}
          disabled={pending || isIdle || isStopped}
          className="flex-1 rounded-xl bg-error/10 border border-error/20 px-4 py-3 text-sm font-semibold text-error hover:bg-error/20 hover:shadow-[0_0_15px_rgba(255,0,85,0.2)] active:scale-95 transition-all disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
        >
          Стоп
        </button>
      </div>

      {mode === 'history' && (
        <div className="rounded-xl border border-white/5 bg-surface/30 p-4 animate-fade-in">
          <label className="flex items-center justify-between gap-4 text-sm">
            <span className="font-medium text-textMuted">
              Скорость воспроизведения
            </span>
            <select
              value={selectedSpeed}
              onChange={(event) => setSelectedSpeed(event.target.value)}
              className="input-field w-auto min-w-[120px] bg-surface/50 text-text"
            >
              {speeds.map((option) => (
                <option
                  key={option}
                  value={option}
                  className="bg-surface text-text"
                >
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="min-h-[24px]">
        {message && (
          <span className="text-sm text-success animate-fade-in flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                clipRule="evenodd"
              />
            </svg>
            {message}
          </span>
        )}
        {error && (
          <span className="text-sm text-error animate-fade-in flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
