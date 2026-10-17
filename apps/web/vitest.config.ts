import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      '@authorization/contracts': resolve(
        __dirname,
        '../../packages/contracts/src',
      ),
      '@authorization/domain': resolve(
        __dirname,
        '../../packages/domain/src',
      ),
      '@authorization/ui': resolve(
        __dirname,
        '../../packages/ui/src',
      ),
    },
  },
});
