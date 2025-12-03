/**
 * EXAMPLE: ManualTrading.tsx - Refactored with Decomposed Modules
 *
 * This is an example showing how to integrate all the decomposed modules.
 * The original ManualTrading.tsx remains at ~1455 lines.
 * This refactored version would be ~200-250 lines.
 *
 * To use this file:
 * 1. Review the structure
 * 2. Test the imports
 * 3. When ready, replace the content of apps/web/src/pages/ManualTrading.tsx
 */

import { useMemo } from 'react';
import {
  exchanges,
  instruments,
  playbackSpeeds,
  computePnl,
  computeUpdateInterval,
} from '@/utils/ManualTrading';
import {
  useManualTradingState,
  useMarketDataSimulation,
  useOrderManagement,
  useQuickActions,
  useKeyboardShortcuts,
} from '@/hooks/ManualTrading';
import {
  ConnectionPanel,
  QuickActionsPanel,
  InstrumentSelector,
  OrderForm,
  PositionsTable,
  OrdersTable,
  MarketDataPanel,
} from '@/components/ManualTrading';

export default function ManualTrading(): JSX.Element {
  // ===== State Management Hook =====
  const state = useManualTradingState();

  // ===== Calculate Update Interval =====
  const updateIntervalMs = computeUpdateInterval(
    state.dataMode,
    state.playbackSpeed,
    state.periodStart,
    state.periodEnd,
  );

  // ===== Market Data Simulation Hook =====
  const marketData = useMarketDataSimulation({
    selectedInstrument: state.selectedInstrument,
    dataMode: state.dataMode,
    isPaused: state.isPaused,
    dataUnavailable: state.dataUnavailable,
    updateIntervalMs,
  });

  // ===== Update Mark Prices =====
  useMemo(() => {
    state.setMarkPrices((prev) => ({
      ...prev,
      [state.selectedInstrument]: marketData.ticker.last,
    }));
  }, [marketData.ticker.last, state.selectedInstrument]);

  // ===== Order Management Hook =====
  const orderMgmt = useOrderManagement({
    selectedInstrument: state.selectedInstrument,
    selectedExchange: state.selectedExchange,
    balance: state.balance,
    dataMode: state.dataMode,
    periodStart: state.periodStart,
    periodEnd: state.periodEnd,
    playbackSpeed: state.playbackSpeed,
    orderType: state.orderType,
    orderSize: state.orderSize,
    orderPrice: state.orderPrice,
    markPrices: state.markPrices,
    setOrders: state.setOrders,
    setPositions: state.setPositions,
    setPositionEvents: state.setPositionEvents,
    setTrades: marketData.setTrades || (() => { }),
    setConnectionMessage: state.setConnectionMessage,
    setConnectionError: state.setConnectionError,
    setIsPaused: state.setIsPaused,
    resetStreams: marketData.resetStreams,
    setLastUpdateAt: marketData.setLastUpdateAt || (() => { }),
  });

  // ===== Quick Actions Hook =====
  const quickActions = useQuickActions({
    selectedInstrument: state.selectedInstrument,
    balance: state.balance,
    markPriceForInstrument: orderMgmt.markPriceForInstrument,
    setOrderSize: state.setOrderSize,
    setOrderPrice: state.setOrderPrice,
    setOrderType: state.setOrderType,
    setOrders: state.setOrders,
    setPositions: state.setPositions,
    recordSyntheticTrade: orderMgmt.recordSyntheticTrade,
    addPositionEvent: orderMgmt.addPositionEvent,
  });

  // ===== Keyboard Shortcuts Hook =====
  useKeyboardShortcuts({
    isPaused: state.isPaused,
    selectedPreset: quickActions.selectedPreset,
    handleTogglePause: orderMgmt.handleTogglePause,
    handlePresetClick: quickActions.handlePresetClick,
    handleQuickMarketOrder: quickActions.handleQuickMarketOrder,
    setSelectedInstrument: state.setSelectedInstrument,
  });

  // ===== Derived State =====
  const totalExposure = state.positions.reduce(
    (sum, pos) => sum + Math.abs(pos.avgPrice * pos.size),
    0,
  );
  const exposurePct = (totalExposure / state.balance) * 100;

  // ===== Render =====
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-50">Ручная Торговля</h1>
          <p className="text-sm text-slate-400">
            Симуляция торговли с интеграцией всех модулей
          </p>
        </div>

        {/* Connection Panel */}
        <ConnectionPanel
          exchanges={exchanges}
          playbackSpeeds={playbackSpeeds}
          selectedExchange={state.selectedExchange}
          dataMode={state.dataMode}
          balance={state.balance}
          periodStart={state.periodStart}
          periodEnd={state.periodEnd}
          playbackSpeed={state.playbackSpeed}
          connectionMessage={state.connectionMessage}
          connectionError={state.connectionError}
          setSelectedExchange={state.setSelectedExchange}
          setDataMode={state.setDataMode}
          setBalance={state.setBalance}
          setPeriodStart={state.setPeriodStart}
          setPeriodEnd={state.setPeriodEnd}
          setPlaybackSpeed={state.setPlaybackSpeed}
          handleConnect={orderMgmt.handleConnect}
        />

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Баланс
            </p>
            <p className="text-2xl font-semibold text-emerald-200">
              {state.balance.toLocaleString('ru-RU')}{' '}
              <span className="text-sm text-slate-400">USDT</span>
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Экспозиция позиций
            </p>
            <p className="text-xl font-semibold text-slate-50">
              {totalExposure.toLocaleString('ru-RU')}{' '}
              <span className="text-sm text-slate-400">USDT</span>
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-300"
                style={{ width: `${Math.min(100, exposurePct).toFixed(1)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {exposurePct.toFixed(1)}% от баланса
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Режим данных
            </p>
            <p className="text-lg font-semibold text-slate-50">
              {state.dataMode === 'history' ? 'Исторические' : 'Realtime'}
            </p>
            <p className="text-xs text-slate-400">
              Обновление: ~{updateIntervalMs} мс
            </p>
          </div>
        </div>

        {/* Main Layout */}
        <div className="grid gap-4 xl:grid-cols-3">
          {/* Market Data Section */}
          <div className="xl:col-span-2 rounded-lg border border-slate-800 bg-slate-900/60 p-5">
            <InstrumentSelector
              instruments={instruments}
              selectedInstrument={state.selectedInstrument}
              setSelectedInstrument={state.setSelectedInstrument}
            />

            <div className="mt-4">
              <MarketDataPanel
                selectedInstrument={state.selectedInstrument}
                ticker={marketData.ticker}
                trades={marketData.trades}
                orderBook={marketData.orderBook}
                syntheticChart={marketData.syntheticChart}
                dataMode={state.dataMode}
                dataUnavailable={state.dataUnavailable}
                updateIntervalMs={updateIntervalMs}
                handleOrderbookPriceClick={
                  quickActions.handleOrderbookPriceClick
                }
              />
            </div>
          </div>

          {/* Trading Section */}
          <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/60 p-5">
            <h3 className="text-lg font-semibold text-slate-50">Ордеры</h3>

            {/* Quick Actions Panel */}
            <QuickActionsPanel
              balance={state.balance}
              selectedPreset={quickActions.selectedPreset}
              selectedInstrument={state.selectedInstrument}
              calculatePresetSize={quickActions.calculatePresetSize}
              handlePresetClick={quickActions.handlePresetClick}
              handleQuickMarketOrder={quickActions.handleQuickMarketOrder}
            />

            {/* Order Form */}
            <OrderForm
              instruments={instruments}
              selectedInstrument={state.selectedInstrument}
              orderType={state.orderType}
              orderSize={state.orderSize}
              orderPrice={state.orderPrice}
              setSelectedInstrument={state.setSelectedInstrument}
              setOrderType={state.setOrderType}
              setOrderSize={state.setOrderSize}
              setOrderPrice={state.setOrderPrice}
              handleSubmitOrder={orderMgmt.handleSubmitOrder}
            />

            {/* Positions & Orders */}
            <div className="space-y-4">
              <div>
                <h4 className="mb-2 text-sm font-semibold text-slate-300">
                  Позиции
                </h4>
                <PositionsTable
                  positions={state.positions}
                  markPrices={state.markPrices}
                  computePnl={computePnl}
                  handleClosePosition={orderMgmt.handleClosePosition}
                  handleReversePosition={orderMgmt.handleReversePosition}
                />
              </div>

              <div>
                <h4 className="mb-2 text-sm font-semibold text-slate-300">
                  Ордера
                </h4>
                <OrdersTable orders={state.orders} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
