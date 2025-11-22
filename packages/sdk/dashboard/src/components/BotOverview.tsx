import type { BotData } from '../types/dashboard';

interface BotOverviewProps {
    bots: Map<string, BotData>;
    onBotSelect: (botId: string) => void;
}

export function BotOverview({ bots, onBotSelect }: BotOverviewProps) {
    if (bots.size === 0) {
        return (
            <div className="bot-overview">
                <div className="empty-state">No bots connected yet...</div>
            </div>
        );
    }

    return (
        <div className="bot-overview">
            {Array.from(bots.entries()).map(([botId, bot]) => (
                <div
                    key={botId}
                    className="bot-card"
                    onClick={() => onBotSelect(botId)}
                >
                    <div className="bot-card-header">
                        <div>
                            <div className="bot-name">{bot.info.name}</div>
                            <div className="bot-symbol">{bot.info.symbol}</div>
                        </div>
                        <span className="bot-status-indicator"></span>
                    </div>
                    {bot.info.strategy && (
                        <div className="bot-strategy">{bot.info.strategy}</div>
                    )}
                    <div className="bot-stats">
                        <div className="bot-stat">
                            <div className="bot-stat-label">Balance</div>
                            <div className="bot-stat-value">
                                {formatBigInt(bot.state.balance, 2)} USDT
                            </div>
                        </div>
                        <div className="bot-stat">
                            <div className="bot-stat-label">Position</div>
                            <div className="bot-stat-value">
                                {formatBigInt(bot.state.position, 5)}
                            </div>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

// Helper function to format bigint values
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
