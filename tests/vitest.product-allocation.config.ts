import {
  defineConfig,
} from 'vitest/config';

export default defineConfig({
  test: {
    environment:
      'node',

    setupFiles: [
      './tests/integration/setup.prodshadow.ts',
    ],

    include: [
      './tests/integration/product-allocation-flow.prodshadow.test.ts',
      './tests/integration/inventory-expiration-auto-release.prodshadow.test.ts',
    ],

    testTimeout:
      60_000,

    hookTimeout:
      30_000,

    sequence: {
      concurrent:
        false,
    },

    fileParallelism:
      false,
  },
});
