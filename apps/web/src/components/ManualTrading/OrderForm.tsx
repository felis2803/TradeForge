import React, { FormEvent } from 'react';

interface OrderFormProps {
  instruments: readonly string[];
  selectedInstrument: string;
  orderType: string;
  orderSize: number;
  orderPrice: number;
  setSelectedInstrument: (instrument: string) => void;
  setOrderType: (type: string) => void;
  setOrderSize: (size: number) => void;
  setOrderPrice: (price: number) => void;
  handleSubmitOrder: (event: FormEvent) => void;
}

/**
 * Order Form Component
 * Form for submitting trading orders with instrument, type, size, and price
 */
export function OrderForm({
  instruments,
  selectedInstrument,
  orderType,
  orderSize,
  orderPrice,
  setSelectedInstrument,
  setOrderType,
  setOrderSize,
  setOrderPrice,
  handleSubmitOrder,
}: OrderFormProps) {
  return (
    <form
      onSubmit={handleSubmitOrder}
      className="space-y-3 rounded-md border border-slate-800 bg-slate-950/60 p-4 text-sm"
    >
      <label className="space-y-1">
        <span className="text-slate-300">Инструмент</span>
        <select
          value={selectedInstrument}
          onChange={(event) => setSelectedInstrument(event.target.value)}
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 focus:border-emerald-400 focus:outline-none"
        >
          {instruments.map((symbol) => (
            <option key={symbol} value={symbol}>
              {symbol}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1">
        <span className="text-slate-300">Тип ордера</span>
        <select
          value={orderType}
          onChange={(event) => setOrderType(event.target.value)}
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 focus:border-emerald-400 focus:outline-none"
        >
          <option value="market">Рыночный</option>
          <option value="limit">Лимитный</option>
          <option value="stop">Стоп</option>
        </select>
      </label>

      <label className="space-y-1">
        <span className="text-slate-300">Размер</span>
        <input
          type="number"
          min={0.001}
          step={0.001}
          value={orderSize}
          onChange={(event) => setOrderSize(Number(event.target.value))}
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 focus:border-emerald-400 focus:outline-none"
        />
      </label>

      {orderType !== 'market' && (
        <label className="space-y-1">
          <span className="text-slate-300">Цена</span>
          <input
            type="number"
            min={1}
            step={1}
            value={orderPrice}
            onChange={(event) => setOrderPrice(Number(event.target.value))}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 focus:border-emerald-400 focus:outline-none"
          />
        </label>
      )}

      <button
        type="submit"
        className="w-full rounded-md border border-emerald-500 bg-emerald-500/10 px-4 py-2 font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
      >
        Разместить ордер
      </button>
    </form>
  );
}
