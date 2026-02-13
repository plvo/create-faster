import type { NextConfig } from 'next';

const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
  reactStrictMode: true,

  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'date-fns',
      'date-fns-tz',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      'react-day-picker',
      'motion',
    ],
  },

  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },

  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  },
};

export default withBundleAnalyzer(nextConfig);
