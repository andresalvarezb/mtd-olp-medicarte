import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',

    setupFiles: [
      './tests/integration/setup.prodshadow.ts',
    ],

    include: [
      './tests/integration/' +
        'po-operational-cycle.prodshadow.test.ts',
    ],

    testTimeout: 60_000,
    hookTimeout: 30_000,

    sequence: {
      concurrent: false,
    },

    fileParallelism: false,
  },
});
