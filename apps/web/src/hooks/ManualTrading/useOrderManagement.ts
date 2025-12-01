import { FormEvent } from 'react';
import type {
  Order,
  Position,
  TradeRow,
  PlaybackSpeed,
  DataMode,
} from '@/types/ManualTrading';
import { computeLiqPrice, getProfile } from '@/utils/ManualTrading';
import { buildTradeRow, sortTrades } from '@/utils/ManualTrading';

interface UseOrderManagementProps {
  selectedInstrument: string;
  selectedExchange: string;
  balance: number;
  dataMode: DataMode;
  periodStart: string;
  periodEnd: string;
  playbackSpeed: PlaybackSpeed;
  orderType: string;
  orderSize: number;
  orderPrice: number;
  markPrices: Record<string, number>;
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  setPositions: React.Dispatch<React.SetStateAction<Position[]>>;
  setPositionEvents: React.Dispatch<
    React.SetStateAction<{ id: string; message: string; timestamp: Date }[]>
  >;
  setTrades: React.Dispatch<React.SetStateAction<TradeRow[]>>;
  setConnectionMessage: (message: string) => void;
  setConnectionError: (error: string | null) => void;
  setIsPaused: (paused: boolean) => void;
  resetStreams: () => void;
  setLastUpdateAt: (date: Date) => void;
}

/**
 * Custom hook for order and position management
 * Handles order submission, position closing/reversing, and connection management
 */
