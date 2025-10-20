import type { Meta } from './types';

export const META: Meta = {
  web: {
    scope: 'app',
    stacks: {
      nextjs: {
        label: 'Next.js',
        hint: 'React framework with SSR',
        hasBackend: true,
      },
      astro: {
        label: 'Astro',
        hint: 'Static site generator',
        hasBackend: false,
      },
    },
  },
  api: {
    scope: 'app',
    stacks: {
      hono: {
        label: 'Hono',
        hint: 'Fast web framework',
      },
      express: {
        label: 'Express',
        hint: 'Node.js framework',
      },
    },
  },
  mobile: {
    scope: 'app',
    stacks: {
      expo: {
        label: 'Expo',
        hint: 'React Native framework',
      },
    },
  },
  orm: {
    scope: 'package',
    packageName: 'db',
    stacks: {
      prisma: {
        label: 'Prisma',
        hint: 'Type-safe ORM with migrations',
        requires: ['database'],
      },
      drizzle: {
        label: 'Drizzle',
        hint: 'Lightweight TypeScript ORM',
        requires: ['database'],
      },
    },
  },
  database: {
    scope: 'root',
    stacks: {
      postgres: {
        label: 'PostgreSQL',
        hint: 'Relational database',
        requires: ['orm'],
      },
    },
  },
  extras: {
    scope: 'root',
    stacks: {
      biome: {
        label: 'Biome',
        hint: 'Fast linter & formatter',
      },
      git: {
        label: 'Git',
        hint: 'Version control config',
      },
      husky: {
        label: 'Husky',
        hint: 'Git hooks for quality checks',
      },
    },
  },
} as const;
