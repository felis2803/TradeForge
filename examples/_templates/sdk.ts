import {
  buildDepthReader,
  buildTradesReader,
} from 'examples/_shared/readers.js';
import { buildMerged } from 'examples/_shared/merge.js';
import { runScenario } from 'examples/_shared/replay.js';
import { createLogger } from 'examples/_shared/logging.js';

const logger = createLogger({ prefix: '[examples/sdk-template]' });

async function main(): Promise<void> {
  logger.info('TODO: настроить источники данных');
  const trades = buildTradesReader([
    // TODO: передать файлы или оставить пустым, чтобы использовать TF_TRADES_FILES
  ]);
  const depth = buildDepthReader([
    // TODO: передать файлы или использовать TF_DEPTH_FILES
  ]);
  const timeline = buildMerged(trades, depth);

  const progress = await runScenario({
    timeline,
    clock: 'logical',
    limits: {
      // TODO: обновить лимиты
      maxEvents: 100,
    },
    logger,
  });

  logger.info(`scenario finished, processed ${progress.eventsOut} events`);
}

main().catch((err) => {
  logger.error(err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) {
    logger.debug(err.stack);
  }
  process.exit(1);
});
