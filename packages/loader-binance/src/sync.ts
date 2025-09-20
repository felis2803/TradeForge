import { unlink } from 'node:fs/promises';
import { ARCHIVE_DEFINITIONS, type ArchiveKind } from './constants.js';
import { resolveDatasetDir, resolveDatasetFile } from './paths.js';
import type { SyncOptions, SyncReport, SyncReportItem } from './types.js';
import { assertDate, assertSymbol } from './utils/validators.js';
import { ensureDir, pathExists, fileSize } from './utils/fs.js';
import { buildArchiveUrl } from './utils/template.js';
import { downloadToTempFile } from './utils/http.js';
import { storeArchive } from './utils/archive.js';

async function handleArchive(
  kind: ArchiveKind,
  symbol: string,
  date: string,
  rootDir: string | undefined,
  baseUrl: string | undefined,
  force: boolean,
  fetchImpl?: typeof fetch,
): Promise<SyncReportItem> {
  const targetPath = resolveDatasetFile(kind, symbol, date, rootDir);
  if (!force && (await pathExists(targetPath))) {
    return { kind, status: 'skipped', path: targetPath };
  }
  const url = buildArchiveUrl(kind, symbol, date, baseUrl);
  const { path: tempPath, bytes } = await downloadToTempFile(url, fetchImpl);
  try {
    await storeArchive(tempPath, targetPath, kind);
  } catch (err) {
    await unlink(tempPath).catch(() => undefined);
    throw err;
  }
  const size = bytes ?? (await fileSize(targetPath));
  return { kind, status: 'downloaded', bytes: size, path: targetPath };
}

export async function syncBinanceDataset(
  options: SyncOptions,
): Promise<SyncReport> {
  const symbol = assertSymbol(options.symbol);
  const date = assertDate(options.date);
  const datasetDir = resolveDatasetDir(symbol, date, options.rootDir);
  await ensureDir(datasetDir);
  const reportItems: SyncReportItem[] = [];
  for (const kind of Object.keys(ARCHIVE_DEFINITIONS) as ArchiveKind[]) {
    const item = await handleArchive(
      kind,
      symbol,
      date,
      options.rootDir,
      options.baseUrl,
      options.force ?? false,
      options.fetchImpl,
    );
    reportItems.push(item);
  }
  return { symbol, date, datasetDir, items: reportItems };
}
