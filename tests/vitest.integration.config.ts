import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@authorization/contracts': resolve(__dirname, '../packages/contracts/src'),
      '@authorization/domain': resolve(__dirname, '../packages/domain/src'),
      '@authorization/database': resolve(__dirname, '../packages/database/src'),
    },
  },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['tests/integration/**/*.prodshadow.test.ts'],
    setupFiles: ['tests/integration/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
