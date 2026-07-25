import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

const withNextIntl = createNextIntlPlugin('./i18n/config.ts');

export default withNextIntl(nextConfig);
