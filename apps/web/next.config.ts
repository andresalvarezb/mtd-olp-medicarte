import path from 'node:path';

import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',

  /*
   * Next 16 usa Turbopack por defecto en producción.
   * El bloque webpack de este archivo se conserva exclusivamente
   * para el flujo local `next dev --webpack`.
   */
  turbopack: {},

  transpilePackages: ['@authorization/ui'],

  webpack(config, { dev }) {
    if (dev) {
      /*
       * En desarrollo evitamos resolver @authorization/contracts
       * contra dist/index.js (CommonJS).
       *
       * Webpack/Fast Refresh debe trabajar contra el source TS.
       * Producción conserva la resolución normal del workspace.
       */
      // Next.js expone este objeto de configuración Webpack como `any`.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      config.resolve.alias = {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        ...config.resolve.alias,

        '@authorization/contracts$': path.resolve(
          process.cwd(),
          '../../packages/contracts/src/index.ts',
        ),
      };
    }

    // Next.js tipa el objeto de configuración Webpack como `any`.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return config;
  },
};

export default config;
