import { OrderBook } from '@tradeforge/core-orderbook';

const book = new OrderBook({
  sequence: 1,
  timestamp: Date.now(),
  bids: [
    { price: 42110.4, size: 0.2 },
    { price: 42109.9, size: 0.35 },
  ],
  asks: [
    { price: 42111.2, size: 0.18 },
    { price: 42111.4, size: 0.24 },
  ],
});

book.onUpdate((update) => {
  console.log('level update', update);
});

book.onTrade((trade) => {
  console.log('trade', trade);
});

book.applyDiff({
  sequence: 2,
  timestamp: Date.now(),
  bids: [
    { price: 42110.4, size: 0 },
    { price: 42109.7, size: 0.5 },
  ],
  asks: [{ price: 42111.2, size: 0.12 }],
});

book.recordTrade({
  price: 42111.2,
  size: 0.03,
  side: 'ask',
  timestamp: Date.now(),
});

const snapshot = book.getSnapshot();
console.log('best bid', snapshot.bestBid);
console.log('best ask', snapshot.bestAsk);

for (const trade of book.iterateTrades()) {
  console.log('historical trade', trade);
}
