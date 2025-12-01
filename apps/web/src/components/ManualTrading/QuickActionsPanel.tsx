import React from 'react';

interface QuickActionsPanelProps {
    balance: number;
    selectedPreset: number | null;
    selectedInstrument: string;
    calculatePresetSize: (percentage: number) => number;
    handlePresetClick: (percentage: number) => void;
    handleQuickMarketOrder: (side: 'buy' | 'sell', preset: number) => void;
}

/**
 * Quick Actions Panel Component
 * Displays preset buttons and one-click Buy/Sell buttons
 */
export function QuickActionsPanel({
    balance,
    selectedPreset,
    selectedInstrument,
    calculatePresetSize,
    handlePresetClick,
    handleQuickMarketOrder,
}: QuickActionsPanelProps) {
    return (
        <div className="space-y-3 rounded-md border border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-emerald-500/10 p-4">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-emerald-200">
                    ⚡ Быстрые действия
                </h4>
                <span className="text-xs text-slate-400">
                    Баланс: {balance.toLocaleString('ru-RU')} USDT
                </span>
            </div>

            {/* Preset Buttons */}
            <div>
                <p className="mb-2 text-xs text-slate-400">Размер от баланса:</p>
                <div className="grid grid-cols-4 gap-2">
                    {[25, 50, 75, 100].map((preset) => (
                        <button
                            key={preset}
                            type="button"
                            onClick={() => handlePresetClick(preset)}
                            className={`rounded-md px-3 py-2 text-sm font-semibold transition ${selectedPreset === preset
                                    ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/50'
                                    : 'border border-slate-700 text-slate-300 hover:border-emerald-500/50 hover:text-emerald-200'
                                }`}
                        >
                            {preset}%
                        </button>
                    ))}
                </div>
                {selectedPreset && (
                    <p className="mt-2 text-xs text-emerald-300">
                        Размер: {calculatePresetSize(selectedPreset).toFixed(3)}{' '}
                        {selectedInstrument.split('/')[0]}
                    </p>
                )}
            </div>

            {/* Quick Buy/Sell Buttons */}
            <div>
                <p className="mb-2 text-xs text-slate-400">One-click ордера:</p>
                <div className="grid grid-cols-2 gap-2">
                    <button
                        type="button"
                        onClick={() => selectedPreset && handleQuickMarketOrder('buy', selectedPreset)}
                        disabled={!selectedPreset}
                        className="rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        🚀 Quick BUY
                    </button>
                    <button
                        type="button"
                        onClick={() => selectedPreset && handleQuickMarketOrder('sell', selectedPreset)}
                        disabled={!selectedPreset}
                        className="rounded-md bg-red-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        💥 Quick SELL
                    </button>
                </div>
                {!selectedPreset && (
                    <p className="mt-2 text-center text-xs text-amber-300">
                        ℹ️ Выберите пресет для активации
                    </p>
                )}
            </div>
        </div>
    );
}
