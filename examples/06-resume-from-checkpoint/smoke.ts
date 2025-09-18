import { spawnSync } from 'node:child_process';
import { rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';

function runNode(
  script: string,
  args: string[] = [],
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync('node', [script, ...args], {
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.error) {
    throw result.error;
  }
  return {
    status: typeof result.status === 'number' ? result.status : null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function parseSaveOutput(stdout: string): { cpPath: string } {
  const match = stdout.match(/SAVE_OK\s+({.+?})/);
  if (!match) {
    throw new Error('SAVE_OK marker not found in save output');
  }
  try {
    const parsed = JSON.parse(match[1] ?? '{}') as { cpPath?: string };
    if (!parsed.cpPath || typeof parsed.cpPath !== 'string') {
      throw new Error('cpPath missing in SAVE_OK payload');
    }
    return { cpPath: parsed.cpPath };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to parse SAVE_OK payload: ${reason}`);
  }
}

function ensureCheckpoint(path: string): void {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats || stats.size <= 0) {
    throw new Error(`checkpoint file not found or empty at ${path}`);
  }
}

function parseResumeOutput(stdout: string): void {
  const match = stdout.match(/RESUME_OK\s+({.+?})/);
  if (!match) {
    throw new Error('RESUME_OK marker not found in resume output');
  }
  try {
    const parsed = JSON.parse(match[1] ?? '{}') as { loaded?: boolean };
    if (parsed.loaded !== true) {
      throw new Error('resume payload did not confirm loaded=true');
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to parse RESUME_OK payload: ${reason}`);
  }
}

function cleanup(path: string): void {
  try {
    rmSync(path, { force: true });
    const dir = dirname(path);
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn(
      `[examples/06-resume-from-checkpoint] smoke warning: failed to cleanup ${path}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

function main(): void {
  const save = runNode('dist-examples/06-resume-from-checkpoint/save.js');
  if (save.stdout) {
    process.stdout.write(save.stdout);
  }
  if (save.stderr) {
    process.stderr.write(save.stderr);
  }
  if (save.status !== 0) {
    throw new Error(`save example exited with code ${save.status}`);
  }

  const info = parseSaveOutput(save.stdout);
  ensureCheckpoint(info.cpPath);

  const resume = runNode('dist-examples/06-resume-from-checkpoint/resume.js', [
    info.cpPath,
  ]);
  if (resume.stdout) {
    process.stdout.write(resume.stdout);
  }
  if (resume.stderr) {
    process.stderr.write(resume.stderr);
  }
  if (resume.status !== 0) {
    throw new Error(`resume example exited with code ${resume.status}`);
  }

  parseResumeOutput(resume.stdout);
  cleanup(info.cpPath);

  console.log('EX06_RESUME_SMOKE_OK');
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[examples/06-resume-from-checkpoint] smoke failed:', message);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
}
