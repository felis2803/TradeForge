/* eslint-disable @typescript-eslint/ban-ts-comment */
import { gzipSync } from 'node:zlib';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nock from 'nock';
import { syncBinanceDataset } from '../src/sync.js';
import { createTradeStream, createDepthStream } from '../src/streams.js';

async function collect(iter) {
  const out = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe('syncBinanceDataset', () => {
  const baseUrl = 'https://mock.binance.test';

  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  test('downloads archives and parses streams', async () => {
    const tradesLines = [
      JSON.stringify({
        timestamp: 1620000000000,
        price: '100.0',
        quantity: '0.1',
        isBuyerMaker: false,
      }),
      JSON.stringify({
        timestamp: 1620000000100,
        price: '100.1',
        quantity: '0.2',
        isBuyerMaker: true,
      }),
    ].join('\n');
    const depthLines = [
      JSON.stringify({
        timestamp: 1620000000000,
        bids: [['100', '1']],
        asks: [['101', '2']],
      }),
      JSON.stringify({
        timestamp: 1620000000100,
        bids: [['99', '0.5']],
        asks: [['102', '0.25']],
      }),
    ].join('\n');
    const tradesBody = gzipSync(Buffer.from(tradesLines, 'utf8'));
    const depthBody = gzipSync(Buffer.from(depthLines, 'utf8'));

    nock(baseUrl)
      .get(
        '/data/futures/um/daily/trades/BTCUSDT/BTCUSDT-trades-2021-05-01.json.gz',
      )
      .reply(200, tradesBody, { 'Content-Type': 'application/gzip' });
    nock(baseUrl)
      .get(
        '/data/futures/um/daily/diffBookDepth/BTCUSDT/BTCUSDT-diffBookDepth-2021-05-01.json.gz',
      )
      .reply(200, depthBody, { 'Content-Type': 'application/gzip' });

    const root = mkdtempSync(join(tmpdir(), 'binance-loader-'));

    const report = await syncBinanceDataset({
      symbol: 'BTCUSDT',
      date: '2021-05-01',
      baseUrl,
      rootDir: root,
    });

    expect(report.items.every((item) => item.status === 'downloaded')).toBe(
      true,
    );

    // @ts-ignore branded type casting is not relevant in tests
    const trades = await collect(
      createTradeStream({
        symbol: 'BTCUSDT',
        date: '2021-05-01',
        rootDir: root,
      }),
    );
    // @ts-ignore branded type casting is not relevant in tests
    const depth = await collect(
      createDepthStream({
        symbol: 'BTCUSDT',
        date: '2021-05-01',
        rootDir: root,
      }),
    );

    expect(trades).toHaveLength(2);
    expect(depth).toHaveLength(2);
    expect(trades[0]?.side).toBe('BUY');
    expect(depth[0]?.bids[0]?.qty).toBeGreaterThan(0);

    rmSync(root, { recursive: true, force: true });
  });
});
