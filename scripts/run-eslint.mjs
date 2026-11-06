import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const existingOptions = process.env.NODE_OPTIONS ?? '';
const heapLimit = '--max-old-space-size=8192';
const nodeOptions = existingOptions.includes('--max-old-space-size=')
  ? existingOptions
  : `${existingOptions} ${heapLimit}`.trim();
const result = spawnSync(
  process.execPath,
  [
    resolve(root, 'node_modules', 'eslint', 'bin', 'eslint.js'),
    'apps',
    'packages',
    'tests',
    '--max-warnings=0',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
