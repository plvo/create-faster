import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Create Faster',
    short_name: 'create-faster',
    description:
      'A modern CLI scaffolding tool that generates production-ready full-stack projects with multiple framework combinations. Unlike traditional scaffolding tools, create-faster enables you to create multiple applications simultaneously with automatic monorepo orchestration.',
    start_url: '/',
    icons: [
      {
        src: '/web-app-manifest-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/web-app-manifest-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    theme_color: '#ffffff',
    background_color: '#ffffff',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'en-US',
  };
}
