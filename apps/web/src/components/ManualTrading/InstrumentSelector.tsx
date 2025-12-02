import React from 'react';

interface InstrumentSelectorProps {
  instruments: readonly string[];
  selectedInstrument: string;
  setSelectedInstrument: (instrument: string) => void;
}

/**
 * Instrument Selector Component
 * Displays buttons for switching between trading instruments
 */
export function InstrumentSelector({
  instruments,
  selectedInstrument,
  setSelectedInstrument,
}: InstrumentSelectorProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {instruments.map((symbol) => (
        <button
          key={symbol}
          type="button"
          onClick={() => setSelectedInstrument(symbol)}
          className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
            selectedInstrument === symbol
              ? 'border border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
              : 'border border-slate-800 text-slate-300 hover:border-slate-700 hover:text-slate-100'
          }`}
        >
          {symbol}
        </button>
      ))}
    </div>
  );
}
