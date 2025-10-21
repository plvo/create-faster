import type { Meta, ModuleMeta } from './types';

export const META: Meta = {
  repo: {
    scope: 'root',
    stacks: {
      single: {
        label: 'Single',
        hint: 'Single repository',
      },
      turborepo: {
        label: 'Turborepo',
        hint: 'Monorepo repository',
      },
    },
  },
  web: {
    scope: 'app',
    stacks: {
      nextjs: {
        label: 'Next.js',
        hint: 'React framework with SSR',
        hasBackend: true,
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
      drizzle: {
        label: 'Drizzle',
        hint: 'Lightweight TypeScript ORM',
      },
      prisma: {
        label: 'Prisma',
        hint: 'Type-safe ORM with migrations',
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
      husky: {
        requires: ['git'],
        label: 'Husky',
        hint: 'Git hooks for quality checks',
      },
    },
  },
} as const;

export const MODULES: ModuleMeta = {
  nextjs: {
    shadcn: {
      label: 'shadcn/ui',
      hint: 'Accessible UI components',
      packageName: 'ui',
    },
    pwa: {
      label: 'PWA',
      hint: 'Progressive Web App support',
    },
    trpc: {
      label: 'tRPC',
      hint: 'End-to-end type safety',
      requires: ['database'],
    },
  },
};
