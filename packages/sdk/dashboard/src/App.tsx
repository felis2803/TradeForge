import { useState } from 'react';
import { Header } from './components/Header';
import { ViewToggle } from './components/ViewToggle';
import { BotOverview } from './components/BotOverview';
import { BotDetail } from './components/BotDetail';
import { useWebSocket } from './hooks/useWebSocket';
import type { ViewMode } from './types/dashboard';
import './styles.css';

export function App() {
  const { bots, connected } = useWebSocket();
  const [view, setView] = useState<ViewMode>('overview');
  const [activeBotId, setActiveBotId] = useState<string | null>(null);

  const handleBotSelect = (botId: string) => {
    setActiveBotId(botId);
    setView('detail');
  };

  const activeBot = activeBotId ? bots.get(activeBotId) || null : null;

  return (
    <div className="container">
      <Header connected={connected} botCount={bots.size} />
      <ViewToggle view={view} onViewChange={setView} />

      {view === 'overview' ? (
        <BotOverview bots={bots} onBotSelect={handleBotSelect} />
      ) : (
        <BotDetail bot={activeBot} bots={bots} onBotChange={setActiveBotId} />
      )}
    </div>
  );
}
