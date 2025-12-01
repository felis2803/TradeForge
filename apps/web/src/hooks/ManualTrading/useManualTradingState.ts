import { useState, useEffect } from 'react';
import type {
  Order,
  Position,
  PlaybackSpeed,
  DataMode,
} from '@/types/ManualTrading';
import { exchanges, instruments, playbackSpeeds } from '@/utils/ManualTrading';

/**
 * Main state management hook for Manual Trading
 * Handles all component state and localStorage persistence
 */
export function useManualTradingState() {
  const [selectedExchange, setSelectedExchange] = useState(exchanges[0]);
  const [dataMode, setDataMode] = useState<DataMode>('history');
  const [periodStart, setPeriodStart] = useState('2024-05-01T09:00');
  const [periodEnd, setPeriodEnd] = useState('2024-05-15T18:00');
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(
    playbackSpeeds[2],
  );
  const [balance, setBalance] = useState(10000);
  const [selectedInstrument, setSelectedInstrument] = useState(instruments[0]);
  const [orderType, setOrderType] = useState('limit');
  const [orderSize, setOrderSize] = useState(0.1);
  const [orderPrice, setOrderPrice] = useState(65000);
  const [orders, setOrders] = useState<Order[]>([
    {
      id: 'ord-1',
      type: 'Limit',
      instrument: 'BTC/USDT',
      size: 0.25,
      price: 64850,
      status: 'active',
    },
    {
      id: 'ord-2',
      type: 'Stop',
      instrument: 'ETH/USDT',
      size: 5,
      price: 2850,
      status: 'filled',
    },
  ]);
  const [positions, setPositions] = useState<Position[]>([
    { instrument: 'BTC/USDT', size: 0.5, avgPrice: 64600, liqPrice: 52000 },
    { instrument: 'SOL/USDT', size: 120, avgPrice: 158, liqPrice: 96 },
  ]);
  const [markPrices, setMarkPrices] = useState<Record<string, number>>({});
  const [positionEvents, setPositionEvents] = useState<
    { id: string; message: string; timestamp: Date }[]
  >([]);
  const [connectionMessage, setConnectionMessage] = useState<string>('');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [dataUnavailable, setDataUnavailable] = useState(false);
  const [lastUpdateAt, setLastUpdateAt] = useState<Date | null>(null);

  // Load saved connection settings from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('manual-trading:connection');
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved) as {
        selectedExchange?: string;
        dataMode?: DataMode;
        periodStart?: string;
        periodEnd?: string;
        playbackSpeed?: PlaybackSpeed;
        balance?: number;
      };

      if (
        parsed.selectedExchange &&
        exchanges.includes(parsed.selectedExchange)
      ) {
        setSelectedExchange(parsed.selectedExchange);
      }
      if (parsed.dataMode === 'history' || parsed.dataMode === 'realtime') {
        setDataMode(parsed.dataMode);
      }
      if (parsed.periodStart) {
        setPeriodStart(parsed.periodStart);
      }
      if (parsed.periodEnd) {
        setPeriodEnd(parsed.periodEnd);
      }
      if (
        parsed.playbackSpeed &&
        playbackSpeeds.includes(parsed.playbackSpeed)
      ) {
        setPlaybackSpeed(parsed.playbackSpeed);
      }
      if (typeof parsed.balance === 'number' && parsed.balance > 0) {
        setBalance(parsed.balance);
      }
    } catch (error) {
      console.warn('Failed to restore connection settings', error);
    }
  }, []);

  // Save connection settings to localStorage
  useEffect(() => {
    const payload = {
      selectedExchange,
      dataMode,
      periodStart,
      periodEnd,
      playbackSpeed,
      balance,
    };
    localStorage.setItem('manual-trading:connection', JSON.stringify(payload));
  }, [
    balance,
    dataMode,
    periodEnd,
    periodStart,
    playbackSpeed,
    selectedExchange,
  ]);

  return {
    // Exchange & data settings
    selectedExchange,
    setSelectedExchange,
    dataMode,
    setDataMode,
    periodStart,
    setPeriodStart,
    periodEnd,
    setPeriodEnd,
    playbackSpeed,
    setPlaybackSpeed,

    // Trading state
    balance,
    setBalance,
    selectedInstrument,
    setSelectedInstrument,
    orderType,
    setOrderType,
    orderSize,
    setOrderSize,
    orderPrice,
    setOrderPrice,
    orders,
    setOrders,
    positions,
    setPositions,
    markPrices,
    setMarkPrices,
    positionEvents,
    setPositionEvents,

    // Connection state
    connectionMessage,
    setConnectionMessage,
    connectionError,
    setConnectionError,
    isPaused,
    setIsPaused,
    dataUnavailable,
    setDataUnavailable,
    lastUpdateAt,
    setLastUpdateAt,
  };
}
