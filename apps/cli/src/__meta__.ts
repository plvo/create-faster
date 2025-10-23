import type { Meta, MetaModule } from './types';

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
  app: {
    scope: 'app',
    stacks: {
      nextjs: {
        label: 'Next.js',
        hint: 'React framework with SSR',
        hasBackend: true,
      },
      // expo: {
      //   label: 'Expo',
      //   hint: 'React Native framework',
      //   hasBackend: false,
      // },
    },
  },
  server: {
    scope: 'app',
    stacks: {
      hono: {
        label: 'Hono',
        hint: 'Fast web framework',
      },
      // express: {
      //   label: 'Express',
      //   hint: 'Node.js framework',
      // },
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

export const MODULES: MetaModule = {
  nextjs: {
    shadcn: {
      label: 'shadcn/ui',
      hint: 'Accessible UI components',
      packageName: 'ui',
    },
    mdx: {
      label: 'MDX',
      hint: 'Markdown-based content',
    },
    pwa: {
      label: 'PWA',
      hint: 'Progressive Web App support',
    },
    'better-auth': {
      label: 'Better Auth',
      hint: 'Authentication library',
      packageName: 'auth',
    },
    // trpc: {
    //   label: 'tRPC',
    //   hint: 'End-to-end type safety',
    //   requires: ['database'],
    // },
  },
  // expo: {
  //   nativewind: {
  //     label: 'NativeWind',
  //     hint: 'Tailwind CSS for React Native',
  //   },
  // },
  // hono: {
  //   openapi: {
  //     label: 'OpenAPI',
  //     hint: 'Auto-generated API docs',
  //   },
  //   jwt: {
  //     label: 'JWT Auth',
  //     hint: 'Authentication middleware',
  //   },
  // },
};
