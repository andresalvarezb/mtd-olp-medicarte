import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const requested = process.argv.slice(2).filter((arg) => arg !== '--');
if (requested.length === 0) {
  throw new Error('Uso: pnpm test:focused -- <archivo.test.ts> [otro.test.ts]');
}

const files = requested.map((input) => {
  const file = resolve(root, input);
  const pathFromRoot = relative(root, file);
  if (pathFromRoot.startsWith('..' + sep) || isAbsolute(pathFromRoot)) {
    throw new Error('El archivo de prueba debe estar dentro del repositorio: ' + input);
  }
  if (!/\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || !existsSync(file) || !statSync(file).isFile()) {
    throw new Error('Se esperaba un archivo de prueba existente: ' + input);
  }
  const normalized = pathFromRoot.split(sep).join('/');
  if (!/^(apps|packages)\/.*\.(test|spec)\.[cm]?[jt]sx?$/.test(normalized)) {
    throw new Error('La prueba enfocada debe pertenecer a apps/ o packages/: ' + input);
  }
  return file;
});

const vitestConfig = resolve(root, 'apps/web/vitest.config.ts');
execFileSync(
  process.execPath,
  [process.env.npm_execpath, 'exec', 'vitest', 'run', '--config', vitestConfig, ...files],
  { cwd: root, stdio: 'inherit', env: process.env },
);
