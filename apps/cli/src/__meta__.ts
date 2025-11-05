import type { Meta } from './types/meta';

export const META: Meta = {
  stacks: {
    nextjs: {
      type: 'app',
      scope: 'app',
      label: 'Next.js',
      hint: 'React framework with SSR',
      modules: {
        'UI & Styling': {
          shadcn: {
            label: 'shadcn/ui',
            hint: 'A set of beautifully designed components that you can customize, extend, and build on',
            packageName: 'ui',
          },
          'next-themes': {
            label: 'Next Themes',
            hint: 'A library for managing themes in Next.js',
            packageName: 'themes',
          },
        },
        Features: {
          mdx: {
            label: 'MDX',
            hint: 'Markdown-based content',
          },
          pwa: {
            label: 'PWA',
            hint: 'Progressive Web App support',
          },
        },
        Authentication: {
          'better-auth': {
            label: 'Better Auth',
            hint: 'The most comprehensive authentication framework for TypeScript',
            packageName: 'auth',
          },
        },
        'Data Fetching': {
          'tanstack-query': {
            label: 'TanStack Query',
            hint: 'Powerful asynchronous state management, server-state utilities and data fetching',
          },
          'tanstack-devtools': {
            label: 'TanStack Devtools',
            hint: 'Devtools panel for TanStack libraries and other custom devtools',
          },
        },
        Forms: {
          'react-hook-form': {
            label: 'React Hook Form',
            hint: 'Performant, flexible and extensible forms with easy-to-use validation',
          },
          'tanstack-form': {
            label: 'TanStack Form',
            hint: 'Headless UI for building performant and type-safe forms',
          },
        },
      },
    },
    expo: {
      type: 'app',
      scope: 'app',
      label: 'Expo',
      hint: 'React Native framework',
      modules: {
        'UI & Styling': {
          nativewind: {
            label: 'NativeWind',
            hint: 'Tailwind CSS for React Native',
          },
        },
      },
    },
    hono: {
      type: 'server',
      scope: 'app',
      label: 'Hono',
      hint: 'Fast web framework',
      modules: {
        Cloud: {
          'aws-lambda': {
            label: 'AWS Lambda',
            hint: 'Run on AWS Lambda',
          },
        },
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
} as const;
