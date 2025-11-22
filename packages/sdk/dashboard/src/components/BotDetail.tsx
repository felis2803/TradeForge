import { PriceChart } from './PriceChart';
import type { BotData } from '../types/dashboard';

interface BotDetailProps {
    bot: BotData | null;
    bots: Map<string, BotData>;
    onBotChange: (botId: string) => void;
}

export function BotDetail({ bot, bots, onBotChange }: BotDetailProps) {
    if (!bot) {
        return (
            <div className="bot-detail">
                <div className="empty-state">Select a bot to view details</div>
            </div>
        );
    }

    return (
        <div className="bot-detail">
            {/* Bot selection tabs */}
            <div className="bot-tabs">
                {Array.from(bots.entries()).map(([botId, botData]) => (
                    <div
                        key={botId}
                        className={`bot-tab ${bot.info.id === botId ? 'active' : ''}`}
                        onClick={() => onBotChange(botId)}
                    >
                        <span className="bot-status-indicator"></span>
                        <span>{botData.info.name}</span>
                    </div>
                ))}
            </div>

            {/* Bot stats grid */}
            <div className="grid">
                {/* Bot Info */}
                <div className="card">
                    <div className="card-title">Bot Information</div>
                    <div className="stat-value">
                        <span className="symbol-tag">{bot.state.symbol}</span>
                    </div>
                    <div className="stat-label">
                        {bot.info.strategy || 'No strategy'}
                    </div>
                </div>

                {/* Balance */}
                <div className="card">
                    <div className="card-title">Quote Balance</div>
                    <div className="stat-value neutral">
                        {formatBigInt(bot.state.balance, 2)}
                    </div>
                    <div className="stat-label">USDT</div>
                </div>

                {/* Position */}
                <div className="card">
                    <div className="card-title">Position</div>
                    <div className="stat-value neutral">
                        {formatBigInt(bot.state.position, 5)}
                    </div>
                    <div className="stat-label">{bot.state.symbol.replace('USDT', '')}</div>
                </div>

                {/* Unrealized P/L */}
                <div className="card">
                    <div className="card-title">Unrealized P/L</div>
                    <div
                        className={`stat-value ${bot.state.unrealizedPnL > 0n
                            ? 'positive'
                            : bot.state.unrealizedPnL < 0n
                                ? 'negative'
                                : 'neutral'
                            }`}
                    >
                        {formatBigInt(bot.state.unrealizedPnL, 2)}
                    </div>
                    <div className="stat-label">USDT</div>
                </div>

                {/* Price Chart */}
                <PriceChart
                    symbol={bot.state.symbol}
                    trades={bot.trades}
                />

                {/* Active Orders */}
                <div className="card wide-card">
                    <div className="card-title">Active Orders</div>
                    <div className="scroll-container">
                        {bot.state.orders.size === 0 ? (
                            <div className="empty-state">No active orders</div>
                        ) : (
                            <table>
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>Type</th>
                                        <th>Side</th>
                                        <th>Price</th>
                                        <th>Quantity</th>
                                        <th>Filled</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Array.from(bot.state.orders.values()).map((order) => (
                                        <tr key={order.id}>
                                            <td>{order.id.substring(0, 8)}</td>
                                            <td>
                                                <span
                                                    className={`badge badge-${order.type.toLowerCase()}`}
                                                >
                                                    {order.type}
                                                </span>
                                            </td>
                                            <td>
                                                <span
                                                    className={`badge badge-${order.side.toLowerCase()}`}
                                                >
                                                    {order.side}
                                                </span>
                                            </td>
                                            <td>{formatBigInt(order.price, 2)}</td>
                                            <td>{formatBigInt(order.qty, 5)}</td>
                                            <td>{formatBigInt(order.filled, 5)}</td>
                                            <td>{order.status}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                {/* Recent Trades */}
                <div className="card wide-card">
                    <div className="card-title">Recent Market Trades</div>
                    <div className="scroll-container">
                        {bot.trades.length === 0 ? (
                            <div className="empty-state">Waiting for trades...</div>
                        ) : (
                            bot.trades.map((trade, idx) => (
                                <div key={idx} className="feed-item">
                                    <div className="feed-header">
                                        <span
                                            className={`badge badge-${trade.side.toLowerCase()}`}
                                        >
                                            {trade.side}
                                        </span>
                                        <span className="feed-time">
                                            {new Date(trade.ts).toLocaleTimeString()}
                                        </span>
                                    </div>
                                    <div className="feed-content">
                                        {formatBigInt(trade.qty, 5)} @ {formatBigInt(trade.price, 2)}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Order Fills */}
                <div className="card wide-card">
                    <div className="card-title">Order Fills</div>
                    <div className="scroll-container">
                        {bot.fills.length === 0 ? (
                            <div className="empty-state">No fills yet</div>
                        ) : (
                            bot.fills.map((fill, idx) => (
                                <div key={idx} className="feed-item">
                                    <div className="feed-header">
                                        <span className={`badge badge-${fill.side.toLowerCase()}`}>
                                            {fill.side}
                                        </span>
                                        <span className="feed-time">
                                            {new Date(fill.ts).toLocaleTimeString()}
                                        </span>
                                    </div>
                                    <div className="feed-content">
                                        Order {fill.orderId.substring(0, 8)}: {formatBigInt(fill.qty, 5)} @{' '}
                                        {formatBigInt(fill.price, 2)}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function formatBigInt(value: bigint, decimals: number): string {
    // Calculate divisor using pure BigInt arithmetic to avoid mixing BigInt and Number
    let divisor = 1n;
    for (let i = 0; i < decimals; i++) {
        divisor *= 10n;
    }

    const intPart = value / divisor;
    const fracPart = value % divisor;
    const fracStr = fracPart.toString().padStart(decimals, '0');
    return `${intPart}.${fracStr}`;
}
