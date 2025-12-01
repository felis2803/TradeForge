import React from 'react';
import type { TickerSnapshot, TradeRow, OrderBookSnapshot, ChartPoint } from '@/types/ManualTrading';
import { ORDERBOOK_DEPTH } from '@/utils/ManualTrading/constants';
import { aggregateSide } from '@/utils/ManualTrading';

interface MarketDataPanelProps {
    selectedInstrument: string;
    ticker: TickerSnapshot;
    trades: TradeRow[];
    orderBook: OrderBookSnapshot;
    syntheticChart: ChartPoint[];
    dataMode: 'history' | 'realtime';
    dataUnavailable: boolean;
    updateIntervalMs: number;
    handleOrderbookPriceClick?: (price: number) => void;
}

/**
 * Market Data Panel Component
 * Displays ticker, trades stream, orderbook, and chart
 */
export function MarketDataPanel({
    selectedInstrument,
    ticker,
    trades,
    orderBook,
    syntheticChart,
    dataMode,
    dataUnavailable,
    updateIntervalMs,
    handleOrderbookPriceClick,
}: MarketDataPanelProps) {
    const hasTrades = trades.length > 0;
    const hasOrderBook = orderBook.bids.length > 0 || orderBook.asks.length > 0;
    const hasChart = syntheticChart.length > 0;

    const normalizedOrderBook = hasOrderBook
        ? {
            bids: aggregateSide(orderBook.bids, 'bids').levels,
            asks: aggregateSide(orderBook.asks, 'asks').levels,
            truncated: false,
            totalLevels: orderBook.bids.length + orderBook.asks.length,
        }
        : { bids: [], asks: [], truncated: false, totalLevels: 0 };

    return (
        <div className="space-y-4">
            {/* Ticker Info */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400">
                        Текущий инструмент
                    </p>
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
                        {dataUnavailable
                            ? 'нет изменения'
                            : `${ticker.change >= 0 ? '+' : ''}${ticker.change}%`}
                    </p>
                    <p className="text-xs text-slate-400">
                        Vol {dataUnavailable ? '—' : ticker.volume.toLocaleString('ru-RU')} · Hi/Lo{' '}
                        {dataUnavailable
                            ? '—'
                            : `${ticker.high.toLocaleString('ru-RU')} / ${ticker.low.toLocaleString('ru-RU')}`}
                    </p>
                </div>
            </div>

            {/* Market Data Grid */}
            <div className="grid gap-4 lg:grid-cols-3">
                {/* Trades Stream */}
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
                                    key={trade.timestamp}
                                    className="flex items-center justify-between rounded border border-slate-800 bg-slate-900/60 px-3 py-2"
                                >
                                    <span className="text-slate-400">{trade.time}</span>
                                    <span
                                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${trade.side === 'buy'
                                                ? 'bg-emerald-500/15 text-emerald-200'
                                                : 'bg-red-500/15 text-red-200'
                                            }`}
                                    >
                                        {trade.side === 'buy' ? 'BUY' : 'SELL'}
                                    </span>
                                    <span className="font-semibold text-slate-50">
                                        {trade.price.toLocaleString('ru-RU')}
                                    </span>
                                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-200">
                                        {trade.size}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-400">
                            Поток сделок недоступен
                        </div>
                    )}
                </div>

                {/* Orderbook */}
                <div className="rounded-md border border-slate-800 bg-slate-950/60 p-4">
                    <div className="mb-3 flex items-center justify-between text-sm text-slate-400">
                        <span>Ордербук</span>
                        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                            L2
                        </span>
                    </div>
                    {hasOrderBook ? (
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="space-y-2">
                                <p className="text-xs uppercase tracking-wide text-emerald-300">Bids</p>
                                {normalizedOrderBook.bids.map((row) => (
                                    <div
                                        key={`bid-${row.price}`}
                                        onClick={() => handleOrderbookPriceClick?.(row.price)}
                                        className={`flex items-center justify-between rounded border border-slate-800 bg-emerald-500/5 px-3 py-1.5 text-emerald-100 ${handleOrderbookPriceClick
                                                ? 'cursor-pointer transition hover:border-emerald-500/50 hover:bg-emerald-500/10'
                                                : ''
                                            }`}
                                    >
                                        <span className="font-semibold">{row.price.toLocaleString('ru-RU')}</span>
                                        <span className="text-emerald-200">{row.size}</span>
                                    </div>
                                ))}
                            </div>
                            <div className="space-y-2">
                                <p className="text-xs uppercase tracking-wide text-red-300">Asks</p>
                                {normalizedOrderBook.asks.map((row) => (
                                    <div
                                        key={`ask-${row.price}`}
                                        onClick={() => handleOrderbookPriceClick?.(row.price)}
                                        className={`flex items-center justify-between rounded border border-slate-800 bg-red-500/5 px-3 py-1.5 text-red-100 ${handleOrderbookPriceClick
                                                ? 'cursor-pointer transition hover:border-red-500/50 hover:bg-red-500/10'
                                                : ''
                                            }`}
                                    >
                                        <span className="font-semibold">{row.price.toLocaleString('ru-RU')}</span>
                                        <span className="text-red-200">{row.size}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="rounded border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-400">
                            Ордербук пуст
                        </div>
                    )}
                </div>

                {/* Chart */}
                <div className="rounded-md border border-slate-800 bg-slate-950/60 p-4">
                    <div className="mb-3 flex items-center justify-between text-sm text-slate-400">
                        <span>График</span>
                        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                            Preview
                        </span>
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
                            График временно недоступен
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
