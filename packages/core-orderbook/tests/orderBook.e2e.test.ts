import { OrderBook } from '@tradeforge/core-orderbook';

interface BinanceDiff {
  U: number; // first update ID
  u: number; // last update ID
  E: number; // event time
  b: [string, string][]; // bids
  a: [string, string][]; // asks
}

describe('OrderBook E2E with Binance-style diffs', () => {
  const fixture: BinanceDiff[] = [
    {
      U: 1,
      u: 2,
      E: 1_700_000_000_001,
      b: [
        ['42110.40', '0.200'],
        ['42110.30', '0.150'],
      ],
      a: [
        ['42111.20', '0.180'],
        ['42111.30', '0.210'],
      ],
    },
    {
      U: 3,
      u: 5,
      E: 1_700_000_000_005,
      b: [
        ['42110.40', '0.000'],
        ['42109.80', '0.350'],
      ],
      a: [['42111.20', '0.120']],
    },
    {
      U: 6,
      u: 8,
      E: 1_700_000_000_010,
      b: [
        ['42109.80', '0.000'],
        ['42109.50', '0.420'],
      ],
      a: [
        ['42111.10', '0.320'],
        ['42111.50', '0.000'],
      ],
    },
  ];

  it('maintains correct best bid and ask', () => {
    const book = new OrderBook();

    for (const diff of fixture) {
      book.applyDiff({
        sequence: diff.u,
        timestamp: diff.E,
        bids: diff.b.map(([price, size]) => ({
          price: Number(price),
          size: Number(size),
        })),
        asks: diff.a.map(([price, size]) => ({
          price: Number(price),
          size: Number(size),
        })),
      });
    }

    const snapshot = book.getSnapshot();
    expect(snapshot.sequence).toBe(8);
    expect(snapshot.timestamp).toBe(1_700_000_000_010);
    expect(snapshot.bestBid).toEqual({ price: 42110.3, size: 0.15 });
    expect(snapshot.bestAsk).toEqual({ price: 42111.1, size: 0.32 });
  });
});
