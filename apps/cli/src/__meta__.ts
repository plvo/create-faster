import { $when } from '@/lib/when';
import type { EnvVar, FirstRunStep, Meta, PackageJsonConfig, PostGenerateStep } from '@/types/meta';
import type { StackName } from '@/types/stack-name';

const RUNS_NODE_SERVER: Parameters<typeof $when>[0] = { deployment: { not: ['cloudflare', 'cloudflare-static'] } };

// A Hono app is a Worker only under `cloudflare`. Under `cloudflare-static` it gets no `wrangler.jsonc` (the deployment serves Next.js and TanStack Start), so it keeps its Node or Bun server,
// where `RUNS_NODE_SERVER` would drop it.
const HONO_SERVES_FROM_NODE: Parameters<typeof $when>[0] = { deployment: { not: 'cloudflare' } };

const NODE_TYPES_VERSION = '^22';

/** A production script whose sentence changes when a turborepo root runs it in every app. */
const rootProductionScript = (script: string, description: string, everyAppDescription: string) => [
  $when({ repo: 'single' }, { script, description }),
  $when({ repo: 'turborepo' }, { script, description: everyAppDescription }),
];

const BUILD_FOR_PRODUCTION = rootProductionScript('build', 'Build for production', 'Build every app for production');
const START_PRODUCTION_SERVER = rootProductionScript('start', 'Start the production server', 'Start every app');
const START_EXPO_DEV_SERVER = rootProductionScript('start', 'Start the Expo dev server', 'Start every app');
const PREVIEW_PRODUCTION_BUILD = { script: 'preview', description: 'Preview the production build locally' };
const BUILD_WORKER_BUNDLE = { script: 'build:cf', description: 'Build the Worker bundle' };
const DEPLOY_TO_WORKERS = { script: 'deploy', description: 'Deploy to Cloudflare Workers' };

const NITRO_VERSION = '^3.0.260903-beta';

// Workspace packages type-check on their own, without the app's wrangler-generated binding types.
const WORKERS_TYPES_IN_PACKAGE = $when({ repo: 'turborepo', deployment: 'cloudflare' }, '^5.20261012.1');

const WRANGLER_VERSION = '^4.148.0';

// Privy pins viem exactly: each @privy-io/react-auth release depends on one viem version and each
// @privy-io/wagmi release peers on one, so npm rejects ranges that resolve to releases of different pairs.
const PRIVY_REACT_AUTH_VERSION = '3.49.0';
const PRIVY_WAGMI_VERSION = '4.0.19';
const PRIVY_VIEM_VERSION = '2.57.5';

const TSX_VERSION = '^4.23.15';

// Node runs no TypeScript file of the generated scripts itself; Bun does.
const TSX_RUNNER = $when({ pm: { not: 'bun' } }, TSX_VERSION);

// tsx (and drizzle-kit) install esbuild, and tsx the macOS file watcher fsevents; their install scripts are optional.
const TSX_INSTALL_SCRIPTS = { esbuild: false, fsevents: false };

// wrangler installs esbuild, fsevents and the workerd runtime; their install scripts are optional.
const WRANGLER_INSTALL_SCRIPTS = { esbuild: false, fsevents: false, workerd: false };

// The wallet libraries (wagmi, WalletConnect) install ws and keccak with optional native speedups that have JavaScript fallbacks.
const WALLET_INSTALL_SCRIPTS = { bufferutil: false, 'utf-8-validate': false, keccak: false };

const ESBUILD_VERSION = '^0.28.2';

// Bun bundles a Node target on its own; esbuild needs `require` back for the CommonJS packages it inlines into an ES module.
const BUNDLE_FOR_NODE = `esbuild src/index.ts --bundle --platform=node --target=node22 --format=esm --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"`;

// esbuild needs the define value as a JSON string. The backslashes keep the quotes through sh, which runs the scripts under npm and pnpm.
const INLINE_PRODUCTION_NODE_ENV = '--define:process.env.NODE_ENV=\\"production\\"';

const CLOUDFLARE_TYPEGEN = 'wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts';

// Every Worker of a project reads and writes the local D1, KV and R2 state of the repo root.
const WRANGLER_PERSIST_STATE = '--persist-to {{workspaceRoot}}/.wrangler';

// Wrangler reads no port variable, so the script expands `PORT` itself, in the `sh` it hands to portless (which sets `PORT` and quotes its arguments).
// The arguments a package manager appends to the script reach Wrangler through "$@".
const HONO_WORKER_DEV = `sh -c 'wrangler dev --port=\${PORT:-{{port}}} ${WRANGLER_PERSIST_STATE} "$@"' sh`;

const GENERATE_ROUTE_TREE = 'tsr generate';

const GENERATE_SECRET = 'openssl rand -base64 32';

const START_DOCKER_DATABASE: FirstRunStep[] = [
  { description: 'Start the database', commands: [{ command: 'docker compose up -d --wait' }] },
];

const RUN_LOCAL_SETUP: FirstRunStep[] = [
  { description: 'Set up the local database and seed demo data', commands: [{ script: 'local-setup' }] },
];

const SEED_PASSWORD: EnvVar = { value: 'SEED_PASSWORD=password', monoScope: ['app'], tasks: ['db:seed'] };

const ORG_DASHBOARD_WEB_LIBRARIES = [
  'shadcn',
  'better-auth',
  'trpc',
  'tanstack-query',
  'tanstack-devtools',
  'tanstack-form',
  'next-themes',
];

const ORG_DASHBOARD_HINT =
  'Dashboard with auth, role-based access control (admin/user/manager), admin panel, and example CRUD';

const orgDashboardContext = (webStack: StackName) => ({
  apps: [
    { appName: 'web', stackName: webStack, libraries: ORG_DASHBOARD_WEB_LIBRARIES },
    { appName: 'batch', stackName: 'node' as const, libraries: [] },
  ],
  project: { database: 'postgres', orm: 'drizzle' },
});

const orgDashboardAgentArchitecture = (webFramework: string) =>
  [
    `Organization dashboard: ${webFramework} web app + Node.js batch app (Turborepo), Better Auth`,
    'admin plugin with access-control roles (admin/user/manager), tRPC for typed API calls,',
    'TanStack Query for client data, TanStack Form for form handling, and Drizzle + PostgreSQL.',
    '',
    'Per-aspect detail in `docs/agents/`:',
    '- [Auth & permissions](docs/agents/auth.md)',
    '- [Data layer](docs/agents/data-layer.md)',
  ].join('\n');

const ORG_DASHBOARD_PACKAGE_JSON: PackageJsonConfig = {
  dependencies: {
    'lucide-react': '^1.37.0',
    'react-error-boundary': '^5.0.0',
    sonner: '^2.0.7',
    zod: '^4.5.4',
  },
};

const ORG_DASHBOARD_PKG_PACKAGE_JSON: Record<string, PackageJsonConfig> = {
  auth: {
    exports: {
      './types': './src/types.ts',
      './password': './src/password.ts',
      './permissions': './src/permissions.ts',
    },
  },
  db: {
    scripts: {
      'db:seed': 'cd {{workspaceRoot}} && {{packageManager}} run db:seed',
    },
  },
  ui: {
    exports: {
      './hooks/*': './src/hooks/*.ts',
    },
    dependencies: {
      '@tanstack/react-form': '^1.33.5',
      'react-dom': '^19.2.8',
      vaul: '^1.1.2',
    },
    devDependencies: {
      '@types/react-dom': '^19.2.5',
    },
  },
};

