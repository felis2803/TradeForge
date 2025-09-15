import { createReadStream } from 'node:fs';
import { basename, extname } from 'node:path';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import unzipper from 'unzipper';

export interface FileLines {
  /** file or entry name */
  name: string;
  lines: AsyncIterable<string>;
}

async function* lineSplitter(stream: Readable): AsyncIterable<string> {
  let buf = '';
  for await (const chunk of stream) {
    buf += chunk.toString('utf8');
    let idx = buf.indexOf('\n');
    while (idx >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      yield line;
      idx = buf.indexOf('\n');
    }
  }
  if (buf.length > 0) {
    yield buf.replace(/\r$/, '');
  }
}

async function* openRegular(path: string): AsyncIterable<FileLines> {
  const stream = createReadStream(path);
  stream.setEncoding('utf8');
  yield { name: basename(path), lines: lineSplitter(stream) };
}

async function* openGzip(path: string): AsyncIterable<FileLines> {
  const stream = createReadStream(path).pipe(createGunzip());
  stream.setEncoding('utf8');
  const name = basename(path).replace(/\.gz$/i, '');
  yield { name, lines: lineSplitter(stream as unknown as Readable) };
}

async function* openZip(path: string): AsyncIterable<FileLines> {
  const directory = await unzipper.Open.file(path);
  const entries = [...directory.files].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  for (const entry of entries) {
    const stream = entry.stream();
    stream.setEncoding('utf8');
    yield { name: entry.path, lines: lineSplitter(stream) };
  }
}

export async function* readFileLines(
  paths: string[],
): AsyncIterable<FileLines> {
  for (const p of paths) {
    const ext = extname(p).toLowerCase();
    if (ext === '.gz') {
      yield* openGzip(p);
    } else if (ext === '.zip') {
      yield* openZip(p);
    } else {
      yield* openRegular(p);
    }
  }
}
