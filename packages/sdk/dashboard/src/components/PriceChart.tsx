import { useEffect, useRef } from 'react';
import {
    createChart,
    IChartApi,
    ISeriesApi,
    IPriceLine,
    Time,
    ColorType,
    CandlestickData,
} from 'lightweight-charts';
import type { Trade, Order } from '../types/dashboard';

interface PriceChartProps {
    symbol: string;
    trades: Trade[];
    orders: Map<string, Order>;
}

function formatPrice(price: bigint): number {
    // Binance uses priceScale=5 for BTCUSDT/ETHUSDT/SOLUSDT
    // This means BigInt prices are scaled by 10^5
    const whole = Number(price / 100000n);
    const fraction = Number(price % 100000n) / 1e5;
    return whole + fraction;
}

function formatQty(qty: bigint): string {
    // Assuming qty scale 5 for simplicity or consistency with price
    // In reality we should use the symbol's qtyScale, but for display 5 decimals is usually safe
    const val = Number(qty) / 1e5;
    return val.toFixed(3);
}

// Aggregate trades into candlestick data (1-minute candles)
function aggregateTradesToCandles(trades: Trade[]): CandlestickData[] {
    if (trades.length === 0) return [];

    // Sort trades by timestamp (oldest first)
    const sorted = [...trades].sort((a, b) => a.ts - b.ts);

    // Group by minute
    const candleMap = new Map<number, {
        time: number;
        open: number;
        high: number;
        low: number;
        close: number;
    }>();

    sorted.forEach(trade => {
        // Convert milliseconds to seconds for TradingView
        const timestampSeconds = Math.floor(trade.ts / 1000);
        const minuteTs = Math.floor(timestampSeconds / 60) * 60; // Round to minute

        const price = formatPrice(trade.price);

        if (!candleMap.has(minuteTs)) {
            candleMap.set(minuteTs, {
                time: minuteTs,
                open: price,
                high: price,
                low: price,
                close: price,
            });
        } else {
            const candle = candleMap.get(minuteTs)!;
            candle.high = Math.max(candle.high, price);
            candle.low = Math.min(candle.low, price);
            candle.close = price; // Last trade in the minute
        }
    });

    // Convert to array and cast time to Time type
    return Array.from(candleMap.values()).map(candle => ({
        ...candle,
        time: candle.time as Time,
    }));
}

export function PriceChart({ symbol, trades, orders }: PriceChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const priceLinesRef = useRef<Map<string, IPriceLine>>(new Map());

    // Initialize chart
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            width: chartContainerRef.current.clientWidth,
            height: 400,
            layout: {
                background: { type: ColorType.Solid, color: '#0a0e27' },
                textColor: '#e4e9f7',
            },
            grid: {
                vertLines: { color: 'rgba(138, 180, 248, 0.1)' },
                horzLines: { color: 'rgba(138, 180, 248, 0.1)' },
            },
            crosshair: {
                mode: 1,
            },
            rightPriceScale: {
                borderColor: 'rgba(138, 180, 248, 0.2)',
            },
            timeScale: {
                borderColor: 'rgba(138, 180, 248, 0.2)',
                timeVisible: true,
                secondsVisible: false,
            },
        });

        const candleSeries = chart.addCandlestickSeries({
            upColor: '#10b981',
            downColor: '#ef4444',
            borderUpColor: '#10b981',
            borderDownColor: '#ef4444',
            wickUpColor: '#10b981',
            wickDownColor: '#ef4444',
        });

        chartRef.current = chart;
        candleSeriesRef.current = candleSeries;

        // Use real trade data if available, otherwise show sample data
        const chartData = trades.length > 0
            ? aggregateTradesToCandles(trades)
            : generateSampleData();
        candleSeries.setData(chartData);

        // Handle resize
        const handleResize = () => {
            if (chartContainerRef.current && chartRef.current) {
                chartRef.current.applyOptions({
                    width: chartContainerRef.current.clientWidth,
                });
            }
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, []);

    // Update chart data when trades change
    useEffect(() => {
        if (!candleSeriesRef.current) return;

        const chartData = trades.length > 0
            ? aggregateTradesToCandles(trades)
            : generateSampleData();

        candleSeriesRef.current.setData(chartData);
    }, [trades]);

    // Update price lines when orders change
    useEffect(() => {
        if (!candleSeriesRef.current) return;

        const activeIds = new Set<string>();

        // Update or create lines for active orders
        orders.forEach((order) => {
            activeIds.add(order.id);
            const price = formatPrice(order.price);
            const color = order.side === 'BUY' ? '#10b981' : '#ef4444';
            const title = `${order.side} ${formatQty(order.qty)}`;

            if (priceLinesRef.current.has(order.id)) {
                // Update existing line
                const line = priceLinesRef.current.get(order.id)!;
                line.applyOptions({
                    price,
                    color,
                    title,
                });
            } else {
                // Create new line
                const line = candleSeriesRef.current!.createPriceLine({
                    price,
                    color,
                    lineWidth: 1,
                    lineStyle: 2, // Dashed
                    axisLabelVisible: true,
                    title,
                });
                priceLinesRef.current.set(order.id, line);
            }
        });

        // Remove lines for closed/cancelled orders
        const linesToRemove: string[] = [];
        priceLinesRef.current.forEach((_, id) => {
            if (!activeIds.has(id)) {
                linesToRemove.push(id);
            }
        });

        linesToRemove.forEach((id) => {
            const line = priceLinesRef.current.get(id);
            if (line && candleSeriesRef.current) {
                candleSeriesRef.current.removePriceLine(line);
                priceLinesRef.current.delete(id);
            }
        });

    }, [orders]);

    return (
        <div className="card wide-card">
            <div className="card-title">
                {symbol} Price Chart
            </div>
            <div ref={chartContainerRef} style={{ position: 'relative' }} />
        </div>
    );
}

// Generate sample candlestick data for demonstration
function generateSampleData(): CandlestickData[] {
    const data: CandlestickData[] = [];
    const basePrice = 50000;
    const now = Math.floor(Date.now() / 1000);

    for (let i = 100; i >= 0; i--) {
        const time = (now - i * 60) as Time; // 1-minute candles
        const volatility = 100;
        const trend = (100 - i) * 5; // Slight upward trend

        const open = basePrice + trend + (Math.random() - 0.5) * volatility;
        const close = open + (Math.random() - 0.5) * volatility;
        const high = Math.max(open, close) + Math.random() * volatility / 2;
        const low = Math.min(open, close) - Math.random() * volatility / 2;

        data.push({
            time,
            open,
            high,
            low,
            close,
        });
    }

    return data;
}