const ORG_DASHBOARD_ROOT_PACKAGE_JSON: PackageJsonConfig = {
  dependencies: {
    '@repo/auth': '*',
    '@repo/db': '*',
  },
  devDependencies: {
    '@repo/config': '*',
    '@faker-js/faker': '^10.4.0',
    tsx: TSX_RUNNER,
  },
  scripts: {
    'local-setup': '{{tsRunner}} scripts/local-setup.ts',
    'db:seed': '{{tsRunner}} --env-file=apps/web/.env scripts/seed.ts',
    start: 'turbo start',
  },
};

const FORMAT_GENERATED_FILES: PostGenerateStep[] = [{ description: 'Format the generated files', script: 'format' }];

const LIBSQL_CLIENT_VERSION = '^0.17.4';

const BETTER_AUTH_VERSION = '^1.7.7';

const NEXT_MDX_REMOTE_VERSION = '^6.0.0';

// The postgres TLS warning parses DATABASE_URL with the same parser as pg; keep it in pg's range.
const PG_CONNECTION_STRING_VERSION = '^2.14.1';

const LEADING_ENV_ASSIGNMENTS = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/;

// portless single-quotes each argument it runs, so a leading `VAR=value` would be executed as a command name.
// The assignments stay in front of `portless`, which hands its environment down to the app.
const wrapWithPortless = (cmd: string): string => {
  const envAssignments = cmd.match(LEADING_ENV_ASSIGNMENTS)?.[0] ?? '';
  const command = cmd.slice(envAssignments.length).replace(/\s*--port\s+\S+/g, '');
  return `${envAssignments}portless run ${command}`;
};

const HONO_ON_NODE: PackageJsonConfig = {
  dependencies: { '@hono/node-server': $when(HONO_SERVES_FROM_NODE, '^2.1.5') },
  devDependencies: { tsx: $when(HONO_SERVES_FROM_NODE, TSX_VERSION) },
  scripts: {
    dev: 'tsx watch src/server.ts --port {{port}}',
    start: $when(HONO_SERVES_FROM_NODE, 'NODE_ENV=production tsx src/server.ts --port {{port}}'),
  },
};

const NODE_ON_NODE: PackageJsonConfig = {
  devDependencies: { tsx: TSX_VERSION },
  scripts: {
    dev: 'tsx watch src/index.ts',
    start: 'NODE_ENV=production tsx src/index.ts',
  },
};

const BUNDLE_LAMBDA_WITH_ESBUILD = (outfile: string, extraFlags = ''): PackageJsonConfig => ({
  devDependencies: { esbuild: ESBUILD_VERSION },
  scripts: { build: `${BUNDLE_FOR_NODE} --outfile=${outfile}${extraFlags}` },
});

