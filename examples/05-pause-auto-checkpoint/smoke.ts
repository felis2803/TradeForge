import { spawnSync } from 'node:child_process';
import { rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';

function parseCheckpointInfo(stdout: string): {
  cpExists: boolean;
  cpPath: string;
} {
  const markerMatch = stdout.match(/PAUSE_CP_OK\s+({.+?})/);
  if (!markerMatch) {
    throw new Error('marker PAUSE_CP_OK not found in stdout');
  }
  const payload = markerMatch[1];
  if (!payload) {
    throw new Error('checkpoint marker payload missing');
  }
  try {
    const parsed = JSON.parse(payload) as {
      cpExists?: boolean;
      cpPath?: string;
    };
    if (!parsed.cpPath || typeof parsed.cpPath !== 'string') {
      throw new Error('checkpoint path missing in marker payload');
    }
    return { cpExists: Boolean(parsed.cpExists), cpPath: parsed.cpPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to parse checkpoint info: ${message}`);
  }
}

function ensureCheckpoint(cpPath: string): void {
  const stats = statSync(cpPath, { throwIfNoEntry: false });
  if (!stats) {
    throw new Error(`checkpoint file not created at ${cpPath}`);
  }
  if (stats.size <= 0) {
    throw new Error(`checkpoint file at ${cpPath} is empty`);
  }
}

function main(): void {
  const result = spawnSync(
    'node',
    ['dist-examples/05-pause-auto-checkpoint/run.js'],
    {
      env: { ...process.env, TF_KEEP_CP: '1' },
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

  const info = parseCheckpointInfo(stdout);
  if (!info.cpExists) {
    throw new Error('PAUSE_CP_OK reported cpExists=false');
  }
  ensureCheckpoint(info.cpPath);

  const savedMatches = stdout.match(/checkpoint saved/gi);
  if (savedMatches && savedMatches.length > 1) {
    console.warn(
      `[examples/05-pause-auto-checkpoint] smoke warning: checkpoint saved logged ${savedMatches.length} times`,
    );
  }

  console.log('EX05_CP_PATH', info.cpPath);

  if (info.cpPath.includes('tf-cp-')) {
    try {
      rmSync(info.cpPath, { force: true });
      const dir = dirname(info.cpPath);
      rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn(
        `[examples/05-pause-auto-checkpoint] smoke warning: failed to cleanup ${info.cpPath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  console.log('EX05_PAUSE_AUTO_CP_SMOKE_OK');
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[examples/05-pause-auto-checkpoint] smoke failed:', message);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
}
