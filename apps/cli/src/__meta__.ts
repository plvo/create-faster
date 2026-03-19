import { $when } from '@/lib/when';
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
    node: {
      type: 'server',
      label: 'Node',
      hint: 'Plain TypeScript',
      packageJson: {
        dependencies: {},
        devDependencies: {
          typescript: '^5.9.3',
          '@types/node': '^22',
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
          'lucide-react': '^0.487.0',
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
          './base.css': './src/base.css',
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
          'better-auth': '^1.5.3',
          '@better-auth/drizzle-adapter': $when({ orm: 'drizzle' }, '^1.5.3'),
          '@better-auth/prisma-adapter': $when({ orm: 'prisma' }, '^1.5.3'),
          '@repo/db': $when({ repo: 'turborepo', orm: true }, '*'),
        },
        exports: {
          './route-nextjs': './src/route-nextjs.ts',
          './auth': './src/auth.ts',
          './auth-client': './src/auth-client.ts',
          './types': './src/types.ts',
          './password': './src/password.ts',
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
          '@repo/auth': $when({ repo: 'turborepo', library: 'better-auth' }, '*'),
          '@repo/db': $when({ repo: 'turborepo', orm: true }, '*'),
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
            main: $when({ repo: 'turborepo' }, './dist/index.js'),
            module: $when({ repo: 'turborepo' }, './dist/index.mjs'),
            types: $when({ repo: 'turborepo' }, './dist/index.d.ts'),
            files: $when({ repo: 'turborepo' }, ['dist/**']),
            dependencies: {
              'drizzle-orm': '^0.45.1',
            },
            devDependencies: {
              '@types/node': '^22',
              'drizzle-kit': '^0.31.9',
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
              '@prisma/client': '^7.0.0',
              '@prisma/adapter-pg': $when({ database: 'postgres' }, '^7.0.0'),
              '@prisma/adapter-mariadb': $when({ database: 'mysql' }, '^7.0.0'),
              mariadb: $when({ database: 'mysql' }, '^3.0.0'),
            },
            devDependencies: {
              '@types/node': '^22',
              dotenv: '^16.0.0',
              prisma: '^7.0.0',
            },
            scripts: {
              'db:generate': 'prisma generate',
              'db:migrate': 'prisma migrate dev',
              'db:push': 'prisma db push',
              'db:studio': 'prisma studio',
              'db:seed': 'prisma db seed',
            },
            types: $when({ repo: 'turborepo' }, './dist/src/index.d.ts'),
            exports: {
              '.': './src/index.ts',
            },
          },
        },
      },
    },
    deployment: {
      prompt: 'Deployment platform?',
      selection: 'single',
      options: {
        sst: {
          label: 'SST',
          hint: 'Deploy to AWS with SST Ion',
          mono: { scope: 'root' },
          packageJson: {
            devDependencies: {
              sst: '^4.2.7',
            },
          },
        },
        'terraform-aws': {
          label: 'Terraform (AWS)',
          hint: 'AWS infrastructure with S3 backend',
          mono: { scope: 'root' },
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
              'eslint-plugin-react': $when({ stack: ['nextjs', 'tanstack-start', 'expo'] }, '^7.37.5'),
              'eslint-plugin-react-hooks': $when({ stack: ['nextjs', 'tanstack-start', 'expo'] }, '^7.0.1'),
              '@next/eslint-plugin-next': $when({ stack: 'nextjs' }, '^16.1.6'),
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
          require: { linter: true },
          mono: { scope: 'root' },
          packageJson: {
            devDependencies: {
              husky: '^9',
              'lint-staged': '^16',
            },
            scripts: {
              prepare: 'husky',
            },
            'lint-staged': {
              '*.{js,ts,cjs,mjs,d.cts,d.mts,jsx,tsx,json,jsonc}': [
                $when({ linter: 'biome' }, 'biome check --write --unsafe --no-errors-on-unmatched'),
                $when({ linter: ['eslint', 'eslint-prettier'] }, 'eslint --fix'),
                $when({ linter: ['prettier', 'eslint-prettier'] }, 'prettier --write'),
              ],
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

  blueprints: {
    'dapp-privy': {
      label: 'dApp (Privy)',
      hint: 'Web3 dApp with Privy wallet auth, wagmi, and user management',
      category: 'Web3',
      context: {
        apps: [
          {
            appName: 'web',
            stackName: 'nextjs',
            libraries: ['shadcn', 'next-themes', 'tanstack-query', 'trpc'],
          },
        ],
        project: {
          database: 'postgres',
          orm: 'drizzle',
        },
      },
      packageJson: {
        dependencies: {
          '@privy-io/react-auth': '^3.16.0',
          '@privy-io/wagmi': '^4.0.2',
          '@privy-io/server-auth': '^1.32.5',
          wagmi: '^3.5.0',
          viem: '^2.47.0',
        },
      },
      envs: [
        {
          value: 'NEXT_PUBLIC_PRIVY_APP_ID=your-privy-app-id',
          monoScope: ['app'],
        },
        {
          value: 'NEXT_PUBLIC_PRIVY_CLIENT_ID=your-privy-client-id',
          monoScope: ['app'],
        },
        {
          value: 'PRIVY_APP_SECRET=your-privy-app-secret',
          monoScope: ['app'],
        },
      ],
    },
    'dapp-rainbowkit': {
      label: 'dApp (RainbowKit)',
      hint: 'Web3 dApp with RainbowKit wallet connection, SIWE auth, and wagmi',
      category: 'Web3',
      context: {
        apps: [
          {
            appName: 'web',
            stackName: 'nextjs',
            libraries: ['shadcn', 'next-themes', 'better-auth', 'tanstack-query', 'trpc'],
          },
        ],
        project: {
          database: 'postgres',
          orm: 'drizzle',
        },
      },
      packageJson: {
        dependencies: {
          '@rainbow-me/rainbowkit': '^2.2.0',
          wagmi: '^2.19.0',
          viem: '^2.38.0',
        },
      },
      envs: [
        {
          value: 'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your-walletconnect-project-id',
          monoScope: ['app'],
        },
      ],
    },
    dashboard: {
      label: 'Dashboard',
      hint: 'Internal CRM-style dashboard with auth, sidebar, and admin panel',
      category: 'Business',
      context: {
        apps: [
          {
            appName: 'web',
            stackName: 'nextjs',
            libraries: ['shadcn', 'better-auth', 'tanstack-query'],
          },
        ],
        project: {
          database: 'postgres',
          orm: 'drizzle',
        },
      },
      packageJson: {
        dependencies: {
          recharts: '^2.15.0',
        },
      },
      envs: [
        {
          value: 'ADMIN_EMAIL=admin@example.com',
          monoScope: ['app'],
        },
      ],
    },
    'lambda-sst': {
      label: 'Lambda (SST)',
      hint: 'AWS Lambda monorepo with API Gateway, SQS worker, and EventBridge cron',
      category: 'AWS',
      context: {
        apps: [
          { appName: 'api', stackName: 'hono', libraries: ['aws-lambda'] },
          { appName: 'cron', stackName: 'node', libraries: [] },
          { appName: 'worker', stackName: 'node', libraries: [] },
        ],
        project: { deployment: 'sst' },
      },
      packageJson: {
        dependencies: {
          '@repo/shared': '*',
        },
        devDependencies: {
          '@types/aws-lambda': '^8.10.0',
        },
        scripts: {
          build: 'bun build src/index.ts --outfile dist/index.js --target node',
        },
      },
    },
    'lambda-terraform-aws': {
      label: 'Lambda (Terraform)',
      hint: 'AWS Lambda monorepo with API Gateway, SQS worker, and EventBridge cron',
      category: 'AWS',
      context: {
        apps: [
          { appName: 'api', stackName: 'hono', libraries: ['aws-lambda'] },
          { appName: 'cron', stackName: 'node', libraries: [] },
          { appName: 'worker', stackName: 'node', libraries: [] },
        ],
        project: { deployment: 'terraform-aws' },
      },
      packageJson: {
        dependencies: {
          '@repo/shared': '*',
        },
        devDependencies: {
          '@types/aws-lambda': '^8.10.0',
        },
        scripts: {
          build: 'bun build src/index.ts --outfile dist/index.js --target node',
        },
      },
    },
    'org-dashboard': {
      label: 'Org Dashboard',
      hint: 'Dashboard with auth, RBAC, admin panel, and example CRUD',
      category: 'Business',
      context: {
        apps: [
          {
            appName: 'web',
            stackName: 'nextjs',
            libraries: [
              'shadcn',
              'better-auth',
              'trpc',
              'tanstack-query',
              'tanstack-devtools',
              'tanstack-form',
              'next-themes',
            ],
          },
          {
            appName: 'batch',
            stackName: 'node',
            libraries: [],
          },
        ],
        project: {
          database: 'postgres',
          orm: 'drizzle',
        },
      },
      packageJson: {
        dependencies: {
          'lucide-react': '^0.487.0',
          'react-error-boundary': '^5.0.0',
          sonner: '^2.0.7',
          zod: '^4.2.1',
        },
      },
      rootPackageJson: {
        dependencies: {
          '@repo/auth': '*',
        },
        scripts: {
          'db:push': 'turbo db:push',
          'db:generate': 'turbo db:generate',
          'db:migrate': 'turbo db:migrate',
          'db:studio': 'turbo db:studio',
          'db:seed': 'bun scripts/seed.ts',
          start: 'turbo start',
        },
      },
    },
    showcase: {
      label: 'Showcase',
      hint: 'SEO/GEO-optimized SaaS landing page with blog and programmatic pages',
      category: 'Business',
      context: {
        apps: [
          {
            appName: 'web',
            stackName: 'nextjs',
            libraries: ['shadcn', 'mdx'],
          },
        ],
        project: {},
      },
      packageJson: {
        dependencies: {
          'posthog-js': '^1.262.0',
          motion: '^12.26.0',
        },
      },
      envs: [
        {
          value: 'NEXT_PUBLIC_POSTHOG_KEY=phc_your-posthog-project-key',
          monoScope: ['app'],
        },
        {
          value: 'NEXT_PUBLIC_SITE_URL=http://localhost:3000',
          monoScope: ['app'],
        },
      ],
    },
  },
} as const satisfies Meta;

export type ProjectCategoryName = keyof typeof META.project;
