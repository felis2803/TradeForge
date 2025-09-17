#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import process from 'node:process';

function printUsage(): void {
  console.log('Usage: pnpm examples:run <scenario> [args...]');
}

async function importAndRun(modulePath: string, args: string[]): Promise<void> {
  const originalArgv = [...process.argv];
  process.argv = [process.argv[0]!, modulePath, ...args];
  try {
    const mod = await import(pathToFileURL(modulePath).href);
    const defaultExport = (mod as Record<string, unknown>)['default'];
    if (typeof defaultExport === 'function') {
      await (defaultExport as () => unknown)();
      return;
    }
    const runExport = (mod as Record<string, unknown>)['run'];
    if (typeof runExport === 'function') {
      await (runExport as () => unknown)();
    }
  } finally {
    process.argv = originalArgv;
  }
}

async function main(): Promise<void> {
  const [, , ...rest] = process.argv;
  const scenario = rest.shift();
  if (!scenario || scenario.startsWith('-')) {
    printUsage();
    process.exit(1);
  }
  const args = rest;
  const builtPath = resolve('dist-examples', scenario, 'run.js');
  if (existsSync(builtPath)) {
    await importAndRun(builtPath, args);
    return;
  }
  console.warn(
    `dist-examples/${scenario}/run.js not found, falling back to examples/_smoke/smoke.ts`,
  );
  const fallback = resolve('examples', '_smoke', 'smoke.ts');
  await importAndRun(fallback, args);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
