import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
    // Turbopack trae su propio almacén de certificados. Detrás de un proxy que
    // intercepta TLS (antivirus corporativo, red de empresa) el build muere con
    // `Failed to fetch \`Geist\` from Google Fonts` aunque la red esté bien —
    // `curl` sí llega porque usa los certificados del sistema. Esto le dice a
    // Turbopack que use esos mismos. Sin proxy de por medio no cambia nada.
    turbopackUseSystemTlsCerts: true,
  },
  async redirects() {
    return [
      {
        source: '/dashboard/analytics',
        destination: '/dashboard/branches',
        permanent: true,
      },
      {
        source: '/dashboard/analytics/branches',
        destination: '/dashboard/branches',
        permanent: true,
      },
      {
        source: '/dashboard/analytics/incidents',
        destination: '/dashboard/exceptions',
        permanent: true,
      },
      {
        source: '/dashboard/analytics/trends',
        destination: '/dashboard/branches',
        permanent: true,
      },
      {
        source: '/dashboard/analytics/kpi-builder',
        destination: '/dashboard/branches',
        permanent: true,
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin('./i18n/config.ts');

export default withNextIntl(nextConfig);
