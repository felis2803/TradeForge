import { mkdir, rename, access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DEFAULT_ROOT_DIR } from '../constants.js';

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function moveFile(src: string, dest: string): Promise<void> {
  await ensureDir(dirname(dest));
  await rename(src, dest);
}

export function resolveRoot(rootDir?: string): string {
  return resolve(rootDir ?? DEFAULT_ROOT_DIR);
}

export async function fileSize(path: string): Promise<number> {
  const info = await stat(path);
  return info.size;
}
