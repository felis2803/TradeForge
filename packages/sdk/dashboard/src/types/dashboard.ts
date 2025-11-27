// Dashboard type definitions

export interface BotInfo {
  id: string;
  name: string;
  symbol: string;
  strategy?: string;
}

export interface BotState {
  symbol: string;
  balance: bigint;
  position: bigint;
  unrealizedPnL: bigint;
  orders: Map<string, Order>;
}

export interface MarketData {
  currentPrice: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  bid?: number;
  ask?: number;
}

export interface Order {
  id: string;
  type: 'LIMIT' | 'MARKET';
  side: 'BUY' | 'SELL';
  price: bigint;
  qty: bigint;
  filled: bigint;
  status: string;
}

export interface Trade {
  ts: number;
  price: bigint;
  qty: bigint;
  side: 'BUY' | 'SELL';
}

export interface Fill {
  orderId: string;
  side: 'BUY' | 'SELL';
  price: bigint;
  qty: bigint;
  ts: number;
}

export interface BotData {
  info: BotInfo;
  state: BotState;
  marketData?: MarketData;
  trades: Trade[];
  fills: Fill[];
}

export type OrderMessageData = {
  id: string;
  type: 'LIMIT' | 'MARKET';
  side: 'BUY' | 'SELL';
  price: number | string | bigint;
  qty: number | string | bigint;
  filled: number | string | bigint;
  status: string;
};

export type InitMessageData = {
  symbol: string;
  balance: number | string | bigint;
  position: number | string | bigint;
  unrealizedPnL: number | string | bigint;
  orders?: OrderMessageData[];
};

export type TradeMessageData = {
  ts: number;
  price: number | string | bigint;
  qty: number | string | bigint;
  side: 'BUY' | 'SELL';
};

export type FillMessageData = {
  orderId: string;
  side: 'BUY' | 'SELL';
  price: number | string | bigint;
  qty: number | string | bigint;
  ts: number;
};

export type BalanceMessageData = {
  balance: number | string | bigint;
  position: number | string | bigint;
  unrealizedPnL: number | string | bigint;
};

export type WebSocketMessage =
  | { type: 'botList'; data: BotInfo[] }
  | { type: 'botRegistered'; data: BotInfo }
  | { type: 'botUnregistered'; data: { id: string } }
  | { type: 'init'; botId: string; data: InitMessageData }
  | { type: 'trade'; botId: string; data: TradeMessageData }
  | { type: 'orderUpdate'; botId: string; data: OrderMessageData }
  | { type: 'fill'; botId: string; data: FillMessageData }
  | { type: 'balance'; botId: string; data: BalanceMessageData };

export type ViewMode = 'overview' | 'detail';
