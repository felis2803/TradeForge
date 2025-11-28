# Manual Trading Web App Test Plan and Report

## Test Plan

### Scope

Cover the manual trading web app against the supplied requirements: connection setup, trading screen data (trades/orderbook/chart), instrument switching, order placement (type/size/price), historical playback controls, and state tables for positions and orders.

### Environment

- App: `apps/manual-trading` (Vite dev server on port 5174)
- Browser: Playwright (Chromium)
- Dataset: Built-in mock data (historical/realtime simulation toggles)

### Test Cases

1. **Initial load & layout**
   - Launch the app and confirm the landing screen shows connection setup (exchange selector, data mode options, historical playback controls when applicable, start balance).
2. **Exchange selection & start balance**
   - Change exchange options and verify the selection persists.
   - Adjust start balance input and ensure it updates.
3. **Data mode selection**
   - Toggle between historical and realtime modes.
   - When historical is selected, verify period selection (start/end) and playback speed controls appear.
4. **Historical playback configuration**
   - Set a valid date range and playback speed; ensure controls accept input without validation errors.
5. **Enter trading screen**
   - Start the session and confirm navigation to the trading dashboard.
   - Verify instrument switcher is present with multiple instruments.
6. **Market data widgets**
   - Confirm trade tape shows multiple rows with time/side/price/size.
   - Confirm order book shows bids/asks with prices and sizes.
   - Confirm price chart renders and updates when instrument changes.
7. **Instrument switching**
   - Switch to another instrument and verify market widgets (ticker, trades, order book, chart) update accordingly.
8. **Order placement - Market**
   - Place a market buy order with valid size; verify new position and order status update to filled with execution price.
9. **Order placement - Limit**
   - Place a limit sell order with custom price; ensure it appears in open orders with correct status/price/size.
10. **Order placement - Stop**
    - Place a stop order and verify it is tracked in the orders table with stop price.
11. **Positions table**
    - Verify position details show instrument, size, average entry, and liquidation level; ensure PnL updates with mark price.
12. **Orders table status transitions**
    - Cancel an active order (if supported) or observe auto-fill; confirm status changes accordingly.
13. **Playback controls during session**
    - Adjust playback speed and ensure market data pace responds (visual update/label change).
14. **Error/edge validations**
    - Try entering an invalid order size below minimum and verify validation message or disabled submit.

## Test Execution & Results

1. **Initial load & layout** — Landing screen shows exchange selector, data mode toggle, playback controls, and balance input. ![Step 1 – Initial load](browser:/invocations/xyejdjzu/artifacts/docs/manual-trading-testing/screens/step1-initial.png)
2. **Exchange selection & start balance** — Switched exchange to Bybit and set balance to 15,000 USDT; inputs reflected the changes. ![Step 2 – Connection config](browser:/invocations/wkkitmst/artifacts/docs/manual-trading-testing/screens/step2-config.png)
3. **Data mode selection** — Toggled Realtime↔Исторические; historical mode exposed date inputs and playback speed selector. ![Step 2 – Connection config](browser:/invocations/wkkitmst/artifacts/docs/manual-trading-testing/screens/step2-config.png)
4. **Historical playback configuration** — Set 02.05.2024 10:00→14:00 with 2x speed; controls accepted values and timeline updated. ![Step 2 – Connection config](browser:/invocations/wkkitmst/artifacts/docs/manual-trading-testing/screens/step2-config.png)
5. **Enter trading screen** — Clicked “Подключиться”; dashboard displayed balances, exposure, and data mode summary. ![Step 3 – Connected](browser:/invocations/wkkitmst/artifacts/docs/manual-trading-testing/screens/step3-connected.png)
6. **Market data widgets** — Trade tape, order book, and mini chart populated for BTC/USDT and ETH/USDT. ![Step 4 – Instrument switch](browser:/invocations/wkkitmst/artifacts/docs/manual-trading-testing/screens/step4-instrument-switch.png)
7. **Instrument switching** — Switched to ETH/USDT; ticker, trades, book, and chart updated. ![Step 4 – Instrument switch](browser:/invocations/wkkitmst/artifacts/docs/manual-trading-testing/screens/step4-instrument-switch.png)
8. **Order placement - Market** — Submitted market buy 0.5 ETH/USDT; order filled with execution price and position reflected in table. ![Step 5 – Market order](browser:/invocations/wkkitmst/artifacts/docs/manual-trading-testing/screens/step5-market-order.png)
9. **Order placement - Limit** — Placed limit sell 0.2 ETH/USDT @ 2900; shown as filled in orders/active orders lists. ![Step 6 – Limit order](browser:/invocations/wkkitmst/artifacts/docs/manual-trading-testing/screens/step6-limit-order.png)
10. **Order placement - Stop** — Added stop buy 0.1 ETH/USDT @ 2800; displayed in order history with status. ![Step 7 – Stop order](browser:/invocations/wkkitmst/artifacts/docs/manual-trading-testing/screens/step7-stop-order.png)
11. **Positions table** — Positions panel lists instruments, sizes, average prices, liquidation, and PnL percentages after trades. ![Step 5 – Market order](browser:/invocations/wkkitmst/artifacts/docs/manual-trading-testing/screens/step5-market-order.png)
12. **Orders table status transitions** — Cancelled an active BTC/USDT limit order; status moved to “cancelled” and disappeared from active list. ![Step 10 – Cancel order](browser:/invocations/squffwzu/artifacts/docs/manual-trading-testing/screens/step10-cancel-order.png)
13. **Playback controls during session** — Changed playback speed to 4x; UI updated speed badge and cadence label. ![Step 8 – Playback speed](browser:/invocations/wkkitmst/artifacts/docs/manual-trading-testing/screens/step8-speed.png)
14. **Error/edge validations** — Entered size 0 on market order; validation message blocked submission (“Value must be greater than or equal to 0.01”). ![Step 9 – Invalid size](browser:/invocations/wkkitmst/artifacts/docs/manual-trading-testing/screens/step9-invalid-size.png)
