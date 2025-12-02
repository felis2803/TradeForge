import React from 'react';
import type { PlaybackSpeed, DataMode } from '@/types/ManualTrading';

interface ConnectionPanelProps {
  exchanges: readonly string[];
  playbackSpeeds: readonly PlaybackSpeed[];
  selectedExchange: string;
  dataMode: DataMode;
  balance: number;
  periodStart: string;
  periodEnd: string;
  playbackSpeed: PlaybackSpeed;
  connectionMessage: string;
  connectionError: string | null;
  setSelectedExchange: (exchange: string) => void;
  setDataMode: (mode: DataMode) => void;
  setBalance: (balance: number) => void;
  setPeriodStart: (start: string) => void;
  setPeriodEnd: (end: string) => void;
  setPlaybackSpeed: (speed: PlaybackSpeed) => void;
  handleConnect: () => void;
}

/**
 * Connection Panel Component
 * Handles exchange selection, data mode, balance, and connection settings
 */
export function ConnectionPanel({
  exchanges,
  playbackSpeeds,
  selectedExchange,
  dataMode,
  balance,
  periodStart,
  periodEnd,
  playbackSpeed,
  connectionMessage,
  connectionError,
  setSelectedExchange,
  setDataMode,
  setBalance,
  setPeriodStart,
  setPeriodEnd,
  setPlaybackSpeed,
  handleConnect,
}: ConnectionPanelProps) {
  return (
    <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-slate-900/40">
      <h2 className="text-xl font-bold text-slate-50">Подключение к бирже</h2>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-sm text-slate-300">Биржа</span>
          <select
            value={selectedExchange}
            onChange={(e) => setSelectedExchange(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
          >
            {exchanges.map((exchange) => (
              <option key={exchange} value={exchange}>
                {exchange}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-sm text-slate-300">Режим данных</span>
          <select
            value={dataMode}
            onChange={(e) => setDataMode(e.target.value as DataMode)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
          >
            <option value="history">Исторические</option>
            <option value="realtime">Realtime</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-sm text-slate-300">
            Стартовый баланс (USDT)
          </span>
          <input
            type="number"
            min={100}
            step={100}
            value={balance}
            onChange={(e) => setBalance(Number(e.target.value))}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
          />
        </label>
      </div>

      {dataMode === 'history' && (
        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-1">
            <span className="text-sm text-slate-300">Дата начала</span>
            <input
              type="datetime-local"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm text-slate-300">Дата окончания</span>
            <input
              type="datetime-local"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm text-slate-300">
              Скорость воспроизведения
            </span>
            <select
              value={playbackSpeed}
              onChange={(e) =>
                setPlaybackSpeed(e.target.value as PlaybackSpeed)
              }
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

      <button
        type="button"
        onClick={handleConnect}
        className="w-full rounded-md border border-emerald-500 bg-emerald-500/10 px-4 py-2.5 font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
      >
        Подключиться
      </button>

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
    </div>
  );
}
