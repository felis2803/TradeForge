import { useState, useEffect, useRef } from 'react';
import {
  createTickerSnapshot,
  seedTrades,
  seedOrderBook,
  seedChart,
  mutateTicker,
  mutateTrades,
  mutateOrderBook,
  mutateChart,
} from '@/utils/ManualTrading';

interface UseMarketDataSimulationProps {
  selectedInstrument: string;
  dataMode: DataMode;
  isPaused: boolean;
  dataUnavailable: boolean;
  updateIntervalMs: number;
}

/**
 * Custom hook for market data simulation
 * Manages ticker, trades, orderbook, and chart data streams
 */
export function useMarketDataSimulation({
  selectedInstrument,
  dataMode,
  isPaused,
  dataUnavailable,
  updateIntervalMs,
}: UseMarketDataSimulationProps) {
  const [ticker, setTicker] = useState<TickerSnapshot>(() =>
    createTickerSnapshot(selectedInstrument),
  );
  const [trades, setTrades] = useState<TradeRow[]>(() =>
    seedTrades(selectedInstrument),
  );
  const [orderBook, setOrderBook] = useState<OrderBookSnapshot>(() =>
    seedOrderBook(selectedInstrument),
  );
  const [syntheticChart, setSyntheticChart] = useState<ChartPoint[]>(() =>
    seedChart(selectedInstrument),
  );
  const [lastUpdateAt, setLastUpdateAt] = useState<Date | null>(null);

  const latestPriceRef = useRef<number>(ticker.last);

  // Reset all streams when instrument changes
  const resetStreams = (instrument = selectedInstrument) => {
    const nextTicker = createTickerSnapshot(instrument);
    latestPriceRef.current = nextTicker.last;
    setTicker(nextTicker);
    setTrades(seedTrades(instrument));
    setOrderBook(seedOrderBook(instrument));
    setSyntheticChart(seedChart(instrument));
    setLastUpdateAt(null);
  };

  // Reset streams on instrument change
  useEffect(() => {
    resetStreams();
  }, [selectedInstrument]);

  // Update latest price ref when ticker changes
  useEffect(() => {
    latestPriceRef.current = ticker.last;
  }, [ticker.last]);

  // Market data update loop
  useEffect(() => {
    if (dataUnavailable || isPaused) return;

    const intervalId = window.setInterval(() => {
      let priceForChildren = latestPriceRef.current;

      setTicker((prev) => {
        const next = mutateTicker(prev, selectedInstrument, dataMode);
        priceForChildren = next.last;
        return next;
      });

      latestPriceRef.current = priceForChildren;

      setTrades((prev) =>
        mutateTrades(prev, selectedInstrument, dataMode, priceForChildren),
      );
      setOrderBook((prev) =>
        mutateOrderBook(prev, selectedInstrument, priceForChildren),
      );
      setSyntheticChart((prev) =>
        mutateChart(prev, selectedInstrument, priceForChildren),
      );
      setLastUpdateAt(new Date());
    }, updateIntervalMs);

    return () => clearInterval(intervalId);
  }, [
    dataUnavailable,
    dataMode,
    isPaused,
    selectedInstrument,
    updateIntervalMs,
  ]);

  return {
    ticker,
    trades,
    orderBook,
    syntheticChart,
    lastUpdateAt,
    setLastUpdateAt,
    resetStreams,
    latestPriceRef,
  };
}
