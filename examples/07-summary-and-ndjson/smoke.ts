import { access, constants, readFile } from 'node:fs/promises';
import process from 'node:process';

const NDJSON_PATH = '/tmp/tf.reports.ndjson';

async function main(): Promise<void> {
  try {
    await access(NDJSON_PATH, constants.F_OK);
  } catch {
    throw new Error(`NDJSON file not found at ${NDJSON_PATH}`);
  }

  const raw = await readFile(NDJSON_PATH, 'utf8');
  const rows = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;

  if (rows <= 0) {
    throw new Error('NDJSON file exists but contains no rows');
  }

  console.log(`SUMMARY_NDJSON_SMOKE_OK rows=${rows}`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[examples/07-summary-and-ndjson] smoke failed:', message);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
