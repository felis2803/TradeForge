import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { WsClient } from './lib/ws.ts';
import Bots from './pages/Bots.tsx';
import Preflight from './pages/Preflight.tsx';
import RunControl from './pages/RunControl.tsx';

const WsContext = createContext<WsClient | null>(null);

export function useWs(): WsClient {
  const ctx = useContext(WsContext);
  if (!ctx) {
    throw new Error('WebSocket client is not available');
  }
  return ctx;
}

const wsStatusLabel: Record<string, string> = {
  connecting: 'Подключаемся…',
  open: 'Онлайн',
  closed: 'Отключено',
};

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:3001';
const DEFAULT_WS_BASE = API_BASE.replace(/^http/i, 'ws');
const WS_URL =
  (import.meta.env.VITE_WS_URL as string | undefined) ??
  `${DEFAULT_WS_BASE}/ws?role=ui`;

function App(): JSX.Element {
  const wsClient = useMemo(() => new WsClient(WS_URL), []);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');

  useEffect(() => {
    wsClient.connect();

    const offOpen = wsClient.on('open', () => setStatus('open'));
    const offClose = wsClient.on('close', () => setStatus('closed'));
    const offError = wsClient.on('error', () => setStatus('closed'));

    return () => {
      offOpen();
      offClose();
      offError();
      wsClient.disconnect();
    };
  }, [wsClient]);

  return (
    <WsContext.Provider value={wsClient}>
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">TradeForge Sandbox</h1>
              <p className="text-sm text-slate-400">Модуль настройки и контроля единичного запуска</p>
            </div>
            <div className="text-sm text-slate-300">
              WS статус: <span className="font-medium text-slate-100">{wsStatusLabel[status]}</span>
            </div>
          </div>
        </header>
        <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6">
          <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 shadow-lg shadow-slate-900/40">
            <Preflight apiBase={API_BASE} />
          </section>
          <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 shadow-lg shadow-slate-900/40">
            <RunControl apiBase={API_BASE} />
          </section>
          <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 shadow-lg shadow-slate-900/40">
            <Bots apiBase={API_BASE} />
          </section>
        </main>
      </div>
    </WsContext.Provider>
  );
}

export default App;
