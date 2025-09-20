import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

async function* lineSplitter(stream: Readable): AsyncIterable<string> {
  let buffer = '';
  for await (const chunk of stream) {
    buffer += chunk.toString('utf8');
    let idx = buffer.indexOf('\n');
    while (idx >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (line.length > 0) {
        yield line;
      }
      idx = buffer.indexOf('\n');
    }
  }
  const rest = buffer.trim();
  if (rest.length > 0) {
    yield rest;
  }
}

export async function* readJsonLinesGzip(path: string): AsyncIterable<unknown> {
  const stream = createReadStream(path).pipe(createGunzip());
  for await (const line of lineSplitter(stream as unknown as Readable)) {
    yield JSON.parse(line) as unknown;
  }
}
