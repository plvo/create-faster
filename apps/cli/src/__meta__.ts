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
  database: {
    scope: 'root',
    stacks: {
      postgres: {
        label: 'PostgreSQL',
        hint: 'Relational database',
      },
      mysql: {
        label: 'MySQL',
        hint: 'Relational database',
      },
    },
  },
  orm: {
    scope: 'package',
    packageName: 'db',
    requires: ['database'],
    stacks: {
      prisma: {
        label: 'Prisma',
        hint: 'Type-safe ORM with migrations',
      },
      drizzle: {
        label: 'Drizzle',
        hint: 'Lightweight TypeScript ORM',
      },
    },
  },
  git: {
    scope: 'root',
    stacks: {},
  },
  extras: {
    scope: 'root',
    stacks: {
      biome: {
        label: 'Biome',
        hint: 'Fast linter & formatter',
      },
      husky: {
        requires: ['git'],
        label: 'Husky',
        hint: 'Git hooks for quality checks',
      },
    },
  },
} as const;
