import { useEffect, useState, useCallback, useRef } from 'react';
import type { BotData, BotInfo, WebSocketMessage, Trade } from '../types/dashboard';

export function useWebSocket() {
    const [bots, setBots] = useState<Map<string, BotData>>(new Map());
    const [connected, setConnected] = useState(false);
    const wsRef = useRef<WebSocket | null>(null);

    const handleMessage = useCallback((msg: WebSocketMessage) => {
        const botId = msg.botId;

        switch (msg.type) {
            case 'botList':
                // Initialize all bots
                setBots((prevBots) => {
                    const newBots = new Map(prevBots);
                    (msg.data as BotInfo[]).forEach((botInfo) => {
                        if (!newBots.has(botInfo.id)) {
                            newBots.set(botInfo.id, {
                                info: botInfo,
                                state: {
                                    symbol: botInfo.symbol,
                                    balance: 0n,
                                    position: 0n,
                                    unrealizedPnL: 0n,
                                    orders: new Map(),
                                },
                                trades: [],
                                fills: [],
                            });
                        }
                    });
                    return newBots;
                });
                break;

            case 'botRegistered':
                setBots((prevBots) => {
                    const newBots = new Map(prevBots);
                    newBots.set(msg.data.id, {
                        info: msg.data,
                        state: {
                            symbol: msg.data.symbol,
                            balance: 0n,
                            position: 0n,
                            unrealizedPnL: 0n,
                            orders: new Map(),
                        },
                        trades: [],
                        fills: [],
                    });
                    return newBots;
                });
                break;

            case 'botUnregistered':
                setBots((prevBots) => {
                    const newBots = new Map(prevBots);
                    newBots.delete(msg.data.id);
                    return newBots;
                });
                break;

            case 'init':
                if (!botId) return;
                setBots((prevBots) => {
                    const newBots = new Map(prevBots);
                    const bot = newBots.get(botId);
                    if (bot) {
                        bot.state.symbol = msg.data.symbol;
                        bot.state.balance = BigInt(msg.data.balance);
                        bot.state.position = BigInt(msg.data.position);
                        bot.state.unrealizedPnL = BigInt(msg.data.unrealizedPnL);
                        if (msg.data.orders) {
                            msg.data.orders.forEach((order: any) => {
                                bot.state.orders.set(order.id, {
                                    ...order,
                                    price: BigInt(order.price),
                                    qty: BigInt(order.qty),
                                    filled: BigInt(order.filled),
                                });
                            });
                        }
                    }
                    return newBots;
                });
                break;

            case 'trade': {
                if (!botId) return;
                setBots((prevBots) => {
                    const newBots = new Map(prevBots);
                    const bot = newBots.get(botId);
                    if (!bot) return newBots;

                    const trade: Trade = {
                        ts: msg.data.ts,
                        price: BigInt(msg.data.price),
                        qty: BigInt(msg.data.qty),
                        side: msg.data.side,
                    };

                    // Create NEW array instead of mutating (for React to detect change)
                    bot.trades = [trade, ...bot.trades];
                    if (bot.trades.length > 1000) {
                        bot.trades = bot.trades.slice(0, 1000);
                    }
                    newBots.set(botId, { ...bot });
                    return newBots;
                });
                break;
            }

            case 'orderUpdate': {
                if (!botId) return;
                setBots((prevBots) => {
                    const newBots = new Map(prevBots);
                    const bot = newBots.get(botId);
                    if (!bot) return newBots;

                    const order = msg.data;
                    if (order.status === 'FILLED' || order.status === 'CANCELED') {
                        bot.state.orders.delete(order.id);
                    } else {
                        bot.state.orders.set(order.id, {
                            ...order,
                            price: BigInt(order.price),
                            qty: BigInt(order.qty),
                            filled: BigInt(order.filled),
                        });
                    }
                    return newBots;
                });
                break;
            }

            case 'fill':
                if (!botId) return;
                setBots((prevBots) => {
                    const newBots = new Map(prevBots);
                    const bot = newBots.get(botId);
                    if (bot) {
                        bot.fills.unshift({
                            ...msg.data,
                            price: BigInt(msg.data.price),
                            qty: BigInt(msg.data.qty),
                        });
                        if (bot.fills.length > 50) {
                            bot.fills.pop();
                        }
                    }
                    return newBots;
                });
                break;

            case 'balance':
                if (!botId) return;
                setBots((prevBots) => {
                    const newBots = new Map(prevBots);
                    const bot = newBots.get(botId);
                    if (bot) {
                        bot.state.balance = BigInt(msg.data.balance);
                        bot.state.position = BigInt(msg.data.position);
                        bot.state.unrealizedPnL = BigInt(msg.data.unrealizedPnL);
                    }
                    return newBots;
                });
                break;
        }
    }, []);

    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log('WebSocket connected');
            setConnected(true);
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data) as WebSocketMessage;
                handleMessage(message);
            } catch (err) {
                console.error('Failed to parse message:', err);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        ws.onclose = () => {
            console.log('WebSocket disconnected');
            setConnected(false);
            // Reconnect after 2 seconds
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        };

        return () => {
            ws.close();
        };
    }, [handleMessage]);

    return { bots, connected };
}
