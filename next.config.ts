import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {
  ...(process.env.PULSO_REPORT_BROWSER_TEST === '1' ? {
    distDir: '.tmp/next-report-browser',
    typescript: { tsconfigPath: '.tmp/report-browser-tsconfig.json' },
  } : {}),
  // Recorridos de navegador contra un Next de producción sin pisar `.next`, que
  // el `next dev` del desarrollador tiene abierto. Mismo patrón que el anterior.
  ...(process.env.PULSO_POS_BROWSER_TEST === '1' ? {
    distDir: '.tmp/next-pos-browser',
  } : {}),
  // `ws` necesita require nativo para sus addons opcionales. Al empaquetarlo,
  // Webpack sustituía bufferutil ausente por {}, rompiendo las conexiones Neon.
  serverExternalPackages: ["ws"],
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
