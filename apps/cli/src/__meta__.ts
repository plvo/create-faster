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
          '@tailwindcss/postcss': '^4.1.10',
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
          'expo-dev-client': '~5.0.0',
          'expo-font': '~13.0.0',
          'expo-router': '~4.0.0',
          'expo-splash-screen': '~0.29.0',
          'expo-status-bar': '~2.0.0',
          react: '^18.3.1',
          'react-native': '0.76.5',
          'react-native-gesture-handler': '~2.20.0',
          'react-native-safe-area-context': '~4.12.0',
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
      moduleType: 'module',
      packageJson: {
        dependencies: {
          '@tanstack/react-router': '^1.160.0',
          '@tanstack/react-start': '^1.160.0',
          react: '^19.2.3',
          'react-dom': '^19.2.3',
        },
        devDependencies: {
          typescript: '^5',
          '@types/node': '^22',
          '@types/react': '^19.2.3',
          '@types/react-dom': '^19.2.3',
          '@tanstack/react-router-devtools': '^1.160.0',
          '@tailwindcss/vite': '^4.1.18',
          '@vitejs/plugin-react': '^4.6.0',
          tailwindcss: '^4.1.18',
          vite: '^7.3.1',
          'vite-tsconfig-paths': '^5.1.4',
        },
        scripts: {
          dev: 'vite dev --port {{port}}',
          build: 'vite build',
          preview: 'vite preview --port {{port}}',
          start: 'node .output/server/index.mjs',
        },
      },
    },
  },

  libraries: {
    shadcn: {
      label: 'shadcn/ui',
      hint: 'A set of beautifully designed components that you can customize, extend, and build on',
      category: 'UI',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      mono: { scope: 'pkg', name: 'ui' },
      packageJson: {
        dependencies: {
          '@radix-ui/react-slot': '^1.2.4',
          'radix-ui': '^1.4.2',
          'class-variance-authority': '^0.7.1',
          clsx: '^2.1.1',
          cmdk: '^1.1.1',
          react: '^19.2.3',
          vaul: '^1.1.2',
          'tailwind-merge': '^3.3.1',
        },
        devDependencies: {
          '@tailwindcss/postcss': '^4.1.10',
          '@types/react': '^19.2.3',
        },
        exports: {
          './': './src/components/',
          './components/*': './src/components/*.tsx',
          './hooks/*': './src/hooks/*.ts',
          './lib/*': './src/lib/*.ts',
          './postcss.config.mjs': './postcss.config.mjs',
        },
      },
    },
    'next-themes': {
      label: 'Next Themes',
      hint: 'A library for managing themes in Next.js',
      category: 'UI',
      support: { stacks: ['nextjs'] },
      packageJson: {
        dependencies: {
          'next-themes': '^0.4.6',
        },
      },
    },
    mdx: {
      label: 'MDX',
      hint: 'Markdown-based content',
      category: 'Content',
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
      label: 'PWA',
      hint: 'Progressive Web App support',
      category: 'Content',
      support: { stacks: ['nextjs'] },
      packageJson: {},
    },
    'better-auth': {
      label: 'Better Auth',
      hint: 'The most comprehensive authentication framework for TypeScript',
      category: 'Auth',
      support: { stacks: ['nextjs'] },
      require: { orm: ['drizzle', 'prisma'] },
      mono: { scope: 'pkg', name: 'auth' },
      packageJson: {
        dependencies: {
          'better-auth': '^1.4.10',
          '@repo/db': '*',
        },
        exports: {
          './route-nextjs': './src/route-nextjs.ts',
          './auth': './src/auth.ts',
          './auth-client': './src/auth-client.ts',
          './types': './src/types.ts',
        },
      },
      envs: [
        {
          value: 'BETTER_AUTH_SECRET= # generate with: openssl rand -base64 32',
          monoScope: [{ pkg: 'auth' }, 'app'],
        },
        {
          value: 'BETTER_AUTH_URL=http://localhost:{{appPort}}',
          monoScope: ['app'],
        },
      ],
    },
    trpc: {
      label: 'tRPC',
      hint: 'End-to-end typesafe APIs',
      category: 'API',
      support: { stacks: ['nextjs'] },
      mono: { scope: 'pkg', name: 'api' },
      packageJson: {
        dependencies: {
          '@repo/auth': '*',
          '@repo/db': '*',
          '@trpc/server': '^11.8.1',
          superjson: '^2.2.6',
          zod: '^4.2.1',
        },
        exports: {
          '.': './src/index.ts',
        },
      },
      appPackageJson: {
        dependencies: {
          '@trpc/client': '^11.8.1',
          '@trpc/server': '^11.8.1',
          '@trpc/tanstack-react-query': '^11.8.1',
          'server-only': '^0.0.1',
          superjson: '^2.2.6',
        },
      },
    },
    'tanstack-query': {
      label: 'TanStack Query',
      hint: 'Powerful asynchronous state management, server-state utilities and data fetching',
      category: 'Data Fetching',
      support: { stacks: 'all' },
      packageJson: {
        dependencies: {
          '@tanstack/react-query': '^5.90.0',
        },
      },
    },
    'tanstack-devtools': {
      label: 'TanStack Devtools',
      hint: 'Devtools panel for TanStack libraries and other custom devtools',
      category: 'Data Fetching',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      packageJson: {
        devDependencies: {
          '@tanstack/react-devtools': '^0.7.0',
          '@tanstack/react-query-devtools': '^5.90.1',
        },
      },
    },
    'react-hook-form': {
      label: 'React Hook Form',
      hint: 'Performant, flexible and extensible forms with easy-to-use validation',
      category: 'Forms',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      packageJson: {
        dependencies: {
          'react-hook-form': '^7.56.1',
          '@hookform/resolvers': '^5.2.1',
        },
      },
    },
    'tanstack-form': {
      label: 'TanStack Form',
      hint: 'Headless UI for building performant and type-safe forms',
      category: 'Forms',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      packageJson: {
        dependencies: {
          '@tanstack/react-form': '^1.23.7',
        },
      },
    },
    nativewind: {
      label: 'NativeWind',
      hint: 'A library for styling React Native applications with Tailwind CSS',
      category: 'UI',
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
      label: 'AWS Lambda',
      hint: 'Serverless deployment for Hono',
      category: 'Deploy',
      support: { stacks: ['hono'] },
      packageJson: {},
    },
  },

  project: {
    database: {
      prompt: 'Include a database?',
      selection: 'single',
      options: {
        postgres: {
          label: 'PostgreSQL',
          hint: 'Relational database',
          mono: { scope: 'root' },
          packageJson: {
            dependencies: {
              pg: '^8.13.1',
            },
            devDependencies: {
              '@types/pg': '^8.11.10',
            },
          },
          envs: [
            {
              value:
                'DATABASE_URL="postgresql://postgres:password@localhost:5432/postgres-{{projectName}}" # Local Docker PostgreSQL',
              monoScope: [{ pkg: 'db' }, 'app'],
            },
          ],
        },
        mysql: {
          label: 'MySQL',
          hint: 'Relational database',
          mono: { scope: 'root' },
          packageJson: {
            dependencies: {
              mysql2: '^3.11.5',
            },
          },
          envs: [
            {
              value: 'DATABASE_URL="mysql://mysql:password@localhost:3306/mysql-{{projectName}}" # Local Docker MySQL',
              monoScope: [{ pkg: 'db' }, 'app'],
            },
          ],
        },
      },
    },
    orm: {
      prompt: 'Configure an ORM?',
      selection: 'single',
      require: ['database'],
      options: {
        drizzle: {
          label: 'Drizzle',
          hint: 'Lightweight TypeScript ORM',
          mono: { scope: 'pkg', name: 'db' },
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
            },
          },
        },
        prisma: {
          label: 'Prisma',
          hint: 'Type-safe ORM with migrations',
          mono: { scope: 'pkg', name: 'db' },
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
      },
    },
    linter: {
      prompt: 'Code quality tools?',
      selection: 'single',
      options: {
        biome: {
          label: 'Biome',
          hint: 'Fast linter & formatter',
          mono: { scope: 'root' },
          packageJson: {
            devDependencies: {
              '@biomejs/biome': '^2.3.11',
            },
            scripts: {
              format: 'biome format --write .',
              lint: 'biome lint',
              check: 'biome check --fix .',
            },
          },
        },
        'eslint-prettier': {
          label: 'ESLint + Prettier',
          hint: 'Lint with ESLint, format with Prettier',
          compose: ['eslint', 'prettier'],
          mono: { scope: 'pkg', name: 'eslint-config' },
          packageJson: {
            devDependencies: {
              'eslint-config-prettier': '^10.1.8',
            },
          },
        },
        eslint: {
          label: 'ESLint',
          hint: 'Most popular JavaScript linter',
          mono: { scope: 'pkg', name: 'eslint-config' },
          packageJson: {
            devDependencies: {
              eslint: '^9.22.0',
              '@eslint/js': '^9.22.0',
              'typescript-eslint': '^8.55.0',
              globals: '^17.3.0',
              'eslint-plugin-react': '^7.37.5',
              'eslint-plugin-react-hooks': '^7.0.1',
              '@next/eslint-plugin-next': '^16.1.6',
            },
            exports: {
              './base': './base.js',
              './next': './next.js',
              './react': './react.js',
              './react-native': './react-native.js',
              './server': './server.js',
            },
          },
          appPackageJson: {
            devDependencies: {
              eslint: '^9.22.0',
            },
            scripts: {
              lint: 'eslint .',
            },
          },
        },
        prettier: {
          label: 'Prettier',
          hint: 'Opinionated code formatter (no linter)',
          mono: { scope: 'root' },
          packageJson: {
            devDependencies: {
              prettier: '^3.8.1',
              'prettier-plugin-tailwindcss': '^0.7.2',
            },
            scripts: {
              format: 'prettier --write .',
              'format:check': 'prettier --check .',
            },
          },
        },
      },
    },
    tooling: {
      prompt: 'Add any extras?',
      selection: 'multi',
      options: {
        husky: {
          label: 'Husky',
          hint: 'Git hooks',
          require: { git: true },
          mono: { scope: 'root' },
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

export type ProjectCategoryName = keyof typeof META.project;
