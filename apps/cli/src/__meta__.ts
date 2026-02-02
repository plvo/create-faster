// ABOUTME: Single source of truth for all stacks and addons
// ABOUTME: Unified addon system - modules, orm, database, extras all share same interface

import type { Meta } from '@/types/meta';

export const META: Meta = {
  stacks: {
    nextjs: {
      type: 'app',
      label: 'Next.js',
      hint: 'React framework with SSR',
      packageJson: {
        dependencies: {
          next: '^16.1.1',
          react: '^19.2.3',
          'react-dom': '^19.2.3',
          'lucide-react': '^0.487.0',
          'tw-animate-css': '^1.3.4',
        },
        devDependencies: {
          typescript: '^5',
          '@types/node': '^20',
          '@types/react': '^19.2.3',
          '@types/react-dom': '^19.2.3',
          tailwindcss: '^4.1.10',
          '@next/bundle-analyzer': '^16.1.1',
        },
        scripts: {
          analyze: 'next experimental-analyze',
          dev: 'next dev --port {{port}}',
          build: 'next build',
          start: 'next start --port {{port}}',
        },
      },
    },
    expo: {
      type: 'app',
      label: 'Expo',
      hint: 'React Native framework',
      packageJson: {
        dependencies: {
          expo: '~52.0.0',
          'expo-status-bar': '~2.0.0',
          react: '^18.3.1',
          'react-native': '0.76.5',
        },
        devDependencies: {
          typescript: '^5.3.0',
          '@types/react': '~18.3.12',
        },
        scripts: {
          start: 'expo start',
          android: 'expo start --android',
          ios: 'expo start --ios',
          web: 'expo start --web',
        },
      },
    },
    hono: {
      type: 'server',
      label: 'Hono',
      hint: 'Fast web framework',
      packageJson: {
        dependencies: {
          hono: '^4.7.4',
        },
        devDependencies: {
          typescript: '^5',
          '@types/node': '^20',
        },
        scripts: {
          dev: 'bun run --hot src/index.ts',
          start: 'bun run src/index.ts',
        },
      },
    },
    'tanstack-start': {
      type: 'app',
      label: 'TanStack Start',
      hint: 'Full-stack React framework',
      packageJson: {
        dependencies: {
          '@tanstack/react-router': '^1.95.1',
          '@tanstack/start': '^1.95.1',
          react: '^19.2.3',
          'react-dom': '^19.2.3',
          vinxi: '^0.5.1',
        },
        devDependencies: {
          typescript: '^5',
          '@types/react': '^19.2.3',
          '@types/react-dom': '^19.2.3',
          vite: '^6.0.0',
        },
        scripts: {
          dev: 'vinxi dev --port {{port}}',
          build: 'vinxi build',
          start: 'vinxi start --port {{port}}',
        },
      },
    },
  },

  addons: {
    // ==================== MODULES (per-app selection) ====================
    shadcn: {
      type: 'module',
      label: 'shadcn/ui',
      hint: 'A set of beautifully designed components that you can customize, extend, and build on',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      destination: { target: 'package', name: 'ui', singlePath: 'src/components/ui/' },
      packageJson: {
        dependencies: {
          'radix-ui': '^1.4.2',
          'class-variance-authority': '^0.7.1',
          clsx: '^2.1.1',
          cmdk: '^1.1.1',
          vaul: '^1.1.2',
          'tailwind-merge': '^3.3.1',
        },
        devDependencies: {
          '@tailwindcss/postcss': '^4.1.10',
        },
        exports: {
          './': './src/components/',
          './components/*': './src/components/*.tsx',
          './hooks/*': './src/hooks/*.ts',
          './lib/*': './src/lib/*.ts',
        },
      },
    },
    'next-themes': {
      type: 'module',
      label: 'Next Themes',
      hint: 'A library for managing themes in Next.js',
      support: { stacks: ['nextjs'] },
      packageJson: {
        dependencies: {
          'next-themes': '^0.4.6',
        },
      },
    },
    mdx: {
      type: 'module',
      label: 'MDX',
      hint: 'Markdown-based content',
      support: { stacks: ['nextjs'] },
      packageJson: {
        dependencies: {
          '@mdx-js/loader': '^3',
          '@mdx-js/react': '^3',
          '@next/mdx': '^16.1.1',
          'next-mdx-remote': '^5.0.0',
        },
        devDependencies: {
          '@types/mdx': '^2.0.13',
        },
      },
    },
    pwa: {
      type: 'module',
      label: 'PWA',
      hint: 'Progressive Web App support',
      support: { stacks: ['nextjs'] },
      packageJson: {},
    },
    'better-auth': {
      type: 'module',
      label: 'Better Auth',
      hint: 'The most comprehensive authentication framework for TypeScript',
      support: { stacks: ['nextjs'], addons: ['drizzle', 'prisma'] },
      destination: { target: 'package', name: 'auth', singlePath: 'src/lib/auth/' },
      packageJson: {
        dependencies: {
          'better-auth': '^1.4.10',
        },
        exports: {
          '.': './src/index.ts',
          './client': './src/client.ts',
        },
      },
    },
    'tanstack-query': {
      type: 'module',
      label: 'TanStack Query',
      hint: 'Powerful asynchronous state management, server-state utilities and data fetching',
      support: { stacks: 'all' },
      packageJson: {
        dependencies: {
          '@tanstack/react-query': '^5.90.0',
        },
      },
    },
    'tanstack-devtools': {
      type: 'module',
      label: 'TanStack Devtools',
      hint: 'Devtools panel for TanStack libraries and other custom devtools',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      packageJson: {
        devDependencies: {
          '@tanstack/react-devtools': '^0.7.0',
          '@tanstack/react-query-devtools': '^5.90.1',
        },
      },
    },
    'react-hook-form': {
      type: 'module',
      label: 'React Hook Form',
      hint: 'Performant, flexible and extensible forms with easy-to-use validation',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      packageJson: {
        dependencies: {
          'react-hook-form': '^7.56.1',
          '@hookform/resolvers': '^5.2.1',
        },
      },
    },
    'tanstack-form': {
      type: 'module',
      label: 'TanStack Form',
      hint: 'Headless UI for building performant and type-safe forms',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      packageJson: {
        dependencies: {
          '@tanstack/react-form': '^1.23.7',
        },
      },
    },
    nativewind: {
      type: 'module',
      label: 'NativeWind',
      hint: 'A library for styling React Native applications with Tailwind CSS',
      support: { stacks: ['expo'] },
      packageJson: {
        dependencies: {
          nativewind: '^4.1.23',
        },
        devDependencies: {
          tailwindcss: '^3.4.17',
        },
      },
    },
    'aws-lambda': {
      type: 'module',
      label: 'AWS Lambda',
      hint: 'Serverless deployment for Hono',
      support: { stacks: ['hono'] },
      packageJson: {
        dependencies: {
          '@hono/aws-lambda': '^1.0.0',
        },
      },
    },

    // ==================== ORM (global selection) ====================
    drizzle: {
      type: 'orm',
      label: 'Drizzle',
      hint: 'Lightweight TypeScript ORM',
      support: { addons: ['postgres', 'mysql'] },
      destination: { target: 'package', name: 'db', singlePath: 'src/lib/db/' },
      packageJson: {
        dependencies: {
          'drizzle-orm': '^0.38.3',
        },
        devDependencies: {
          'drizzle-kit': '^0.30.1',
        },
        scripts: {
          'db:generate': 'drizzle-kit generate',
          'db:migrate': 'drizzle-kit migrate',
          'db:push': 'drizzle-kit push',
          'db:studio': 'drizzle-kit studio',
          'db:seed': 'bun run scripts/seed.ts',
        },
        exports: {
          '.': './src/index.ts',
          './schema': './src/schema.ts',
          './types': './src/types.ts',
        },
      },
    },
    prisma: {
      type: 'orm',
      label: 'Prisma',
      hint: 'Type-safe ORM with migrations',
      support: { addons: ['postgres', 'mysql'] },
      destination: { target: 'package', name: 'db', singlePath: 'src/lib/db/' },
      packageJson: {
        dependencies: {
          '@prisma/client': '^6.13.0',
        },
        devDependencies: {
          prisma: '^6.13.0',
        },
        scripts: {
          'db:generate': 'prisma generate',
          'db:migrate': 'prisma migrate dev',
          'db:push': 'prisma db push',
          'db:studio': 'prisma studio',
          'db:seed': 'bun run scripts/seed.ts',
        },
        exports: {
          '.': './src/index.ts',
        },
      },
    },

    // ==================== DATABASE (global selection) ====================
    postgres: {
      type: 'database',
      label: 'PostgreSQL',
      hint: 'Relational database',
      destination: { target: 'root' },
      packageJson: {
        dependencies: {
          pg: '^8.13.1',
        },
        devDependencies: {
          '@types/pg': '^8.11.10',
        },
      },
    },
    mysql: {
      type: 'database',
      label: 'MySQL',
      hint: 'Relational database',
      destination: { target: 'root' },
      packageJson: {
        dependencies: {
          mysql2: '^3.11.5',
        },
      },
    },

    // ==================== EXTRAS (global selection) ====================
    biome: {
      type: 'extra',
      label: 'Biome',
      hint: 'Fast linter & formatter',
      destination: { target: 'root' },
      packageJson: {
        devDependencies: {
          '@biomejs/biome': '^2.3.11',
        },
        scripts: {
          format: 'biome format --write .',
          lint: 'biome lint',
        },
      },
    },
    husky: {
      type: 'extra',
      label: 'Husky',
      hint: 'Git hooks',
      destination: { target: 'root' },
      packageJson: {
        devDependencies: {
          husky: '^9',
        },
        scripts: {
          prepare: 'husky',
        },
      },
    },
  },

  repo: {
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
} as const satisfies Meta;
