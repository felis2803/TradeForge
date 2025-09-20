import { createReadStream, createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import unzipper from 'unzipper';
import { ensureDir } from './fs.js';

export async function storeArchive(
  sourcePath: string,
  targetPath: string,
  kind: 'trades' | 'depth',
): Promise<void> {
  const ext = extname(sourcePath).toLowerCase();
  if (ext === '.gz' || sourcePath.toLowerCase().endsWith('.json.gz')) {
    await ensureDir(dirname(targetPath));
    await pipeline(createReadStream(sourcePath), createWriteStream(targetPath));
    await unlink(sourcePath);
    return;
  }
  if (ext === '.zip') {
    await extractZipEntry(sourcePath, targetPath, kind);
    await unlink(sourcePath);
    return;
  }
  throw new Error(`Unsupported archive format for ${basename(sourcePath)}`);
}

async function extractZipEntry(
  sourcePath: string,
  targetPath: string,
  kind: 'trades' | 'depth',
): Promise<void> {
  const directory = await unzipper.Open.file(sourcePath);
  const normalizedKind = kind === 'trades' ? 'trades' : 'depth';
  const expectedName = `${normalizedKind}.json.gz`;
  const expectedJson = `${normalizedKind}.json`;
  const entry = directory.files.find((file) => {
    const lower = file.path.toLowerCase();
    return lower.endsWith(expectedName) || lower.endsWith(expectedJson);
  });
  if (!entry) {
    const names = directory.files.map((f) => f.path).join(', ');
    throw new Error(
      `Archive ${basename(sourcePath)} does not contain ${expectedName}; entries: ${names}`,
    );
  }
  await ensureDir(dirname(targetPath));
  const stream = entry.stream();
  if (entry.path.toLowerCase().endsWith('.json')) {
    await pipeline(stream, createGzip(), createWriteStream(targetPath));
  } else {
    await pipeline(stream, createWriteStream(targetPath));
  }
}
