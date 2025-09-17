import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildDepthReader, buildTradesReader } from '../_shared/readers.js';
import { buildMerged } from '../_shared/merge.js';
import { runScenario } from '../_shared/replay.js';
import { createLogger } from '../_shared/logging.js';

const logger = createLogger({ prefix: '[examples/smoke]' });

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const tradesPath = resolve(here, 'mini-trades.jsonl');
  const depthPath = resolve(here, 'mini-depth.jsonl');

  const trades = buildTradesReader([tradesPath]);
  const depth = buildDepthReader([depthPath]);
  const timeline = buildMerged(trades, depth);

  const progress = await runScenario({
    timeline,
    clock: 'logical',
    limits: {
      maxEvents: 8,
    },
    logger,
  });

  logger.info(`smoke replay finished after ${progress.eventsOut} events`);
  console.log('SMOKE_OK');
}

main().catch((err) => {
  logger.error(err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) {
    logger.debug(err.stack);
  }
  process.exit(1);
});
