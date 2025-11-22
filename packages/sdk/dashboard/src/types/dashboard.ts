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

export interface WebSocketMessage {
    type: string;
    botId?: string;
    data: any;
}

export type ViewMode = 'overview' | 'detail';
