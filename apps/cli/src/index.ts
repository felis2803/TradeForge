import { dumpTrades } from './commands/dumpTrades.js';
import { dumpDepth } from './commands/dumpDepth.js';
import { replayDryRun } from './commands/replayDryRun.js';

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
  if (cmd === 'replay') {
    const tail = [sub, ...rest].filter((v): v is string => Boolean(v));
    if (tail[0] === '--dry-run') {
      await replayDryRun(tail.slice(1));
      return;
    }
    const idx = tail.indexOf('--dry-run');
    if (idx >= 0) {
      const forwarded = [...tail.slice(0, idx), ...tail.slice(idx + 1)];
      await replayDryRun(forwarded);
      return;
    }
  }
  console.log(
    'TradeForge CLI: available commands -> dump trades|depth, replay --dry-run',
  );
}

run();
