import { useState, useEffect } from 'react';
import type { Order, Position, TradeRow } from '@/types/ManualTrading';
import { computeLiqPrice } from '@/utils/ManualTrading';
import { instruments } from '@/utils/ManualTrading/constants';

interface UseQuickActionsProps {
  selectedInstrument: string;
  balance: number;
  markPriceForInstrument: (instrument: string) => number;
  setOrderSize: (size: number) => void;
  setOrderPrice: (price: number) => void;
  setOrderType: (type: string) => void;
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  setPositions: React.Dispatch<React.SetStateAction<Position[]>>;
  recordSyntheticTrade: (
    instrument: string,
    side: TradeRow['side'],
    size: number,
    price?: number,
  ) => void;
  addPositionEvent: (message: string) => void;
}

/**
 * Custom hook for Quick Actions functionality
 * Handles preset selection, quick market orders, and orderbook click-to-fill
 */
export function useQuickActions({
  selectedInstrument,
  balance,
  markPriceForInstrument,
  setOrderSize,
  setOrderPrice,
  setOrderType,
  setOrders,
  setPositions,
  recordSyntheticTrade,
  addPositionEvent,
}: UseQuickActionsProps) {
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [showHotkeys, setShowHotkeys] = useState(true);
  const [recentInstruments, setRecentInstruments] = useState<string[]>(() => {
    const saved = localStorage.getItem('manual-trading:recent-instruments');
    return saved ? JSON.parse(saved) : [instruments[0]];
  });

  // Calculate order size based on percentage of balance
  const calculatePresetSize = (percentage: number): number => {
    const markPrice = markPriceForInstrument(selectedInstrument);
    const sizeInUsdt = balance * (percentage / 100);
    return Number((sizeInUsdt / markPrice).toFixed(3));
  };

  // Handle preset button click
  const handlePresetClick = (percentage: number) => {
    setSelectedPreset(percentage);
    const size = calculatePresetSize(percentage);
    setOrderSize(size);
  };

  // Execute quick market order with selected preset
  const handleQuickMarketOrder = (side: 'buy' | 'sell', preset: number) => {
    const size = calculatePresetSize(preset);
    const markPrice = markPriceForInstrument(selectedInstrument);
    const id = `ord-${Date.now()}`;

    setOrders((prev) => [
      {
        id,
        instrument: selectedInstrument,
        type: 'Market',
        size: side === 'sell' ? -size : size,
        price: undefined,
        status: 'active',
      },
      ...prev,
    ]);

    setPositions((prev) => {
      const existing = prev.find(
        (pos) => pos.instrument === selectedInstrument,
      );
      const orderSize = side === 'sell' ? -size : size;

      if (existing) {
        const nextSize = existing.size + orderSize;
        const nextAvg =
          (existing.avgPrice * existing.size + markPrice * orderSize) /
          nextSize;
        const updatedPosition = {
          ...existing,
          size: nextSize,
          avgPrice: nextAvg,
          liqPrice: computeLiqPrice(nextAvg, nextSize, markPrice),
        };
        addPositionEvent(
          `Quick ${side.toUpperCase()}: ${size.toFixed(3)} ${selectedInstrument} @ ${markPrice.toLocaleString('ru-RU')}`,
        );
        return prev.map((pos) =>
          pos.instrument === selectedInstrument ? updatedPosition : pos,
        );
      }

      const nextPosition: Position = {
        instrument: selectedInstrument,
        size: orderSize,
        avgPrice: markPrice,
        liqPrice: computeLiqPrice(markPrice, orderSize, markPrice),
      };
      addPositionEvent(
        `Quick ${side.toUpperCase()}: ${size.toFixed(3)} ${selectedInstrument} @ ${markPrice.toLocaleString('ru-RU')}`,
      );
      return [nextPosition, ...prev];
    });

    recordSyntheticTrade(selectedInstrument, side, size, markPrice);
  };

  // Handle orderbook price click - auto-fill order form
  const handleOrderbookPriceClick = (price: number) => {
    setOrderPrice(price);
    setOrderType('limit');
  };

  // Track recent instruments
  useEffect(() => {
    setRecentInstruments((prev) => {
      if (prev[0] === selectedInstrument) return prev;
      const updated = [
        selectedInstrument,
        ...prev.filter((item) => item !== selectedInstrument),
      ].slice(0, 5);
      localStorage.setItem(
        'manual-trading:recent-instruments',
        JSON.stringify(updated),
      );
      return updated;
    });
  }, [selectedInstrument]);

  return {
    selectedPreset,
    setSelectedPreset,
    showHotkeys,
    setShowHotkeys,
    recentInstruments,
    calculatePresetSize,
    handlePresetClick,
    handleQuickMarketOrder,
    handleOrderbookPriceClick,
  };
}