export const META: Meta = {
  stacks: {
    nextjs: {
      type: 'app',
      label: 'Next.js',
      hint: 'React framework with SSR',
      productionScripts: [...BUILD_FOR_PRODUCTION, ...START_PRODUCTION_SERVER],
      packageJson: {
        dependencies: {
          next: '^16.3.0',
          react: '^19.2.8',
          'react-dom': '^19.2.8',
          'tw-animate-css': '^1.4.0',
        },
        devDependencies: {
          typescript: '^5',
          '@types/node': NODE_TYPES_VERSION,
          '@types/react': '^19.2.18',
          '@types/react-dom': '^19.2.5',
          tailwindcss: '^4.3.3',
          '@tailwindcss/postcss': '^4.3.3',
        },
        scripts: {
          analyze: 'next experimental-analyze',
          dev: 'next dev --port {{port}}',
          build: 'next build',
          start: $when(RUNS_NODE_SERVER, 'next start --port {{port}}'),
        },
      },
    },
    expo: {
      type: 'app',
      label: 'Expo',
      hint: 'React Native framework',
      productionScripts: [...BUILD_FOR_PRODUCTION, ...START_EXPO_DEV_SERVER],
      packageJson: {
        main: 'expo-router/entry',
        dependencies: {
          expo: '~57.0.28',
          'expo-constants': '~57.0.21',
          'expo-dev-client': '~57.0.20',
          'expo-font': '~57.0.4',
          'expo-linking': '~57.0.12',
          'expo-router': '~57.0.26',
          'expo-splash-screen': '~57.0.10',
          'expo-status-bar': '~57.0.1',
          react: '19.2.3',
          'react-dom': '19.2.3',
          'react-native': '0.86.3',
          'react-native-gesture-handler': '~2.32.0',
          'react-native-reanimated': '4.5.1',
          'react-native-safe-area-context': '~5.7.0',
          'react-native-screens': '~4.26.0',
          'react-native-web': '~0.21.0',
          'react-native-worklets': '0.10.1',
        },
        devDependencies: {
          typescript: '~6.0.3',
          '@types/react': '~19.2.4',
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
      productionScripts: [...BUILD_FOR_PRODUCTION, ...START_PRODUCTION_SERVER],
      installScripts: TSX_INSTALL_SCRIPTS,
      packageJson: {
        dependencies: {
          hono: '^4.7.4',
        },
        devDependencies: {
          typescript: '^5',
          '@types/node': NODE_TYPES_VERSION,
        },
        scripts: {
          dev: 'bun run --port {{port}} --hot src/index.ts',
          start: $when(HONO_SERVES_FROM_NODE, 'NODE_ENV=production bun run --port {{port}} src/index.ts'),
        },
      },
      packageManagerPackageJson: {
        npm: HONO_ON_NODE,
        pnpm: HONO_ON_NODE,
      },
    },
    node: {
      type: 'server',
      label: 'Node',
      hint: 'Plain TypeScript',
      productionScripts: [...BUILD_FOR_PRODUCTION, ...START_PRODUCTION_SERVER],
      installScripts: TSX_INSTALL_SCRIPTS,
      packageJson: {
        dependencies: {},
        devDependencies: {
          typescript: '^5.9.3',
          '@types/node': NODE_TYPES_VERSION,
        },
        scripts: {
          dev: 'bun run --hot src/index.ts',
          start: 'NODE_ENV=production bun run src/index.ts',
        },
      },
      packageManagerPackageJson: {
        npm: NODE_ON_NODE,
        pnpm: NODE_ON_NODE,
      },
    },
    'tanstack-start': {
      type: 'app',
      label: 'TanStack Start',
      hint: 'Full-stack React framework',
      productionScripts: [...BUILD_FOR_PRODUCTION, PREVIEW_PRODUCTION_BUILD, ...START_PRODUCTION_SERVER],
      installScripts: { fsevents: false },
      moduleType: 'module',
      packageJson: {
        dependencies: {
          '@tanstack/react-router': '^1.170.41',
          '@tanstack/react-start': '^1.168.60',
          '@tanstack/router-cli': '^1.167.43',
          react: '^19.2.8',
          'react-dom': '^19.2.8',
        },
        devDependencies: {
          typescript: '^5',
          '@types/node': NODE_TYPES_VERSION,
          '@types/react': '^19.2.18',
          '@types/react-dom': '^19.2.5',
          '@tanstack/react-router-devtools': '^1.167.2',
          '@tailwindcss/vite': '^4.3.3',
          '@vitejs/plugin-react': '^6.1.2',
          nitro: $when(RUNS_NODE_SERVER, NITRO_VERSION),
          tailwindcss: '^4.3.3',
          vite: '^8.3.4',
        },
        scripts: {
          dev: 'vite dev --port {{port}}',
          build: 'vite build',
          preview: 'vite preview --port {{port}}',
          postinstall: GENERATE_ROUTE_TREE,
          start: $when(
            RUNS_NODE_SERVER,
            'node --env-file-if-exists=.env --env-file=.env.start .output/server/index.mjs',
          ),
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
          '@radix-ui/react-slot': '^1.3.3',
          'radix-ui': '^1.6.7',
          'class-variance-authority': '^0.7.1',
          clsx: '^2.1.1',
          cmdk: '^1.1.1',
          'lucide-react': '^1.37.0',
          react: '^19.2.8',
          'tw-animate-css': '^1.4.0',
          'tailwind-merge': '^3.6.0',
        },
        devDependencies: {
          typescript: '^5',
          tailwindcss: '^4.3.3',
          '@tailwindcss/postcss': '^4.3.3',
          '@types/react': '^19.2.18',
        },
        exports: {
          './': './src/components/',
          './base.css': './src/base.css',
          './components/*': './src/components/*.tsx',
          './lib/*': './src/lib/*.ts',
          './postcss.config.mjs': './postcss.config.mjs',
        },
      },
    },
    'next-themes': {
      label: 'Next Themes',
      hint: 'A library for managing themes',
      category: 'UI',
      support: { stacks: ['nextjs', 'tanstack-start'] },
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
      support: { stacks: ['nextjs', 'tanstack-start'] },
      packageJson: {
        dependencies: {
          'remark-frontmatter': '^5.0.0',
          'remark-mdx-frontmatter': '^6.0.0',
        },
        devDependencies: {
          '@types/mdx': '^2.0.14',
        },
      },
      stackPackageJson: {
        nextjs: {
          dependencies: {
            '@mdx-js/loader': '^3.1.1',
            '@mdx-js/react': '^3.1.1',
            '@next/mdx': '^16.3.3',
          },
        },
        'tanstack-start': {
          dependencies: {
            '@mdx-js/rollup': '^3.1.1',
          },
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
      support: { stacks: ['nextjs', 'tanstack-start'] },
      require: { orm: ['drizzle', 'prisma'], database: ['postgres', 'mysql', 'sqlite', 'd1'] },
      needsServerRuntime: true,
      needsSingletonDb: true,
      mono: { scope: 'pkg', name: 'auth' },
      packageJson: {
        dependencies: {
          'better-auth': BETTER_AUTH_VERSION,
          '@better-auth/drizzle-adapter': $when({ orm: 'drizzle' }, BETTER_AUTH_VERSION),
          '@better-auth/prisma-adapter': $when({ orm: 'prisma' }, BETTER_AUTH_VERSION),
          '@repo/db': $when({ repo: 'turborepo', orm: true }, '*'),
        },
        devDependencies: {
          typescript: '^5',
          '@types/node': $when({ repo: 'turborepo' }, NODE_TYPES_VERSION),
          '@cloudflare/workers-types': WORKERS_TYPES_IN_PACKAGE,
        },
        exports: {
          './auth': './src/auth.ts',
          './auth-client': './src/auth-client.ts',
          './session-cache': $when({ stack: 'tanstack-start' }, './src/session-cache.ts'),
        },
      },
      appPackageJson: {
        dependencies: {
          'better-auth': BETTER_AUTH_VERSION,
        },
      },
      envs: [
        {
          value: 'BETTER_AUTH_SECRET=',
          monoScope: [{ pkg: 'auth' }, 'app'],
          secret: true,
          generateCommand: GENERATE_SECRET,
        },
        {
          value: 'BETTER_AUTH_URL={{appUrl}}',
          monoScope: ['app'],
          secret: true,
        },
      ],
    },
    trpc: {
      label: 'tRPC',
      hint: 'End-to-end typesafe APIs',
      category: 'API',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      needsServerRuntime: true,
      needsSingletonDb: true,
      mono: { scope: 'pkg', name: 'api' },
      packageJson: {
        dependencies: {
          '@repo/auth': $when({ repo: 'turborepo', library: 'better-auth' }, '*'),
          '@repo/db': $when({ repo: 'turborepo', orm: true }, '*'),
          'drizzle-orm': $when({ repo: 'turborepo', orm: 'drizzle' }, '^0.45.2'),
          '@trpc/server': '^11.18.0',
          superjson: '^2.2.6',
          zod: '^4.5.4',
        },
        devDependencies: {
          typescript: '^5',
          '@types/node': $when({ repo: 'turborepo' }, NODE_TYPES_VERSION),
          '@cloudflare/workers-types': WORKERS_TYPES_IN_PACKAGE,
          '@types/pg': $when({ repo: 'turborepo', orm: 'drizzle', database: 'postgres' }, '^8'),
        },
        exports: {
          '.': './src/index.ts',
        },
      },
      appPackageJson: {
        dependencies: {
          '@trpc/client': '^11.18.0',
          '@trpc/server': '^11.18.0',
          '@trpc/tanstack-react-query': '^11.18.0',
          superjson: '^2.2.6',
        },
      },
      stackPackageJson: {
        nextjs: {
          dependencies: {
            'server-only': '^0.0.1',
          },
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
          '@tanstack/react-query': '^5.102.8',
        },
      },
      stackPackageJson: {
        'tanstack-start': {
          dependencies: {
            '@tanstack/react-router-ssr-query': '^1.167.3',
          },
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
          '@tanstack/react-devtools': '^0.10.12',
          '@tanstack/react-query-devtools': $when({ library: 'tanstack-query' }, '^5.102.8'),
          '@tanstack/react-form-devtools': $when({ library: 'tanstack-form' }, '^0.2.34'),
        },
      },
      stackPackageJson: {
        'tanstack-start': {
          devDependencies: {
            '@tanstack/devtools-vite': '^0.8.5',
          },
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
          'react-hook-form': '^7.87.0',
          '@hookform/resolvers': '^5.9.1',
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
          '@tanstack/react-form': '^1.33.5',
        },
      },
    },
    nativewind: {
      label: 'NativeWind',
      hint: 'A library for styling React Native applications with Tailwind CSS',
      installScripts: { fsevents: false },
      category: 'UI',
      support: { stacks: ['expo'] },
      packageJson: {
        dependencies: {
          nativewind: '^4.2.7',
          // Same version nativewind pins: its babel setup imports react-native-css-interop/jsx-runtime from the app root.
          'react-native-css-interop': '0.2.7',
        },
        devDependencies: {
          '@babel/plugin-transform-react-jsx': '^7.28.6',
          'babel-preset-expo': '~57.0.15',
          tailwindcss: '^3.4.19',
        },
      },
    },
    'aws-lambda': {
      label: 'AWS Lambda',
      hint: 'Hono runtime adapter for AWS Lambda',
      installScripts: { esbuild: false },
      category: 'Runtime',
      support: { stacks: ['hono'] },
      packageJson: {},
    },
    evlog: {
      label: 'evlog',
      hint: 'Wide-event structured logging with drains and sampling',
      category: 'Observability',
      support: { stacks: ['nextjs', 'hono', 'tanstack-start', 'node'] },
      packageJson: {
        dependencies: {
          evlog: '^2.28.0',
        },
      },
      // evlog peers `nitro@^3.0.260311-beta`. npm matches a prerelease only against a range naming a prerelease of the
      // same major.minor.patch, so it rejects every later nitro beta with ERESOLVE (bun and pnpm do not enforce it).
      // The only nitro inside the peer, 3.0.260311-beta, has published advisories (GHSA-9phm-9p8f-hw5m,
      // GHSA-5w89-w975-hf9q), so npm is told to resolve evlog's peer to the nitro the app installs.
      // `npm ls` reports that nitro as `invalid` in a turborepo; the install, `npm ci` and the build are unaffected.
      rootPackageJson: {
        overrides: {
          evlog: {
            nitro: $when({ ...RUNS_NODE_SERVER, pm: 'npm', stack: 'tanstack-start' }, NITRO_VERSION),
          },
        },
      },
    },
    posthog: {
      label: 'PostHog',
      hint: 'Product analytics proxied first-party through /ingest',
      installScripts: { 'core-js': false },
      category: 'Analytics',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      needsServerRuntime: true,
      packageJson: {
        dependencies: {
          'posthog-js': '^1.435.6',
        },
      },
      stackPackageJson: {
        'tanstack-start': {
          dependencies: {
            '@posthog/react': '^1.11.3',
          },
        },
      },
      envs: [
        {
          value: 'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=phc_your-posthog-project-token',
          monoScope: ['app'],
          stacks: ['nextjs'],
        },
        {
          value: 'VITE_POSTHOG_PROJECT_TOKEN=phc_your-posthog-project-token',
          monoScope: ['app'],
          stacks: ['tanstack-start'],
        },
      ],
    },
    vitest: {
      label: 'Vitest',
      hint: 'A Vite-native testing framework',
      installScripts: { fsevents: false },
      category: 'Testing',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      packageJson: {
        devDependencies: {
          vitest: '^4.1.11',
          '@vitest/coverage-v8': '^4.1.11',
          '@vitejs/plugin-react': '^6.1.2',
          vite: '^8.3.4',
          jsdom: '^30.0.1',
          '@testing-library/react': '^16.3.3',
          '@testing-library/dom': '^10.4.1',
          '@testing-library/jest-dom': '^7.0.1',
          '@testing-library/user-event': '^14.6.6',
        },
        scripts: {
          test: 'vitest run',
          'test:watch': 'vitest',
          'test:coverage': 'vitest run --coverage',
        },
      },
    },
    'vitest-node': {
      label: 'Vitest',
      hint: 'A Vite-native testing framework',
      category: 'Testing',
      support: { stacks: ['hono', 'node'] },
      packageJson: {
        devDependencies: {
          vitest: '^4.1.11',
          '@vitest/coverage-v8': '^4.1.11',
          vite: '^8.2.2',
        },
        scripts: {
          test: 'vitest run',
          'test:watch': 'vitest',
          'test:coverage': 'vitest run --coverage',
        },
      },
    },
    playwright: {
      label: 'Playwright',
      hint: 'Reliable end-to-end testing for modern web apps',
      category: 'Testing',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      packageJson: {
        devDependencies: {
          '@playwright/test': '^1.62.1',
        },
        scripts: {
          'test:e2e': 'playwright test',
          'test:e2e:ui': 'playwright test --ui',
        },
      },
      envs: [{ value: 'BASE_URL={{appUrl}}', monoScope: ['app'] }],
    },
    'jest-expo': {
      label: 'Jest',
      hint: 'Delightful JavaScript testing for Expo',
      installScripts: { fsevents: false },
      category: 'Testing',
      support: { stacks: ['expo'] },
      packageJson: {
        devDependencies: {
          'jest-expo': '~57.0.6',
          jest: '^29.7.0',
          '@babel/runtime': '^7.29.10',
          '@react-native/jest-preset': '^0.86.3',
          '@testing-library/react-native': '^14.1.0',
          // react-reconciler of test-renderer 1.2 matches React 19.2
          'test-renderer': '~1.2.0',
          '@types/jest': '^29.5.14',
        },
        scripts: {
          test: 'jest',
          'test:watch': 'jest --watch',
        },
      },
    },
  },

  project: {
    deployment: {
      prompt: 'Deployment platform?',
      selection: 'single',
      options: {
        cloudflare: {
          label: 'Cloudflare Workers',
          hint: 'Deploy to Cloudflare Workers with Wrangler',
          installScripts: WRANGLER_INSTALL_SCRIPTS,
          productionScripts: [BUILD_WORKER_BUNDLE, PREVIEW_PRODUCTION_BUILD, DEPLOY_TO_WORKERS],
          providesDbBindings: true,
          providesLocalFilesystem: false,
          packageJson: {
            devDependencies: {
              wrangler: WRANGLER_VERSION,
            },
          },
          stackPackageJson: {
            hono: {
              scripts: {
                dev: HONO_WORKER_DEV,
                deploy: 'wrangler deploy',
                preview: `wrangler dev ${WRANGLER_PERSIST_STATE}`,
                'cf-typegen': CLOUDFLARE_TYPEGEN,
                postinstall: CLOUDFLARE_TYPEGEN,
              },
            },
            'tanstack-start': {
              devDependencies: {
                '@cloudflare/vite-plugin': '^1.63.1',
              },
              scripts: {
                deploy: 'vite build && wrangler deploy',
                'cf-typegen': CLOUDFLARE_TYPEGEN,
                postinstall: `${CLOUDFLARE_TYPEGEN} && ${GENERATE_ROUTE_TREE}`,
              },
            },
            nextjs: {
              dependencies: {
                // OpenNext 1.20.12 is the first release that serves Next.js 16.4 (opennextjs/opennextjs-cloudflare#1355)
                // and its `next` peer range starts at 16.4.1, so both ranges start there.
                next: '^16.4.1',
                '@opennextjs/cloudflare': '^1.20.12',
              },
              scripts: {
                'build:cf': `${CLOUDFLARE_TYPEGEN} && opennextjs-cloudflare build`,
                preview: `opennextjs-cloudflare preview -- ${WRANGLER_PERSIST_STATE}`,
                deploy: 'opennextjs-cloudflare deploy',
                'cf-typegen': CLOUDFLARE_TYPEGEN,
                postinstall: CLOUDFLARE_TYPEGEN,
              },
            },
          },
        },
        'cloudflare-static': {
          label: 'Cloudflare Workers (static)',
          hint: 'Deploy a static build (Next.js export, TanStack Start prerender) to Cloudflare Workers assets',
          installScripts: WRANGLER_INSTALL_SCRIPTS,
          productionScripts: [PREVIEW_PRODUCTION_BUILD, DEPLOY_TO_WORKERS],
          require: { stacks: ['nextjs', 'tanstack-start'] },
          providesServerRuntime: false,
          packageJson: {
            devDependencies: {
              wrangler: WRANGLER_VERSION,
            },
          },
          stackPackageJson: {
            nextjs: {
              scripts: {
                deploy: 'next build && wrangler deploy',
                preview: 'wrangler dev',
                'cf-typegen': CLOUDFLARE_TYPEGEN,
              },
            },
            'tanstack-start': {
              scripts: {
                deploy: 'vite build && wrangler deploy',
                preview: 'wrangler dev',
                'cf-typegen': CLOUDFLARE_TYPEGEN,
              },
            },
          },
        },
        sst: {
          label: 'SST',
          hint: 'Deploy to AWS with SST Ion',
          mono: { scope: 'root' },
          providesLocalFilesystem: false,
          packageJson: {
            devDependencies: {
              sst: '^4.17.1',
            },
          },
        },
        'terraform-aws': {
          label: 'Terraform (AWS)',
          hint: 'AWS infrastructure with S3 backend',
          mono: { scope: 'root' },
          providesLocalFilesystem: false,
        },
      },
    },
    database: {
      prompt: 'Include a database?',
      selection: 'single',
      options: {
        postgres: {
          label: 'PostgreSQL',
          hint: 'Relational database',
          mono: { scope: 'root' },
          serverlessBinding: 'hyperdrive',
          firstRun: START_DOCKER_DATABASE,
          packageJson: {
            dependencies: {
              pg: '^8.23.0',
            },
            devDependencies: {
              '@types/pg': '^8.23.1',
            },
          },
          deploymentPackageJson: {
            cloudflare: {
              dependencies: {
                'pg-cloudflare': '^1.4.0',
              },
            },
          },
          envs: [
            {
              value:
                'DATABASE_URL="postgresql://postgres:password@localhost:{{dbPort}}/postgres-{{projectName}}?sslmode=disable" # Local Docker PostgreSQL, no TLS: never use this URL in production',
              monoScope: [{ pkg: 'db' }, 'app'],
              tasks: ['db:seed'],
              secret: { deployment: 'sst' },
            },
          ],
        },
        mysql: {
          label: 'MySQL',
          hint: 'Relational database',
          mono: { scope: 'root' },
          serverlessBinding: 'hyperdrive',
          firstRun: START_DOCKER_DATABASE,
          packageJson: {
            dependencies: {
              mysql2: '^3.24.2',
            },
          },
          envs: [
            {
              value:
                'DATABASE_URL="mysql://mysql:password@localhost:{{dbPort}}/mysql-{{projectName}}?ssl=false" # Local Docker MySQL, no TLS: never use this URL in production',
              monoScope: [{ pkg: 'db' }, 'app'],
              tasks: ['db:seed'],
              secret: { deployment: 'sst' },
            },
          ],
        },
        sqlite: {
          label: 'SQLite',
          hint: 'Local file database, no server needed',
          mono: { scope: 'root' },
          needsLocalFilesystem: true,
          packageJson: {
            dependencies: {
              '@libsql/client': LIBSQL_CLIENT_VERSION,
            },
          },
          stackPackageJson: {
            'tanstack-start': {
              dependencies: {
                '@libsql/client': $when(RUNS_NODE_SERVER, LIBSQL_CLIENT_VERSION),
              },
            },
          },
          envs: [
            {
              value: 'DATABASE_URL="file:./db.sqlite" # Local SQLite file, created by db:migrate',
              monoScope: [{ pkg: 'db' }, 'app'],
              tasks: ['db:seed'],
            },
          ],
        },
        d1: {
          label: 'Cloudflare D1',
          hint: 'Managed SQLite on Cloudflare, accessed via the DB binding',
          mono: { scope: 'root' },
          require: { deployment: ['cloudflare'] },
          serverlessBinding: 'd1',
          serverlessConsumersWired: true,
          packageJson: {
            devDependencies: {
              '@libsql/client': LIBSQL_CLIENT_VERSION,
            },
            scripts: {
              'db:generate': 'drizzle-kit generate',
              'db:migrate': `wrangler d1 migrations apply DB --local ${WRANGLER_PERSIST_STATE}`,
              'db:migrate:local': `wrangler d1 migrations apply DB --local ${WRANGLER_PERSIST_STATE}`,
              'db:migrate:remote': 'wrangler d1 migrations apply DB --remote',
              'local-setup': `{{packageManager}} run db:generate && wrangler d1 migrations apply DB --local ${WRANGLER_PERSIST_STATE} && {{packageManager}} run db:seed`,
            },
          },
          deploymentPackageJson: {
            cloudflare: {
              devDependencies: {
                wrangler: WRANGLER_VERSION,
              },
              scripts: {
                'db:migrate': $when(
                  { repo: 'turborepo' },
                  `wrangler --config {{workspaceRoot}}/apps/{{deployAppDir}}/wrangler.jsonc d1 migrations apply DB --local ${WRANGLER_PERSIST_STATE}`,
                ),
                'db:migrate:local': $when(
                  { repo: 'turborepo' },
                  `wrangler --config {{workspaceRoot}}/apps/{{deployAppDir}}/wrangler.jsonc d1 migrations apply DB --local ${WRANGLER_PERSIST_STATE}`,
                ),
                'db:migrate:remote': $when(
                  { repo: 'turborepo' },
                  'wrangler --config {{workspaceRoot}}/apps/{{deployAppDir}}/wrangler.jsonc d1 migrations apply DB --remote',
                ),
                'local-setup': $when(
                  { repo: 'turborepo' },
                  `{{packageManager}} run db:generate && wrangler --config {{workspaceRoot}}/apps/{{deployAppDir}}/wrangler.jsonc d1 migrations apply DB --local ${WRANGLER_PERSIST_STATE} && {{packageManager}} run db:seed`,
                ),
              },
            },
          },
          envs: [
            {
              value: 'CLOUDFLARE_ACCOUNT_ID="" # Cloudflare account id (drizzle-kit d1-http)',
              monoScope: [{ pkg: 'db' }],
              when: { orm: true },
              file: 'd1',
            },
            {
              value: 'CLOUDFLARE_D1_DATABASE_ID="" # D1 database id from `wrangler d1 create`',
              monoScope: [{ pkg: 'db' }],
              when: { orm: true },
              file: 'd1',
            },
            {
              value: 'CLOUDFLARE_API_TOKEN="" # Cloudflare API token with D1 edit permission',
              monoScope: [{ pkg: 'db' }],
              when: { orm: true },
              file: 'd1',
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
          installScripts: TSX_INSTALL_SCRIPTS,
          mono: { scope: 'pkg', name: 'db' },
          interactiveScripts: ['db:push'],
          firstRun: [
            {
              description: 'Create the migrations from the schema and apply them',
              commands: [{ script: 'db:generate' }, { script: 'db:migrate' }],
            },
          ],
          packageJson: {
            main: $when({ repo: 'turborepo' }, './dist/index.js'),
            module: $when({ repo: 'turborepo' }, './dist/index.mjs'),
            types: $when({ repo: 'turborepo' }, './dist/index.d.ts'),
            files: $when({ repo: 'turborepo' }, ['dist/**']),
            dependencies: {
              'drizzle-orm': '^0.45.2',
              'pg-connection-string': $when(
                { database: 'postgres', deployment: { not: 'cloudflare' } },
                PG_CONNECTION_STRING_VERSION,
              ),
            },
            devDependencies: {
              typescript: '^5',
              '@types/node': NODE_TYPES_VERSION,
              '@cloudflare/workers-types': WORKERS_TYPES_IN_PACKAGE,
              'drizzle-kit': '^0.31.10',
              dotenv: '^17.4.2',
              tsx: TSX_RUNNER,
            },
            scripts: {
              'db:generate': 'drizzle-kit generate',
              'db:migrate': 'drizzle-kit migrate',
              'db:push': 'drizzle-kit push',
              'db:studio': 'drizzle-kit studio',
              'db:seed': '{{tsRunner}} scripts/seed.ts',
            },
            exports: {
              '.': './src/index.ts',
              './schema': './src/schema.ts',
            },
          },
        },
        prisma: {
          label: 'Prisma',
          hint: 'Type-safe ORM with migrations',
          installScripts: { ...TSX_INSTALL_SCRIPTS, '@prisma/engines': true, prisma: false },
          require: { database: ['postgres', 'mysql'] },
          mono: { scope: 'pkg', name: 'db' },
          interactiveScripts: ['db:migrate'],
          firstRun: [
            {
              description: 'Generate the client and create the tables from the schema',
              commands: [{ script: 'db:generate' }, { script: 'db:push' }],
            },
          ],
          packageJson: {
            dependencies: {
              '@prisma/client': '^7.10.0',
              '@prisma/adapter-pg': $when({ database: 'postgres' }, '^7.10.0'),
              'pg-connection-string': $when(
                { database: 'postgres', deployment: { not: 'cloudflare' } },
                PG_CONNECTION_STRING_VERSION,
              ),
              '@prisma/adapter-mariadb': $when({ database: 'mysql' }, '^7.10.0'),
              mariadb: $when({ database: 'mysql' }, '^3.5.3'),
            },
            devDependencies: {
              typescript: '^5',
              '@types/node': NODE_TYPES_VERSION,
              '@cloudflare/workers-types': WORKERS_TYPES_IN_PACKAGE,
              dotenv: '^17.4.2',
              prisma: '^7.10.0',
              tsx: TSX_RUNNER,
            },
            scripts: {
              'db:generate': 'prisma generate',
              'db:migrate': 'prisma migrate dev',
              'db:push': 'prisma db push',
              'db:studio': 'prisma studio',
              'db:seed': 'prisma db seed',
              predev: $when({ repo: 'single' }, 'prisma generate'),
              prebuild: $when({ repo: 'single' }, 'prisma generate'),
            },
            types: $when({ repo: 'turborepo' }, './dist/src/index.d.ts'),
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
          // `biome format` leaves the import order alone, which `biome check` enforces: its `check` script (`--fix`) runs both.
          postGenerate: [{ description: 'Format the generated files', script: 'check' }],
          packageJson: {
            devDependencies: {
              '@biomejs/biome': '^2.5.11',
            },
            scripts: {
              format: 'biome format --write .',
              lint: 'biome lint',
              check: 'biome check --fix .',
            },
          },
        },
        oxc: {
          label: 'Oxlint + Oxfmt',
          hint: 'Fast Rust linter & formatter with ESLint-compatible plugins',
          mono: { scope: 'root' },
          postGenerate: FORMAT_GENERATED_FILES,
          packageJson: {
            devDependencies: {
              oxlint: '^1.86.0',
              oxfmt: '^0.71.0',
              '@shadcn/lint': $when({ library: 'shadcn' }, '^0.2.0'),
            },
            scripts: {
              lint: 'oxlint',
              format: 'oxfmt',
              check: 'oxlint --fix && oxfmt',
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
              'typescript-eslint': '^8.68.0',
              globals: '^17.11.0',
              'eslint-plugin-react': $when({ stack: ['nextjs', 'tanstack-start', 'expo'] }, '^7.37.5'),
              'eslint-plugin-react-hooks': $when({ stack: ['nextjs', 'tanstack-start', 'expo'] }, '^7.1.1'),
              '@next/eslint-plugin-next': $when({ stack: 'nextjs' }, '^16.3.3'),
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
          postGenerate: FORMAT_GENERATED_FILES,
          packageJson: {
            devDependencies: {
              prettier: '^3.9.6',
              'prettier-plugin-tailwindcss': '^0.8.1',
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
          require: { git: true, linter: true },
          mono: { scope: 'root' },
          packageJson: {
            devDependencies: {
              husky: '^9.1.7',
              'lint-staged': '^17.4.1',
            },
            scripts: {
              prepare: 'husky',
            },
            'lint-staged': {
              '*.{js,ts,cjs,mjs,d.cts,d.mts,jsx,tsx,json,jsonc}': [
                $when({ linter: 'biome' }, 'biome check --write --unsafe --no-errors-on-unmatched'),
                $when({ linter: ['eslint', 'eslint-prettier'] }, 'eslint --fix'),
                $when({ linter: ['prettier', 'eslint-prettier'] }, 'prettier --write'),
                $when({ linter: 'oxc' }, 'oxlint --fix --no-error-on-unmatched-pattern'),
                $when({ linter: 'oxc' }, 'oxfmt --no-error-on-unmatched-pattern'),
              ],
            },
          },
        },
        portless: {
          label: 'Portless',
          hint: 'Named .localhost URLs for local dev',
          mono: { scope: 'root' },
          packageJson: {
            devDependencies: {
              portless: '^0.15.6',
            },
          },
          runtime: {
            appScripts: {
              dev: wrapWithPortless,
              'start:portless': { from: 'start', wrap: wrapWithPortless },
            },
            resolveAppUrl: ({ projectName, appName, isTurborepo }) =>
              `https://${isTurborepo ? appName : projectName}.localhost:1355`,
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
    'dapp-privy-nextjs': {
      label: 'dApp (Privy)',
      hint: 'Web3 dApp with Privy wallet auth, wagmi, and user management',
      installScripts: { ...WALLET_INSTALL_SCRIPTS, '@reown/appkit': false },
      category: 'Web3',
      agentArchitecture: [
        'Web3 dApp: single Next.js app with Privy wallet authentication and wagmi, a tRPC API',
        'layer backed by TanStack Query, and a wallet-centric Drizzle + PostgreSQL schema.',
        "Privy's `privy-token` cookie drives both edge-proxy and server-layout route protection,",
        'and tRPC verifies it server-side to gate protected procedures.',
        '',
        'Per-aspect detail in `docs/agents/`:',
        '- [Wallet auth](docs/agents/wallet-auth.md)',
        '- [Data layer](docs/agents/data-layer.md)',
      ].join('\n'),
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
          '@privy-io/react-auth': PRIVY_REACT_AUTH_VERSION,
          '@privy-io/wagmi': PRIVY_WAGMI_VERSION,
          '@privy-io/server-auth': '^1.32.5',
          wagmi: '^3.7.7',
          viem: PRIVY_VIEM_VERSION,
        },
      },
      envs: [
        {
          value: 'NEXT_PUBLIC_PRIVY_APP_ID=replace-with-privy-app-id',
          monoScope: ['app'],
        },
        {
          value: 'NEXT_PUBLIC_PRIVY_CLIENT_ID=your-privy-client-id',
          monoScope: ['app'],
        },
        {
          value: 'PRIVY_APP_SECRET=your-privy-app-secret',
          monoScope: ['app'],
          secret: true,
        },
      ],
    },
    'dapp-rainbowkit-nextjs': {
      label: 'dApp (RainbowKit)',
      hint: 'Web3 dApp with RainbowKit wallet connection, SIWE auth, and wagmi',
      installScripts: WALLET_INSTALL_SCRIPTS,
      category: 'Web3',
      agentArchitecture: [
        'Web3 dApp: single Next.js app with RainbowKit wallet connection, Sign-In With Ethereum',
        "via Better Auth's SIWE plugin, wagmi, and a wallet-aware Drizzle + PostgreSQL schema.",
        "Wallet connect drives RainbowKit's authentication adapter through nonce/message/verify,",
        'and server-side session checks guard `/protected` routes.',
        '',
        'Per-aspect detail in `docs/agents/`:',
        '- [Wallet auth (SIWE)](docs/agents/wallet-auth.md)',
        '- [Data layer](docs/agents/data-layer.md)',
      ].join('\n'),
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
          '@rainbow-me/rainbowkit': '^2.2.11',
          wagmi: '^2.19.5',
          viem: '^2.56.1',
        },
      },
      envs: [
        {
          value: 'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your-walletconnect-project-id',
          monoScope: ['app'],
        },
      ],
    },
    'lambda-sst-hono': {
      label: 'Lambda (SST)',
      hint: 'AWS Lambda monorepo with API Gateway, SQS worker, and EventBridge cron',
      category: 'AWS',
      agentArchitecture: [
        'Serverless AWS monorepo (SST Ion): a Hono API on API Gateway V2, an SQS-driven worker',
        'with partial batch failure, and an EventBridge cron, sharing one typed `QueueMessage`',
        'contract. Deploys run through stage-aware GitHub Actions using OIDC role assumption.',
        '',
        'Per-aspect detail in `docs/agents/`:',
        '- [Infrastructure](docs/agents/infrastructure.md)',
        '- [Messaging](docs/agents/messaging.md)',
      ].join('\n'),
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
      packageManagerPackageJson: {
        npm: BUNDLE_LAMBDA_WITH_ESBUILD('dist/index.js'),
        pnpm: BUNDLE_LAMBDA_WITH_ESBUILD('dist/index.js'),
      },
    },
    'lambda-terraform-aws-hono': {
      label: 'Lambda (Terraform)',
      hint: 'AWS Lambda monorepo with API Gateway, SQS worker, and EventBridge cron',
      category: 'AWS',
      agentArchitecture: [
        'Serverless AWS monorepo (Terraform): a Hono API on API Gateway, an SQS worker with',
        'partial batch failures, and an EventBridge cron, plus modular Terraform IaC, a justfile',
        'for ops, a shared typed message contract, and OIDC-based GitHub Actions CD.',
        '',
        'Per-aspect detail in `docs/agents/`:',
        '- [Infrastructure](docs/agents/infrastructure.md)',
        '- [Messaging](docs/agents/messaging.md)',
      ].join('\n'),
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
          build: 'NODE_ENV=production bun build src/index.ts --outfile dist/index.mjs --target node',
        },
      },
      packageManagerPackageJson: {
        npm: BUNDLE_LAMBDA_WITH_ESBUILD('dist/index.mjs', ` ${INLINE_PRODUCTION_NODE_ENV}`),
        pnpm: BUNDLE_LAMBDA_WITH_ESBUILD('dist/index.mjs', ` ${INLINE_PRODUCTION_NODE_ENV}`),
      },
    },
    'org-dashboard-nextjs': {
      label: 'Org Dashboard',
      hint: ORG_DASHBOARD_HINT,
      category: 'Business',
      firstRun: RUN_LOCAL_SETUP,
      agentArchitecture: orgDashboardAgentArchitecture('Next.js'),
      context: orgDashboardContext('nextjs'),
      packageJson: ORG_DASHBOARD_PACKAGE_JSON,
      pkgPackageJson: ORG_DASHBOARD_PKG_PACKAGE_JSON,
      rootPackageJson: ORG_DASHBOARD_ROOT_PACKAGE_JSON,
      envs: [SEED_PASSWORD],
    },
    'org-dashboard-tanstack-start': {
      label: 'Org Dashboard (TanStack Start)',
      hint: ORG_DASHBOARD_HINT,
      category: 'Business',
      extends: 'org-dashboard-nextjs',
      firstRun: RUN_LOCAL_SETUP,
      agentArchitecture: orgDashboardAgentArchitecture('TanStack Start'),
      context: orgDashboardContext('tanstack-start'),
      packageJson: ORG_DASHBOARD_PACKAGE_JSON,
      pkgPackageJson: ORG_DASHBOARD_PKG_PACKAGE_JSON,
      rootPackageJson: ORG_DASHBOARD_ROOT_PACKAGE_JSON,
      envs: [SEED_PASSWORD],
    },
    'multitenant-saas-nextjs': {
      label: 'Multitenant SaaS',
      hint: 'B2B SaaS dashboard with orgs, custom RBAC, and link-based invitations',
      category: 'Business',
      firstRun: RUN_LOCAL_SETUP,
      agentArchitecture: [
        'Multi-tenant SaaS starter: Next.js web app + Node.js batch app (Turborepo) with shared',
        '`packages/auth`, `packages/db`, `packages/api`, and `packages/ui`. Better Auth',
        '(organizations as tenants + a custom access-control model with built-in and dynamic',
        'roles), tRPC with org-scoped RBAC middleware, TanStack Query, TanStack Form, and',
        'Drizzle + PostgreSQL.',
        '',
        'Per-aspect detail in `docs/agents/`:',
        '- [Auth & RBAC](docs/agents/auth-rbac.md)',
        '- [Multi-tenancy](docs/agents/multi-tenancy.md)',
        '- [Data layer](docs/agents/data-layer.md)',
      ].join('\n'),
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
          '@hugeicons/react': '^1.1.6',
          '@hugeicons/core-free-icons': '^4.1.1',
          'lucide-react': '^1.37.0',
          'react-error-boundary': '^5.0.0',
          sonner: '^2.0.7',
          zod: '^4.5.4',
        },
      },
      pkgPackageJson: {
        auth: {
          exports: {
            './types': './src/types.ts',
            './permissions': './src/permissions.ts',
          },
        },
        api: {
          dependencies: {
            'better-auth': BETTER_AUTH_VERSION,
          },
        },
        db: {
          scripts: {
            'db:seed': 'cd {{workspaceRoot}} && {{packageManager}} run db:seed',
          },
        },
        ui: {
          exports: {
            './hooks/*': './src/hooks/*.ts',
          },
          dependencies: {
            '@tanstack/react-form': '^1.33.5',
          },
        },
      },
      rootPackageJson: {
        dependencies: {
          '@repo/auth': '*',
          '@repo/db': '*',
        },
        devDependencies: {
          '@faker-js/faker': '^10.4.0',
          tsx: TSX_RUNNER,
        },
        scripts: {
          'local-setup': '{{tsRunner}} scripts/local-setup.ts',
          'db:seed': '{{tsRunner}} --env-file=apps/web/.env scripts/seed.ts',
          start: 'turbo start',
        },
      },
      envs: [
        {
          value: 'NEXT_PUBLIC_APP_URL={{appUrl}}',
          stacks: ['nextjs'],
          monoScope: ['app'],
        },
        SEED_PASSWORD,
      ],
    },
    'cloudflare-static-site-nextjs': {
      label: 'Cloudflare Static Site',
      hint: 'Static Next.js marketing site with an MDX blog, deployed as Cloudflare Workers assets',
      category: 'Business',
      agentArchitecture: [
        "Static marketing/blog site: a single Next.js app (output: 'export') with shadcn/ui and an",
        'MDX blog, JSON-LD structured data, a dynamic sitemap, AI-bot-aware robots, and programmatic',
        'persona pages — all pre-rendered at build time. No server runtime: the export is served as',
        'Cloudflare Workers static assets via Wrangler (never Pages).',
        '',
        'Per-aspect detail in `docs/agents/`:',
        '- [SEO & GEO](docs/agents/seo-geo.md)',
        '- [Content & blog](docs/agents/content-blog.md)',
        '- [Cloudflare deploy](docs/agents/cloudflare-deploy.md)',
      ].join('\n'),
      context: {
        apps: [
          {
            appName: 'web',
            stackName: 'nextjs',
            libraries: ['shadcn', 'mdx'],
          },
        ],
        project: {
          deployment: 'cloudflare-static',
        },
      },
      packageJson: {
        dependencies: {
          motion: '^12.26.0',
          'next-mdx-remote': NEXT_MDX_REMOTE_VERSION,
        },
      },
      envs: [
        {
          value: 'NEXT_PUBLIC_APP_URL={{appUrl}}',
          stacks: ['nextjs'],
          monoScope: ['app'],
        },
      ],
    },
    'cloudflare-fullstack-nextjs': {
      label: 'Cloudflare Fullstack',
      hint: 'Auth + RBAC dashboard with a documents CRUD on D1, R2 uploads, and a cron Worker — all on Cloudflare',
      category: 'Business',
      firstRun: RUN_LOCAL_SETUP,
      agentArchitecture: [
        'Fullstack Cloudflare app: a Next.js (OpenNext) web app + a Hono cron Worker (Turborepo),',
        'Better Auth with the admin plugin + access-control (admin/user/manager), tRPC for typed',
        'APIs, TanStack Query for client data, Drizzle on Cloudflare D1, and direct-binding R2',
        'uploads. The cron Worker purges expired documents (D1 rows + R2 objects) on a schedule.',
        '',
        'Per-aspect detail in `docs/agents/`:',
        '- [Auth & RBAC](docs/agents/auth-rbac.md)',
        '- [Data layer (D1 + Drizzle)](docs/agents/data-layer.md)',
        '- [Storage (R2)](docs/agents/storage.md)',
        '- [Cloudflare deploy](docs/agents/cloudflare-deploy.md)',
      ].join('\n'),
      context: {
        apps: [
          {
            appName: 'web',
            stackName: 'nextjs',
            libraries: ['shadcn', 'next-themes', 'better-auth', 'trpc', 'tanstack-query', 'tanstack-form'],
          },
          {
            appName: 'cron',
            stackName: 'hono',
            libraries: [],
          },
        ],
        project: {
          database: 'd1',
          orm: 'drizzle',
          deployment: 'cloudflare',
        },
      },
      packageJson: {
        dependencies: {
          'lucide-react': '^1.37.0',
          sonner: '^2.0.7',
          zod: '^4.5.4',
        },
      },
      pkgPackageJson: {
        auth: {
          exports: {
            './types': './src/types.ts',
            './permissions': './src/permissions.ts',
          },
        },
        db: {
          scripts: {
            'db:seed': 'cd {{workspaceRoot}} && {{packageManager}} run db:seed',
          },
        },
        ui: {
          exports: {
            './hooks/*': './src/hooks/*.ts',
          },
          dependencies: {
            '@dnd-kit/core': '^6.3.1',
            '@dnd-kit/sortable': '^10.0.0',
            '@dnd-kit/utilities': '^3.2.2',
            '@tanstack/react-form': '^1.33.5',
            '@tanstack/react-table': '^8.21.3',
            cmdk: '^1.1.1',
            'react-dom': '^19.2.8',
          },
          devDependencies: {
            '@types/react-dom': '^19.2.5',
          },
        },
        api: {
          dependencies: {
            '@opennextjs/cloudflare': '^1.20.12',
          },
        },
      },
      rootPackageJson: {
        dependencies: {
          '@repo/auth': '*',
          '@repo/db': '*',
        },
        devDependencies: {
          '@repo/config': '*',
          '@faker-js/faker': '^10.4.0',
          tsx: TSX_RUNNER,
          'drizzle-orm': '^0.45.2',
          '@libsql/client': LIBSQL_CLIENT_VERSION,
        },
        scripts: {
          'db:seed': 'BETTER_AUTH_URL=http://localhost:3000 {{tsRunner}} --env-file=apps/web/.env scripts/seed.ts',
          'local-setup': '{{tsRunner}} scripts/local-setup.ts',
        },
      },
      envs: [
        {
          value: 'NEXT_PUBLIC_APP_URL={{appUrl}}',
          stacks: ['nextjs'],
          monoScope: ['app'],
        },
        SEED_PASSWORD,
      ],
    },
    'showcase-nextjs': {
      label: 'Showcase',
      hint: 'SEO/GEO-optimized SaaS landing page with blog and programmatic pages',
      category: 'Business',
      agentArchitecture: [
        'SEO/GEO-optimized marketing site: a single Next.js app with shadcn/ui and an MDX blog,',
        'JSON-LD structured data, a dynamic sitemap, AI-bot-aware robots, programmatic persona',
        'pages, PostHog analytics proxied first-party, and c15t consent gating capture.',
        '',
        'Per-aspect detail in `docs/agents/`:',
        '- [SEO & GEO](docs/agents/seo-geo.md)',
        '- [Content & blog](docs/agents/content-blog.md)',
        '- [Analytics & consent](docs/agents/analytics-consent.md)',
      ].join('\n'),
      context: {
        apps: [
          {
            appName: 'web',
            stackName: 'nextjs',
            libraries: ['shadcn', 'mdx', 'posthog'],
          },
        ],
        project: {},
      },
      packageJson: {
        dependencies: {
          '@c15t/nextjs': '^2.2.1',
          motion: '^12.26.0',
          'next-mdx-remote': NEXT_MDX_REMOTE_VERSION,
        },
      },
      envs: [
        {
          value: 'NEXT_PUBLIC_APP_URL={{appUrl}}',
          stacks: ['nextjs'],
          monoScope: ['app'],
        },
      ],
    },
  },
} as const satisfies Meta;
