import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import process from 'node:process';

async function ensureNdjson(path: string): Promise<number> {
  await access(path, constants.F_OK);
  const raw = await readFile(path, 'utf8');
  const rows = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
  if (rows <= 0) {
    throw new Error('NDJSON file is empty');
  }
  return rows;
}

async function main(): Promise<void> {
  const result = spawnSync(
    'node',
    ['dist-examples/07-summary-and-ndjson/run.js'],
    {
      env: { ...process.env, TF_KEEP_NDJSON: '1' },
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr}` : '';
    throw new Error(`example exited with code ${result.status}${stderr}`);
  }

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }

  const markerMatch = stdout.match(/SUMMARY_NDJSON_OK\s+({.+?})/);
  if (!markerMatch) {
    throw new Error('marker SUMMARY_NDJSON_OK not found in stdout');
  }
  let ndjsonPath: string;
  const payload = markerMatch[1];
  if (!payload) {
    throw new Error('summary payload missing from marker');
  }
  try {
    const parsed = JSON.parse(payload) as {
      ndjsonPath?: string;
    };
    if (!parsed.ndjsonPath || typeof parsed.ndjsonPath !== 'string') {
      throw new Error('ndjsonPath missing in summary payload');
    }
    ndjsonPath = parsed.ndjsonPath;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to parse summary payload: ${message}`);
  }

  await sleep(10);
  const rows = await ensureNdjson(ndjsonPath);
  console.log('EX07_NDJSON_ROWS', rows);
  console.log('EX07_SUMMARY_NDJSON_PATH', ndjsonPath);

  if (ndjsonPath.includes('tf-ndjson-')) {
    try {
      await rm(ndjsonPath, { force: true });
      const dir = dirname(ndjsonPath);
      await rm(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn(
        `[examples/07-summary-and-ndjson] smoke warning: failed to cleanup ${ndjsonPath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  console.log('EX07_SUMMARY_SMOKE_OK');
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[examples/07-summary-and-ndjson] smoke failed:', message);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
