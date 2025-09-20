#!/usr/bin/env node
import { Command } from 'commander';
import { syncBinanceDataset } from './sync.js';
import { DEFAULT_ROOT_DIR } from './constants.js';
import { createTradeStream, createDepthStream } from './streams.js';
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';

async function collectPreview<T>(
  iter: AsyncIterable<T>,
  limit: number,
): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) {
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

export function createCli(): Command {
  const program = new Command();
  program
    .name('loader:binance')
    .description('Binance Data Portal loader')
    .configureHelp({ sortSubcommands: true })
    .configureOutput({
      outputError(str, write) {
        write(str);
      },
    });

  program
    .command('sync')
    .description('Download and cache Binance archives for given date')
    .requiredOption('--symbol <symbol>', 'Trading pair', 'BTCUSDT')
    .requiredOption('--date <yyyy-mm-dd>', 'Target date (UTC)')
    .option(
      '--root <path>',
      `Root dataset directory (default: ${DEFAULT_ROOT_DIR})`,
    )
    .option('--base-url <url>', 'Override base URL of Binance Data Portal')
    .option('--force', 'Force re-download even if cache is present', false)
    .option('--preview', 'Print first entries after sync', false)
    .action(async (opts) => {
      const report = await syncBinanceDataset({
        symbol: opts.symbol,
        date: opts.date,
        rootDir: opts.root,
        baseUrl: opts.baseUrl,
        force: Boolean(opts.force),
      });
      for (const item of report.items) {
        const status = item.status === 'downloaded' ? 'downloaded' : 'skipped';
        const size = item.bytes
          ? ` (${Math.round((item.bytes / 1024) * 10) / 10} KiB)`
          : '';
        console.log(`✔ ${item.kind} ${status}${size}`);
      }
      if (opts.preview) {
        const trades = createTradeStream({
          symbol: report.symbol,
          date: report.date,
          rootDir: opts.root,
        });
        const depth = createDepthStream({
          symbol: report.symbol,
          date: report.date,
          rootDir: opts.root,
        });
        const [tradePreview, depthPreview] = await Promise.all([
          collectPreview(trades, 3),
          collectPreview(depth, 3),
        ]);
        console.log(`Trades preview (${tradePreview.length}):`);
        for (const entry of tradePreview) {
          console.log(JSON.stringify(entry));
        }
        console.log(`Depth preview (${depthPreview.length}):`);
        for (const entry of depthPreview) {
          console.log(JSON.stringify(entry));
        }
      }
    });

  return program;
}

async function main(argv: string[]): Promise<void> {
  const program = createCli();
  await program.parseAsync(argv);
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const modulePath = fileURLToPath(import.meta.url);
  return basename(entry) === basename(modulePath);
})();

if (isMain) {
  main(process.argv).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exitCode = 1;
  });
}
