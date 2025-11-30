# Manual Trading TradingView Widget Review

## Summary

This review evaluates the recent replacement of the manual trading preview chart with a TradingView widget. The assessment focuses on runtime behavior in the current codebase and visual verification from the manual trading UI.

## Findings

- **Widget container renders but stays visually empty.** The TradingView script loads (`window.TradingView` becomes available) and the widget constructor is invoked when the exchange or instrument changes, yet the embedded area remains blank in the UI after several seconds of waiting. No chart grid, axes, or candles appear, which suggests the widget is not finishing its render cycle or the configured symbol cannot be resolved by the TradingView embed. There are no console errors during initialization, so the failure is silent.
- **No teardown on unmount.** Each widget rebuild calls `remove()` on the previous widget, but the `useEffect` that constructs the widget does not return a cleanup function. If the ManualTrading component unmounts, the TradingView instance will persist in memory until a reload.

## Evidence

- TradingView integration logic and widget creation (including the script bootstrap and symbol mapping) are in `apps/manual-trading/src/ManualTrading.tsx` lines 673-815 and 1970-1989.【F:apps/manual-trading/src/ManualTrading.tsx†L673-L815】【F:apps/manual-trading/src/ManualTrading.tsx†L1970-L1989】
- Runtime screenshot showing the blank TradingView area despite the widget being mounted: ![Manual trading screen with empty TradingView widget](browser:/invocations/fbptrord/artifacts/artifacts/manual-trading-4174.png)

## Recommended next steps

1. Verify the TradingView symbol strings for each supported exchange/instrument pair and handle error callbacks from the widget API to surface symbol resolution issues.
2. Add a cleanup function in the widget creation `useEffect` to dispose of the TradingView instance on unmount.
3. Provide a visible error/fallback state in the UI when the TradingView widget fails to render within a reasonable timeout.
