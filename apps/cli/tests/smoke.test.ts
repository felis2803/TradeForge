import { run } from '../src/index';

test('cli smoke', () => {
  let output = '';
  const original = console.log;
  console.log = (msg) => {
    output += msg;
  };
  run();
  console.log = original;
  expect(output).toContain('TradeForge CLI: core-ready');
});
