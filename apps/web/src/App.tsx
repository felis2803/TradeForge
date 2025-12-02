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
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  'http://localhost:3001';
const DEFAULT_WS_BASE = API_BASE.replace(/^http/i, 'ws');
const WS_URL =
  (import.meta.env.VITE_WS_URL as string | undefined) ??
  `${DEFAULT_WS_BASE}/ws?role=ui`;

function App(): JSX.Element {
  const wsClient = useMemo(() => new WsClient(WS_URL), []);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>(
    'connecting',
  );

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
      <div className="min-h-screen text-text selection:bg-primary/30">
        <header className="sticky top-0 z-50 border-b border-white/5 bg-background/60 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 text-primary shadow-[0_0_15px_rgba(112,0,255,0.3)]">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-6 w-6"
                >
                  <path
                    fillRule="evenodd"
                    d="M9.315 7.584C12.195 3.883 16.695 1.5 21.75 1.5a.75.75 0 01.75.75c0 5.056-2.383 9.555-6.084 12.436h.001c-3.7 2.881-8.199 5.264-13.254 5.264a.75.75 0 01-.75-.75c0-5.055 2.383-9.555 6.084-12.436z"
                    clipRule="evenodd"
                  />
                  <path d="M4.75 6a.75.75 0 00-.75.75v10.5c0 .414.336.75.75.75h10.5a.75.75 0 00.75-.75v-10.5a.75.75 0 00-.75-.75h-10.5z" />
                </svg>
              </div>
              <div>
                <h1 className="bg-gradient-to-r from-white to-white/60 bg-clip-text text-2xl font-bold text-transparent">
                  TradeForge
                </h1>
                <p className="text-xs font-medium text-primary tracking-wider uppercase">
                  Sandbox Environment
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 rounded-full border border-white/5 bg-white/5 px-3 py-1.5 backdrop-blur-sm">
                <div
                  className={`h-2 w-2 rounded-full ${status === 'open' ? 'bg-success shadow-[0_0_10px_#00FF94]' : 'bg-error'}`}
                />
                <span className="text-xs font-medium text-textMuted">
                  {wsStatusLabel[status]}
                </span>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-8 animate-fade-in">
          <section className="glass-panel rounded-2xl p-1 transition-all hover:border-primary/20">
            <div className="rounded-xl bg-surface/50 p-6">
              <Preflight apiBase={API_BASE} />
            </div>
          </section>

          <div className="grid gap-8 lg:grid-cols-2">
            <section className="glass-panel rounded-2xl p-1 transition-all hover:border-primary/20">
              <div className="h-full rounded-xl bg-surface/50 p-6">
                <RunControl apiBase={API_BASE} />
              </div>
            </section>

            <section className="glass-panel rounded-2xl p-1 transition-all hover:border-primary/20">
              <div className="h-full rounded-xl bg-surface/50 p-6">
                <Bots apiBase={API_BASE} />
              </div>
            </section>
          </div>
        </main>
      </div>
    </WsContext.Provider>
  );
}

export default App;
