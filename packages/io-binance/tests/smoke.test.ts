import { ioBinanceReady } from '../src/index';

test('io-binance smoke', () => {
  expect(ioBinanceReady()).toBe('io-binance-ready');
});
