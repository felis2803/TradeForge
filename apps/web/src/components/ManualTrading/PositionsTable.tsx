import React from 'react';
import type { Position } from '@/types/ManualTrading';

interface PositionsTableProps {
  positions: Position[];
  markPrices: Record<string, number>;
  computePnl: (
    position: Position,
    markPrice: number,
  ) => { diff: number; pct: number };
  handleClosePosition: (instrument: string) => void;
  handleReversePosition: (instrument: string) => void;
}

/**
 * Positions Table Component
 * Displays active trading positions with PnL and action buttons
 */
export function PositionsTable({
  positions,
  markPrices,
  computePnl,
  handleClosePosition,
  handleReversePosition,
}: PositionsTableProps) {
  if (positions.length === 0) {
    return (
      <div className="rounded border border-slate-800 bg-slate-900/40 px-4 py-6 text-center text-sm text-slate-400">
        Нет открытых позиций
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {positions.map((position) => {
        const markPrice = markPrices[position.instrument] ?? position.avgPrice;
        const pnl = computePnl(position, markPrice);
        const pnlColor = pnl.diff >= 0 ? 'text-emerald-300' : 'text-red-300';

        return (
          <div
            key={position.instrument}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-900/60 p-3 text-sm"
          >
            <div className="flex-1">
              <p className="font-semibold text-slate-50">
                {position.instrument}
              </p>
              <p className="text-xs text-slate-400">
                Size: {position.size.toFixed(3)} · Avg:{' '}
                {position.avgPrice.toLocaleString('ru-RU')} · Liq:{' '}
                {position.liqPrice.toLocaleString('ru-RU')}
              </p>
            </div>
            <div className="text-right">
              <p className={`font-semibold ${pnlColor}`}>
                {pnl.diff >= 0 ? '+' : ''}
                {pnl.diff.toLocaleString('ru-RU')} USDT
              </p>
              <p className={`text-xs ${pnlColor}`}>
                {pnl.pct >= 0 ? '+' : ''}
                {pnl.pct}%
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleClosePosition(position.instrument)}
                className="rounded bg-red-600/20 px-3 py-1.5 text-xs font-semibold text-red-200 transition hover:bg-red-600/30"
              >
                Закрыть
              </button>
              <button
                type="button"
                onClick={() => handleReversePosition(position.instrument)}
                className="rounded bg-amber-600/20 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-600/30"
              >
                Развернуть
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
