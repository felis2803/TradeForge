import { join } from 'node:path';
import { resolveRoot } from './utils/fs.js';
import { ARCHIVE_DEFINITIONS } from './constants.js';
import type { ArchiveKind } from './constants.js';

export function resolveDatasetDir(
  symbol: string,
  date: string,
  rootDir?: string,
): string {
  return join(resolveRoot(rootDir), symbol, date);
}

export function resolveDatasetFile(
  kind: ArchiveKind,
  symbol: string,
  date: string,
  rootDir?: string,
): string {
  const dir = resolveDatasetDir(symbol, date, rootDir);
  const def = ARCHIVE_DEFINITIONS[kind];
  return join(dir, def.filename);
}