export function useOrderManagement({
  selectedInstrument,
  selectedExchange,
  balance,
  dataMode,
  periodStart,
  periodEnd,
  playbackSpeed,
  orderType,
  orderSize,
  orderPrice,
  markPrices,
  setOrders,
  setPositions,
  setPositionEvents,
  setTrades,
  setConnectionMessage,
  setConnectionError,
  setIsPaused,
  resetStreams,
  setLastUpdateAt,
}: UseOrderManagementProps) {
  // Get mark price for an instrument
  const markPriceForInstrument = (instrument: string) =>
    markPrices[instrument] ?? getProfile(instrument).basePrice;

  // Record a synthetic trade
  const recordSyntheticTrade = (
    instrument: string,
    side: TradeRow['side'],
    size: number,
    price?: number,
  ) => {
    const tradePrice = price ?? markPriceForInstrument(instrument);
    const timestamp = Date.now();
    const tradeRow = buildTradeRow({
      timestamp,
      side,
      price: tradePrice,
      size: Number(Math.abs(size).toFixed(3)),
    });
    setTrades((previous) => sortTrades([tradeRow, ...previous]).slice(0, 12));
  };

  // Add position event to log
  const addPositionEvent = (message: string) => {
    setPositionEvents((previous) =>
      [
        { id: `evt-${Date.now()}`, message, timestamp: new Date() },
        ...previous,
      ].slice(0, 6),
    );
  };

  // Handle connection to data stream
  const handleConnect = () => {
    setConnectionError(null);
    setIsPaused(false);

    if (balance <= 0) {
      setConnectionError('Введите положительный стартовый баланс');
      return;
    }

    if (dataMode === 'history') {
      if (!periodStart || !periodEnd) {
        setConnectionError('Укажите дату и время начала и окончания периода');
        return;
      }

      const start = new Date(periodStart);
      const end = new Date(periodEnd);

      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        setConnectionError('Некорректный формат периода');
        return;
      }

      if (start >= end) {
        setConnectionError('Дата начала должна быть раньше даты окончания');
        return;
      }

      if (!playbackSpeed) {
        setConnectionError('Выберите скорость воспроизведения');
        return;
      }

      setConnectionMessage(
        `Историческое воспроизведение: ${start.toLocaleString('ru-RU')} → ${end.toLocaleString('ru-RU')} @ ${playbackSpeed}. Стартовый баланс: ${balance.toLocaleString('ru-RU')} USDT`,
      );
      return;
    }

    setConnectionMessage(
      `Realtime поток на ${selectedExchange}. Баланс и позиции инициализированы на ${balance.toLocaleString('ru-RU')} USDT`,
    );
  };

  // Resume data stream
  const handleResumeStream = () => {
    setIsPaused(false);
    resetStreams();
    setConnectionMessage('Поток данных восстановлен');
    setLastUpdateAt(new Date());
  };

  // Toggle pause state
  const handleTogglePause = () => {
    setIsPaused((previous) => {
      const next = !previous;
      if (next) {
        setConnectionMessage('Воспроизведение поставлено на паузу');
      } else {
        resetStreams();
        setConnectionMessage('Воспроизведение возобновлено');
        setLastUpdateAt(new Date());
      }
      return next;
    });
  };

  // Submit order
  const handleSubmitOrder = (event: FormEvent) => {
    event.preventDefault();
    const id = `ord-${Date.now()}`;
    const markPrice = markPriceForInstrument(selectedInstrument);
    let updatedPosition: Position | null = null;

    setOrders((prev) => [
      {
        id,
        instrument: selectedInstrument,
        type:
          orderType === 'market'
            ? 'Market'
            : orderType === 'stop'
              ? 'Stop'
              : 'Limit',
        size: orderSize,
        price: orderType === 'market' ? undefined : orderPrice,
        status: 'active',
      },
      ...prev,
    ]);

    setPositions((prev) => {
      const existing = prev.find(
        (pos) => pos.instrument === selectedInstrument,
      );
      if (existing) {
        const nextSize = existing.size + orderSize;
        const nextAvg =
          orderType === 'market'
            ? existing.avgPrice
            : (existing.avgPrice * existing.size + orderPrice * orderSize) /
              nextSize;
        updatedPosition = {
          ...existing,
          size: nextSize,
          avgPrice: nextAvg,
          liqPrice: computeLiqPrice(nextAvg, nextSize, markPrice),
        };
        return prev.map((pos) =>
          pos.instrument === selectedInstrument ? updatedPosition! : pos,
        );
      }
      const nextPosition: Position = {
        instrument: selectedInstrument,
        size: orderSize,
        avgPrice: orderPrice,
        liqPrice: computeLiqPrice(orderPrice, orderSize, markPrice),
      };
      updatedPosition = nextPosition;
      return [nextPosition, ...prev];
    });

    if (updatedPosition) {
      addPositionEvent(
        `Позиция ${updatedPosition.instrument} обновлена: ${updatedPosition.size.toFixed(3)} @ ${updatedPosition.avgPrice.toLocaleString('ru-RU')}`,
      );
    }
  };

  // Close position
  const handleClosePosition = (instrument: string) => {
    const markPrice = markPriceForInstrument(instrument);
    setPositions((previous) => {
      const existing = previous.find((pos) => pos.instrument === instrument);
      if (!existing) return previous;
      recordSyntheticTrade(
        instrument,
        existing.size >= 0 ? 'sell' : 'buy',
        Math.abs(existing.size),
        markPrice,
      );
      addPositionEvent(
        `Позиция ${instrument} закрыта по ${markPrice.toLocaleString('ru-RU')}`,
      );
      return previous.filter((pos) => pos.instrument !== instrument);
    });
  };

  // Reverse position
  const handleReversePosition = (instrument: string) => {
    const markPrice = markPriceForInstrument(instrument);
    let originalSize: number | null = null;

    setPositions((previous) =>
      previous.map((pos) => {
        if (pos.instrument !== instrument) return pos;
        originalSize = pos.size;
        const nextSize = -pos.size;
        return {
          ...pos,
          size: nextSize,
          avgPrice: markPrice,
          liqPrice: computeLiqPrice(markPrice, nextSize, markPrice),
        };
      }),
    );

    if (originalSize === null) return;

    const closingSide = originalSize > 0 ? 'sell' : 'buy';
    const openingSide = originalSize > 0 ? 'buy' : 'sell';
    recordSyntheticTrade(
      instrument,
      closingSide,
      Math.abs(originalSize),
      markPrice,
    );
    recordSyntheticTrade(
      instrument,
      openingSide,
      Math.abs(originalSize),
      markPrice,
    );
    addPositionEvent(
      `Позиция ${instrument} развернута: ${(-originalSize).toFixed(3)} @ ${markPrice.toLocaleString('ru-RU')}`,
    );
  };

  return {
    markPriceForInstrument,
    recordSyntheticTrade,
    addPositionEvent,
    handleConnect,
    handleResumeStream,
    handleTogglePause,
    handleSubmitOrder,
    handleClosePosition,
    handleReversePosition,
  };
}
