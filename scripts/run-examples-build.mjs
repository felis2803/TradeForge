import { spawn } from 'node:child_process';
import process from 'node:process';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const error = new Error(
        `${command} ${args.join(' ')} exited with code ${code ?? signal ?? 'unknown'}`,
      );
      reject(error);
    });
  });
}

function shouldSkipPackagesBuild() {
  const raw = process.env['TRADEFORGE_SKIP_PACKAGES_BUILD'];
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

const skipPackages = shouldSkipPackagesBuild();

(async () => {
  if (!skipPackages) {
    await run('pnpm', ['run', 'build:packages']);
  }
  await run('pnpm', ['run', 'build:examples']);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
