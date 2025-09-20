import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { URL } from 'node:url';

export interface DownloadResult {
  path: string;
  bytes: number;
}

function isNodeReadable(value: unknown): value is NodeJS.ReadableStream {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as NodeJS.ReadableStream).pipe === 'function'
  );
}

async function requestViaNode(url: URL): Promise<IncomingMessage> {
  const requester = url.protocol === 'http:' ? httpRequest : httpsRequest;
  return await new Promise<IncomingMessage>((resolve, reject) => {
    const req = requester(url, (res) => {
      const statusCode = res.statusCode ?? 0;
      if (statusCode >= 400 || statusCode === 0) {
        const statusText = res.statusMessage ?? 'Unknown error';
        res.resume();
        reject(
          new Error(
            `Failed to download ${url.toString()}: ${statusCode} ${statusText}`,
          ),
        );
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
    req.end();
  });
}

export async function downloadToTempFile(
  url: string,
  fetchImpl?: typeof fetch,
): Promise<DownloadResult> {
  const urlObject = new URL(url);
  const extMatch = url.match(/\.[a-zA-Z0-9]+(?:\.gz)?$/);
  const ext = extMatch ? extMatch[0] : '';
  const tmpPath = join(tmpdir(), `binance-loader-${randomUUID()}${ext}`);
  const fileStream = createWriteStream(tmpPath);
  if (fetchImpl) {
    const response = await fetchImpl(url);
    if (!response.ok || !response.body) {
      throw new Error(
        `Failed to download ${url}: ${response.status} ${response.statusText}`,
      );
    }
    const body = response.body;
    const nodeStream = isNodeReadable(body)
      ? body
      : Readable.fromWeb(body as globalThis.ReadableStream<Uint8Array>);
    await pipeline(nodeStream, fileStream);
  } else {
    const response = await requestViaNode(urlObject);
    await pipeline(response, fileStream);
  }
  return { path: tmpPath, bytes: fileStream.bytesWritten };
}
