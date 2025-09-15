# Fixtures for io-binance tests

Small sample files used in tests:

- `trades.csv`: 3 sample trade rows.
- `trades.jsonl`: same trades in JSON Lines format.
- `trades.json`: trades as JSON array.
- `depth.jsonl`: two diff-depth events.
- `trades.nonmono.csv`: trades with non-monotonic timestamps (for error case).

Compressed variants (`*.gz`, `*.zip`) are generated on the fly in tests.
