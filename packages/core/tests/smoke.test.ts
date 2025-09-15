import { coreReady } from '../src/index';

test('core smoke', () => {
  expect(coreReady()).toBe('core-ready');
});
