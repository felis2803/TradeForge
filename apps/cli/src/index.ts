import { dumpTrades } from './commands/dumpTrades.js';
import { dumpDepth } from './commands/dumpDepth.js';

export async function run(
  args: string[] = process.argv.slice(2),
): Promise<void> {
  if (args[0] === '--') args = args.slice(1);
  if (args.includes('--version')) {
    console.log('TradeForge CLI v0.1.0');
    return;
  }
  const [cmd, sub, ...rest] = args;
  if (cmd === 'dump' && sub === 'trades') {
    await dumpTrades(rest);
    return;
  }
  if (cmd === 'dump' && sub === 'depth') {
    await dumpDepth(rest);
    return;
  }
  console.log('TradeForge CLI: core-ready');
}

run();
