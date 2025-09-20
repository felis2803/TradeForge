import { gzipSync } from 'node:zlib';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nock from 'nock';
import { createCli } from '../src/cli.js';
import { createTradeStream, createDepthStream } from '../src/streams.js';

async function collect(iter, limit = Infinity) {
  const out = [];
  for await (const item of iter) {
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

describe('CLI sync command', () => {
  const baseUrl = 'https://mock.binance.cli';

  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  test('downloads once and reuses cache on rerun', async () => {
    const tradesLines = [
      JSON.stringify({
        timestamp: 1620000100000,
        price: '200.0',
        quantity: '0.3',
        isBuyerMaker: false,
      }),
    ].join('\n');
    const depthLines = [
      JSON.stringify({
        timestamp: 1620000100000,
        bids: [['200', '1']],
        asks: [['201', '1']],
      }),
    ].join('\n');
    const tradesBody = gzipSync(Buffer.from(tradesLines, 'utf8'));
    const depthBody = gzipSync(Buffer.from(depthLines, 'utf8'));

    const scope = nock(baseUrl)
      .get(
        '/data/futures/um/daily/trades/BTCUSDT/BTCUSDT-trades-2021-05-02.json.gz',
      )
      .reply(200, tradesBody)
      .get(
        '/data/futures/um/daily/diffBookDepth/BTCUSDT/BTCUSDT-diffBookDepth-2021-05-02.json.gz',
      )
      .reply(200, depthBody);

    const root = mkdtempSync(join(tmpdir(), 'binance-cli-'));

    await createCli().parseAsync([
      'node',
      'cli',
      'sync',
      '--symbol',
      'BTCUSDT',
      '--date',
      '2021-05-02',
      '--root',
      root,
      '--base-url',
      baseUrl,
    ]);

    expect(scope.isDone()).toBe(true);

    await createCli().parseAsync([
      'node',
      'cli',
      'sync',
      '--symbol',
      'BTCUSDT',
      '--date',
      '2021-05-02',
      '--root',
      root,
      '--base-url',
      baseUrl,
    ]);

    expect(nock.pendingMocks()).toHaveLength(0);

    const trades = await collect(
      createTradeStream({
        symbol: 'BTCUSDT',
        date: '2021-05-02',
        rootDir: root,
      }),
      1,
    );
    const depth = await collect(
      createDepthStream({
        symbol: 'BTCUSDT',
        date: '2021-05-02',
        rootDir: root,
      }),
      1,
    );

    expect(trades[0]?.price).toBeDefined();
    expect(depth[0]?.asks[0]?.price).toBeGreaterThan(0);

    rmSync(root, { recursive: true, force: true });
  });
});
