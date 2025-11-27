interface HeaderProps {
  connected: boolean;
  botCount: number;
}

export function Header({ connected, botCount }: HeaderProps) {
  return (
    <header className="header">
      <h1>🚀 TradeForge Multi-Bot Dashboard</h1>
      <div className="status-badge">
        <span className={`status-dot ${connected ? 'connected' : ''}`}></span>
        <span>{connected ? 'Connected' : 'Disconnected'}</span>
        <span className="bot-count">
          {botCount} Bot{botCount !== 1 ? 's' : ''}
        </span>
      </div>
    </header>
  );
}
