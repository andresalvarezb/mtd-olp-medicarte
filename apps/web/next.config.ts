import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@authorization/contracts', '@authorization/ui'],
};

export default config;
