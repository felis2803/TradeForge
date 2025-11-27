import ManualTrading from './ManualTrading.tsx';

function App(): JSX.Element {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-emerald-300">TradeForge</p>
            <h1 className="text-2xl font-semibold">Manual Trading</h1>
            <p className="text-sm text-slate-400">Ручное управление сделками и позициями</p>
          </div>
          <div className="text-right text-sm text-slate-300">
            <p className="font-semibold text-slate-50">Отдельное веб‑приложение</p>
            <p className="text-slate-400">Настройка подключения, рынок, ордера и позиции</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">
        <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 shadow-lg shadow-slate-900/40">
          <ManualTrading />
        </section>
      </main>
    </div>
  );
}

export default App;
