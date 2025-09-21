import { join } from 'path';
import { fileURLToPath } from 'url';

const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url));

export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  rootDir: ROOT_DIR,
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@tradeforge/core$': '<rootDir>/packages/core/src/index.ts',
    '^@tradeforge/io-binance$': '<rootDir>/packages/io-binance/src/index.ts',
    '^@tradeforge/loader-binance$':
      '<rootDir>/packages/loader-binance/src/index.ts',
    '^@tradeforge/sim$': '<rootDir>/packages/sim/src/index.ts',
    '^@tradeforge/schemas/v1/(.*)$':
      '<rootDir>/packages/schemas/src/v1/$1.schema.json',
    '^@tradeforge/schemas$': '<rootDir>/packages/schemas/src/index.ts',
    '^@tradeforge/validation$': '<rootDir>/packages/validation/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { useESM: true, tsconfig: join(ROOT_DIR, 'tsconfig.jest.json') },
    ],
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/tests/**/*.test.ts', '**/__tests__/**/*.test.ts'],
  collectCoverage: true,
  coverageProvider: 'v8',
};
