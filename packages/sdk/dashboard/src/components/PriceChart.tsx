import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  IPriceLine,
  Time,
  ColorType,
  CandlestickData,
  LineData,
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

function sliceByWindow(
  candles: CandlestickData[],
  endIndex: number,
  windowMinutes: number,
): CandlestickData[] {
  if (candles.length === 0 || endIndex <= 0) return [];

  const end = Math.min(endIndex, candles.length);
  const endTime = Number(candles[end - 1].time) * 1000;
  const startTime = endTime - windowMinutes * 60 * 1000;

  let start = end - 1;
  while (start > 0 && Number(candles[start].time) * 1000 >= startTime) {
    start -= 1;
  }

  return candles.slice(start, end);
}

// Aggregate trades into candlestick data (1-minute candles)
function aggregateTradesToCandles(trades: Trade[]): CandlestickData[] {
  if (trades.length === 0) return [];

  // Sort trades by timestamp (oldest first)
  const sorted = [...trades].sort((a, b) => a.ts - b.ts);

  // Group by minute
  const candleMap = new Map<
    number,
    {
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }
  >();

  sorted.forEach((trade) => {
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
  return Array.from(candleMap.values()).map((candle) => ({
    ...candle,
    time: candle.time as Time,
  }));
}

export function PriceChart({ symbol, trades, orders }: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLinesRef = useRef<Map<string, IPriceLine>>(new Map());

  const [chartType, setChartType] = useState<'candles' | 'line'>('candles');
  const [viewMode, setViewMode] = useState<'realtime' | 'historical'>(
    'realtime',
  );
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [visibleCount, setVisibleCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [visibleRangeLabel, setVisibleRangeLabel] = useState<string>('—');

  const aggregatedCandles = useMemo(() => {
    return trades.length > 0
      ? aggregateTradesToCandles(trades)
      : generateSampleData();
  }, [trades]);

  useEffect(() => {
    setVisibleCount(Math.max(1, aggregatedCandles.length));
  }, [aggregatedCandles.length]);

  const displayCandles = useMemo(() => {
    const endIndex =
      viewMode === 'realtime' ? aggregatedCandles.length : visibleCount;
    const windowed = sliceByWindow(aggregatedCandles, endIndex, windowMinutes);
    return windowed.length > 0 ? windowed : aggregatedCandles;
  }, [aggregatedCandles, viewMode, visibleCount, windowMinutes]);

  const lineData = useMemo<LineData[]>(() => {
    return displayCandles.map((candle) => ({
      time: candle.time,
      value: candle.close,
    }));
  }, [displayCandles]);

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

    const lineSeries = chart.addLineSeries({
      color: '#4c9aff',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    lineSeriesRef.current = lineSeries;

    candleSeries.setData([]);
    lineSeries.setData([]);

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (!range) return;
      const from =
        typeof range.from === 'number'
          ? range.from
          : (range.from as { timestamp: number }).timestamp;
      const to =
        typeof range.to === 'number'
          ? range.to
          : (range.to as { timestamp: number }).timestamp;
      const startDate = new Date(Number(from) * 1000);
      const endDate = new Date(Number(to) * 1000);
      setVisibleRangeLabel(
        `${startDate.toLocaleString()} — ${endDate.toLocaleString()}`,
      );
    });

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // Update chart data when trades change
  useEffect(() => {
    if (!candleSeriesRef.current || !lineSeriesRef.current) return;

    candleSeriesRef.current.setData(displayCandles);
    lineSeriesRef.current.setData(lineData);

    if (viewMode === 'realtime') {
      chartRef.current?.timeScale().scrollToRealTime();
    }
  }, [displayCandles, lineData, viewMode]);

  useEffect(() => {
    if (!candleSeriesRef.current || !lineSeriesRef.current) return;

    candleSeriesRef.current.applyOptions({ visible: chartType === 'candles' });
    lineSeriesRef.current.applyOptions({ visible: chartType === 'line' });
  }, [chartType]);

  // Update price lines when orders change
  useEffect(() => {
    if (!candleSeriesRef.current || !lineSeriesRef.current) return;

    priceLinesRef.current.forEach((line) => {
      candleSeriesRef.current?.removePriceLine(line);
      lineSeriesRef.current?.removePriceLine(line);
    });
    priceLinesRef.current.clear();

    const activeSeries =
      chartType === 'candles' ? candleSeriesRef.current : lineSeriesRef.current;

    orders.forEach((order) => {
      const price = formatPrice(order.price);
      const color = order.side === 'BUY' ? '#10b981' : '#ef4444';
      const title = `${order.side} ${formatQty(order.qty)}`;

      const line = activeSeries.createPriceLine({
        price,
        color,
        lineWidth: 1,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title,
      });
      priceLinesRef.current.set(order.id, line);
    });
  }, [orders, chartType]);

  useEffect(() => {
    if (viewMode !== 'historical' || !isPlaying) return;

    const interval = window.setInterval(() => {
      setVisibleCount((prev) => {
        const next = Math.min(
          aggregatedCandles.length,
          prev + Math.max(1, playbackSpeed),
        );

        if (next === aggregatedCandles.length) {
          setIsPlaying(false);
        }

        return next;
      });
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [aggregatedCandles.length, isPlaying, playbackSpeed, viewMode]);

  return (
    <div className="card wide-card">
      <div className="card-title">{symbol} Price Chart</div>
      <div className="chart-controls">
        <div className="control-group">
          <div className="control-label">Тип графика</div>
          <div className="segmented-control">
            <button
              className={chartType === 'candles' ? 'active' : ''}
              onClick={() => setChartType('candles')}
            >
              Свечи
            </button>
            <button
              className={chartType === 'line' ? 'active' : ''}
              onClick={() => setChartType('line')}
            >
              Линия
            </button>
          </div>
        </div>
        <div className="control-group">
          <div className="control-label">Режим</div>
          <div className="segmented-control">
            <button
              className={viewMode === 'realtime' ? 'active' : ''}
              onClick={() => {
                setViewMode('realtime');
                setIsPlaying(false);
                setVisibleCount(aggregatedCandles.length);
              }}
            >
              Realtime
            </button>
            <button
              className={viewMode === 'historical' ? 'active' : ''}
              onClick={() => {
                setViewMode('historical');
                setIsPlaying(false);
              }}
            >
              История
            </button>
          </div>
        </div>
        <div className="control-group">
          <div className="control-label">Период окна</div>
          <select
            value={windowMinutes}
            onChange={(event) => setWindowMinutes(Number(event.target.value))}
          >
            <option value={15}>15 минут</option>
            <option value={60}>1 час</option>
            <option value={240}>4 часа</option>
            <option value={1440}>24 часа</option>
          </select>
        </div>
        {viewMode === 'historical' && (
          <div className="control-stack">
            <div className="control-label">Воспроизведение</div>
            <div className="playback-row">
              <button
                className="ghost-button"
                onClick={() => setIsPlaying((prev) => !prev)}
              >
                {isPlaying ? 'Пауза' : 'Пуск'}
              </button>
              <label className="control-label" htmlFor="speed-select">
                Скорость
              </label>
              <select
                id="speed-select"
                value={playbackSpeed}
                onChange={(event) =>
                  setPlaybackSpeed(Number(event.target.value))
                }
              >
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={4}>4x</option>
              </select>
            </div>
            <div className="slider-row">
              <input
                type="range"
                min={1}
                max={Math.max(1, aggregatedCandles.length)}
                value={visibleCount}
                onChange={(event) =>
                  setVisibleCount(Number(event.target.value))
                }
              />
              <span className="control-label">
                Кадров: {visibleCount} / {aggregatedCandles.length}
              </span>
            </div>
          </div>
        )}
        <div className="control-group range-label">
          <div className="control-label">Диапазон</div>
          <div className="range-text">{visibleRangeLabel}</div>
        </div>
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
    const high = Math.max(open, close) + (Math.random() * volatility) / 2;
    const low = Math.min(open, close) - (Math.random() * volatility) / 2;

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
