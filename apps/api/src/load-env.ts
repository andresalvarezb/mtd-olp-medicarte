import { existsSync } from 'node:fs';

for (const envPath of ['../../.env', '.env']) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
    break;
  }
}
