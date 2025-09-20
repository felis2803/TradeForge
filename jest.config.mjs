import { resolve } from 'path';

export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@tradeforge/core$': '<rootDir>/packages/core/src/index.ts',
    '^@tradeforge/core-orderbook$': '<rootDir>/packages/core-orderbook/src/index.ts',
    '^@tradeforge/io-binance$': '<rootDir>/packages/io-binance/src/index.ts',
    '^@tradeforge/schemas$': '<rootDir>/packages/schemas/src/index.ts',
    '^@tradeforge/schemas/(.*)$': '<rootDir>/packages/schemas/src/$1.schema.json',
    '^@tradeforge/validation$': '<rootDir>/packages/validation/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { useESM: true, tsconfig: resolve('tsconfig.jest.json') },
    ],
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/tests/**/*.test.ts', '**/__tests__/**/*.test.ts'],
  collectCoverage: true,
  coverageProvider: 'v8',
};
