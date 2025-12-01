import type { InstrumentProfile, PlaybackSpeed } from '@/types/ManualTrading';

// Exchange and instrument configuration
export const exchanges = ['Binance', 'Bybit', 'OKX', 'Bitget'] as const;

export const instruments = [
  'BTC/USDT',
  'ETH/USDT',
  'SOL/USDT',
  'XRP/USDT',
] as const;

// Playback speed configuration
export const playbackSpeeds: readonly PlaybackSpeed[] = [
  '0.25x',
  '0.5x',
  '1x',
  '2x',
  '4x',
] as const;

export const playbackSpeedMultiplier: Record<PlaybackSpeed, number> = {
  '0.25x': 0.25,
  '0.5x': 0.5,
  '1x': 1,
  '2x': 2,
  '4x': 4,
};

// Instrument profiles for market data simulation
export const instrumentProfiles: Record<string, InstrumentProfile> = {
  'BTC/USDT': { basePrice: 65100, volatility: 26, baseVolume: 1250 },
  'ETH/USDT': { basePrice: 2860, volatility: 9, baseVolume: 820 },
  'SOL/USDT': { basePrice: 158, volatility: 2.1, baseVolume: 640 },
  'XRP/USDT': { basePrice: 0.52, volatility: 0.006, baseVolume: 420 },
};

// Orderbook configuration
export const ORDERBOOK_DEPTH = 12;
