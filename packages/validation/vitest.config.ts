import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = dirname(fileURLToPath(import.meta.url));
const fromPkg = (...segments: string[]) => resolve(pkgDir, ...segments);

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: [
      {
        find: '@tradeforge/schemas/v1/trades',
        replacement: fromPkg('../schemas/src/v1/trades.schema.json'),
      },
      {
        find: '@tradeforge/schemas/v1/depth-l2diff',
        replacement: fromPkg('../schemas/src/v1/depth-l2diff.schema.json'),
      },
      {
        find: '@tradeforge/schemas/v1/checkpoint',
        replacement: fromPkg('../schemas/src/v1/checkpoint.schema.json'),
      },
      {
        find: '@tradeforge/schemas/v1/logs',
        replacement: fromPkg('../schemas/src/v1/logs.schema.json'),
      },
      {
        find: '@tradeforge/schemas/v1/metrics',
        replacement: fromPkg('../schemas/src/v1/metrics.schema.json'),
      },
      {
        find: '@tradeforge/schemas',
        replacement: fromPkg('../schemas/src/index.ts'),
      },
    ],
  },
});
