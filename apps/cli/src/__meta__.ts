import { $when } from '@/lib/when';
import type {
  BlueprintSeed,
  EnvThirdParty,
  EnvVar,
  FirstRunStep,
  Meta,
  PackageJsonConfig,
  PostGenerateStep,
} from '@/types/meta';
import type { StackName } from '@/types/stack-name';

const RUNS_NODE_SERVER: Parameters<typeof $when>[0] = { deployment: { not: ['cloudflare', 'cloudflare-static'] } };

// A Hono app is a Worker only under `cloudflare`. Under `cloudflare-static` it gets no `wrangler.jsonc` (the deployment serves Next.js and TanStack Start), so it keeps its Node or Bun server,
// where `RUNS_NODE_SERVER` would drop it.
const HONO_SERVES_FROM_NODE: Parameters<typeof $when>[0] = { deployment: { not: 'cloudflare' } };

const WITH_ORM: Parameters<typeof $when>[0] = { orm: true };

const NODE_TYPES_VERSION = '^22';

// The range `expo-doctor` expects of the Expo SDK, so every workspace shares it and no app sits on another major.
const TYPESCRIPT_VERSION = '~6.0.3';
const REACT_TYPES_VERSION = '^19.2.18';
const VITE_VERSION = '^8.3.4';
const PG_TYPES_VERSION = '^8.23.1';

/** A script whose sentence changes when a turborepo root runs it in every app. */
const describedPerRepo = (script: string, description: string, everyAppDescription: string) => [
  $when({ repo: 'single' }, { script, description }),
  $when({ repo: 'turborepo' }, { script, description: everyAppDescription }),
];

const EVERY_APP_WITH_START = 'Start every app that has a `start` script';
const BUILD_FOR_PRODUCTION = describedPerRepo(
  'build',
  'Build for production',
  'Build every app that has a `build` script for production',
);
const START_PRODUCTION_SERVER = describedPerRepo('start', 'Start the production server', EVERY_APP_WITH_START);
const PREVIEW_PRODUCTION_BUILD = { script: 'preview', description: 'Preview the production build locally' };
const BUILD_WORKER_BUNDLE = { script: 'build:cf', description: 'Build the Worker bundle' };
const DEPLOY_TO_WORKERS = { script: 'deploy', description: 'Deploy to Cloudflare Workers' };

const START_DEV_SERVER = describedPerRepo(
  'dev',
  'Start the development server',
  'Start the dev server of every app that has a `dev` script',
);
const TYPECHECK_CODE = describedPerRepo(
  'typecheck',
  'Type-check the code',
  'Type-check every app and package that has a `typecheck` script',
);
// The script of every app and package that has a tsconfig. A turborepo root runs them all through turbo.
const TYPECHECK_WITH_TSC = { typecheck: 'tsc --noEmit' };
const ANALYZE_BUNDLE = { script: 'analyze', description: 'Analyze the bundle size' };
const OPEN_EXPO_APP = [
  { script: 'android', description: 'Start the Expo dev server and open the app on Android' },
  { script: 'ios', description: 'Start the Expo dev server and open the app on iOS' },
  { script: 'web', description: 'Start the Expo dev server and open the app in the browser' },
];

const RUN_TESTS = { script: 'test', description: 'Run the tests' };
const RUN_TESTS_IN_WATCH_MODE = { script: 'test:watch', description: 'Run the tests in watch mode' };
const RUN_TESTS_WITH_COVERAGE = { script: 'test:coverage', description: 'Run the tests with coverage' };
const VITEST_SCRIPTS = [RUN_TESTS, RUN_TESTS_IN_WATCH_MODE, RUN_TESTS_WITH_COVERAGE];

const WRITE_SQL_MIGRATION = { script: 'db:generate', description: 'Write a SQL migration from the schema' };
const GENERATE_PRISMA_CLIENT = { script: 'db:generate', description: 'Generate the Prisma client' };
const RUN_MIGRATIONS = { script: 'db:migrate', description: 'Run database migrations' };
const RUN_LOCAL_MIGRATIONS = {
  script: 'db:migrate:local',
  description: 'Run database migrations on the local database',
};
const RUN_REMOTE_MIGRATIONS = {
  script: 'db:migrate:remote',
  description: 'Run database migrations on the production database',
};
const PUSH_SCHEMA = { script: 'db:push', description: 'Push schema changes to database' };
const OPEN_DATABASE_STUDIO = { script: 'db:studio', description: 'Open database management UI' };
const SEEDING_SECTION = 'Seeding';
const SEED_DATABASE = {
  script: 'db:seed',
  description: 'Seed the database; it can delete users',
  readmeSection: SEEDING_SECTION,
};
const SET_UP_LOCAL_DATABASE = {
  script: 'local-setup',
  description: 'Set up the local database and seed it; it can delete the local data',
  readmeSection: SEEDING_SECTION,
};

const REGENERATE_CLOUDFLARE_TYPES = {
  script: 'cf-typegen',
  description: 'Regenerate the Cloudflare binding types of every app that has a `cf-typegen` script',
};

const SEEDING_SCRIPTS = [SEED_DATABASE, SET_UP_LOCAL_DATABASE];

const WRITE_DEFAULT_ROLES = {
  script: 'db:roles',
  description: 'Write the default roles into the local database, only when it has no role yet',
};
const WRITE_DEFAULT_ROLES_IN_DATABASE = {
  script: 'db:roles',
  description: 'Write the default roles into the database, only when it has no role yet',
};
const WRITE_DEFAULT_ROLES_REMOTE = {
  script: 'db:roles:remote',
  description: 'Write the default roles into the production database, only when it has no role yet',
};

const LINT_CODE = { script: 'lint', description: 'Lint code' };
const FORMAT_CODE = { script: 'format', description: 'Format code' };
const FIX_AND_FORMAT_CODE = { script: 'check', description: 'Fix lint issues and format code' };

// The stacks whose app defines a `build` script: a `prebuild` hook on any other stack would never run.
const STACKS_WITH_BUILD_SCRIPT: StackName[] = ['nextjs', 'tanstack-start'];

const PRISMA_GENERATE = 'prisma generate';
// The client is generated, not committed: a single repo runs it before the scripts that import it, as a `pre` hook.
// `stack` narrows the hook to the stacks that define the script it precedes.
const PRISMA_GENERATE_IN_SINGLE_REPO = (stack?: StackName[]) =>
  $when(stack ? { repo: 'single', stack } : { repo: 'single' }, PRISMA_GENERATE);

const NITRO_VERSION = '^3.0.260903-beta';

// Workspace packages type-check on their own, without the app's wrangler-generated binding types.
const WORKERS_TYPES_IN_PACKAGE = $when({ repo: 'turborepo', deployment: 'cloudflare' }, '^5.20261012.1');

const WRANGLER_VERSION = '^4.148.0';

const ESLINT_VERSION = '^9.22.0';

// A turborepo workspace package lints itself with the shared config of `@repo/eslint-config`, so the root `lint`
// (`turbo lint`) reaches it like an app. Its `eslint.config.mjs` comes from the `eslint` addon templates.
const ESLINT_LINTS_PACKAGE: Parameters<typeof $when>[0] = { repo: 'turborepo', linter: ['eslint', 'eslint-prettier'] };

const LINT_STAGED_FILES = '*.{js,ts,cjs,mjs,d.cts,d.mts,jsx,tsx,json,jsonc}';
const ESLINT_STAGED_COMMAND = 'eslint --fix';
const PRETTIER_STAGED_COMMAND = 'prettier --write';
// ESLint looks its config up from the directory it runs in, and lint-staged runs the tasks of a staged file in the
// directory of the closest config. A turborepo root has no ESLint config, so each workspace that lints itself carries
// the entry (lint-staged does not merge configs: the Prettier command of `eslint-prettier` is repeated here).
const ESLINT_STAGED_IN_WORKSPACE = $when(
  { ...ESLINT_LINTS_PACKAGE, tooling: 'husky' },
  {
    [LINT_STAGED_FILES]: [ESLINT_STAGED_COMMAND, $when({ linter: 'eslint-prettier' }, PRETTIER_STAGED_COMMAND)],
  },
);

const AWS_LAMBDA_TYPES_VERSION = '^8.10.0';

// The fields of a turborepo workspace package that lints itself with ESLint, added to its `packageJson` or
// `pkgPackageJson`: the lint script, the ESLint devDependencies and the lint-staged entry. A single repo and the
// other linters get none. A new package that lints itself passes its config through here and adds its
// `<package>-eslint.config.mjs.hbs` template.
function lintsWithEslint(config: PackageJsonConfig): PackageJsonConfig {
  return {
    ...config,
    devDependencies: {
      ...config.devDependencies,
      '@repo/eslint-config': $when(ESLINT_LINTS_PACKAGE, '*'),
      eslint: $when(ESLINT_LINTS_PACKAGE, ESLINT_VERSION),
    },
    scripts: { lint: $when(ESLINT_LINTS_PACKAGE, 'eslint .'), ...config.scripts },
    'lint-staged': ESLINT_STAGED_IN_WORKSPACE,
  };
}

const LAMBDA_PKG_PACKAGE_JSON: Record<string, PackageJsonConfig> = {
  shared: lintsWithEslint({
    scripts: TYPECHECK_WITH_TSC,
    exports: { './types': './src/types.ts' },
    devDependencies: {
      '@types/aws-lambda': AWS_LAMBDA_TYPES_VERSION,
      typescript: TYPESCRIPT_VERSION,
    },
  }),
};

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
// The arguments a package manager appends to the script reach Wrangler through "$@". `--port=` is the form a single repo keeps: it only strips `--port {{port}}`.
const wranglerOnAppPort = (command: string) =>
  `sh -c '${command} --port=\${PORT:-{{port}}} ${WRANGLER_PERSIST_STATE} "$@"' sh`;
const HONO_WORKER_DEV = wranglerOnAppPort('wrangler dev');
// A preview serves on the port of the app, like `dev`, so the origin in its `.env` (BETTER_AUTH_URL) is the one the browser uses.
const OPENNEXT_PREVIEW = wranglerOnAppPort('opennextjs-cloudflare preview --');

const GENERATE_ROUTE_TREE = 'tsr generate';

const GENERATE_SECRET = 'openssl rand -base64 32';

const START_DOCKER_DATABASE: FirstRunStep[] = [
  { description: 'Start the database', commands: [{ command: 'docker compose up -d --wait' }] },
];

const RUN_LOCAL_SETUP: FirstRunStep[] = [
  { description: 'Set up the local database and seed demo data', commands: [{ script: 'local-setup' }] },
];

const POSTHOG_TOKEN_SOURCE: EnvThirdParty = {
  description: 'PostHog project token',
  url: 'https://us.posthog.com/settings/project',
  whenBlank: 'analytics stay off and nothing is sent to PostHog',
};
const CONTACT_FORM_URL: EnvVar = {
  value: 'NEXT_PUBLIC_CONTACT_FORM_URL=',
  stacks: ['nextjs'],
  monoScope: ['app'],
  thirdParty: {
    description: 'contact form endpoint',
    url: 'https://formspree.io',
    whenBlank: 'the contact form says it is not connected and sends nothing',
  },
};
const PRIVY_DASHBOARD_URL = 'https://dashboard.privy.io';
const SEED_PASSWORD: EnvVar = { value: 'SEED_PASSWORD=password', monoScope: ['app'], tasks: ['db:seed'] };
const NEXT_PUBLIC_APP_URL: EnvVar = {
  value: 'NEXT_PUBLIC_APP_URL={{appUrl}}',
  origin: true,
  stacks: ['nextjs'],
  monoScope: ['app'],
};

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

const ORG_DASHBOARD_WEB_PACKAGE_JSON: PackageJsonConfig = {
  dependencies: {
    'lucide-react': '^1.37.0',
    'react-error-boundary': '^5.0.0',
    sonner: '^2.0.7',
    zod: '^4.5.4',
  },
};

const ORG_DASHBOARD_SEED: BlueprintSeed = {
  rows: ['contacts', 'posts', 'users'],
  deletes: 'with-reset',
  target: 'refuses-remote-without-force',
};

const ORG_DASHBOARD_SCRIPTS = [...SEEDING_SCRIPTS, WRITE_DEFAULT_ROLES_IN_DATABASE];

const ORG_DASHBOARD_FIRST_RUN: FirstRunStep[] = [
  {
    description: 'Set up the local database, write the default roles (the `db:roles` script) and seed demo data',
    commands: [{ script: 'local-setup' }],
  },
];

const orgDashboardContext = (webStack: StackName) => ({
  apps: [
    {
      appName: 'web',
      stackName: webStack,
      libraries: ORG_DASHBOARD_WEB_LIBRARIES,
      packageJson: ORG_DASHBOARD_WEB_PACKAGE_JSON,
      envs: [SEED_PASSWORD],
    },
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

// The dependency of the `ui/command` partial, which a dashboard blueprint renders as the `command.tsx` of its `ui` package.
const COMMAND_UI_DEPENDENCIES = { cmdk: '^1.1.1' };

const ORG_DASHBOARD_PKG_PACKAGE_JSON: Record<string, PackageJsonConfig> = {
  api: {
    exports: {
      './pagination': './src/pagination.ts',
      './search-query': './src/search-query.ts',
    },
  },
  auth: {
    exports: {
      './types': './src/types.ts',
      './password': './src/password.ts',
      './permissions': './src/permissions.ts',
      './role-permissions': './src/role-permissions.ts',
      './role-assignment': './src/role-assignment.ts',
      './role-management': './src/role-management.ts',
      './role-store': './src/role-store.ts',
      './default-roles': './src/default-roles.ts',
    },
  },
  db: {
    scripts: {
      'db:seed': 'cd {{workspaceRoot}} && {{packageManager}} run db:seed',
    },
  },
  ui: {
    dependencies: {
      '@tanstack/react-form': '^1.33.5',
      ...COMMAND_UI_DEPENDENCIES,
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
    'db:roles': '{{tsRunner}} --env-file=apps/web/.env scripts/default-roles.ts',
    start: 'turbo start',
  },
};

const FORMAT_GENERATED_FILES: PostGenerateStep[] = [{ description: 'Format the generated files', script: 'format' }];

const LIBSQL_CLIENT_VERSION = '^0.17.4';

const BETTER_AUTH_VERSION = '^1.7.14';

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

// The bundle is an ES module in a package without `"type": "module"`: only an `.mjs` outfile loads as one without Node's MODULE_TYPELESS_PACKAGE_JSON warning.
const LAMBDA_OUTFILE = 'dist/index.mjs';

const BUNDLE_LAMBDA_WITH_ESBUILD = (extraFlags = ''): PackageJsonConfig => ({
  devDependencies: { esbuild: ESBUILD_VERSION },
  scripts: { build: `${BUNDLE_FOR_NODE} --outfile=${LAMBDA_OUTFILE}${extraFlags}` },
});

export const META: Meta = {
  stacks: {
    nextjs: {
      type: 'app',
      label: 'Next.js',
      hint: 'React framework with SSR',
      scriptDescriptions: [...START_DEV_SERVER, ANALYZE_BUNDLE, ...TYPECHECK_CODE],
      productionScripts: [...BUILD_FOR_PRODUCTION, ...START_PRODUCTION_SERVER],
      packageJson: {
        dependencies: {
          next: '^16.3.0',
          react: '^19.2.8',
          'react-dom': '^19.2.8',
          'tw-animate-css': '^1.4.0',
        },
        devDependencies: {
          typescript: TYPESCRIPT_VERSION,
          '@types/node': NODE_TYPES_VERSION,
          '@types/react': REACT_TYPES_VERSION,
          '@types/react-dom': '^19.2.5',
          tailwindcss: '^4.3.3',
          '@tailwindcss/postcss': '^4.3.3',
        },
        scripts: {
          ...TYPECHECK_WITH_TSC,
          analyze: 'next experimental-analyze',
          dev: 'next dev --port {{port}}',
          build: 'next build',
          start: $when(RUNS_NODE_SERVER, 'next start --port {{port}}'),
        },
      },
    },
    expo: {
      type: 'app',
      clientOnly: true,
      label: 'Expo',
      hint: 'React Native framework',
      scriptDescriptions: [...START_DEV_SERVER, ...OPEN_EXPO_APP, ...TYPECHECK_CODE],
      // turbo gives a task no terminal, and Expo prints no QR code and takes no key press without one: in a turborepo its dev server is not `dev`, which `turbo dev` runs in every app. A single repo runs no turbo.
      interactiveScripts: ['dev:expo'],
      // React Native checks the renderer version, so the SDK fixes the exact React the app runs (and `expo-doctor` the minor of its types), whatever the other apps use.
      pinnedPackages: ['react', 'react-dom', '@types/react'],
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
          typescript: TYPESCRIPT_VERSION,
          '@types/react': '~19.2.4',
        },
        scripts: {
          ...TYPECHECK_WITH_TSC,
          dev: $when({ repo: 'single' }, 'expo start'),
          'dev:expo': $when({ repo: 'turborepo' }, 'expo start'),
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
      scriptDescriptions: [...START_DEV_SERVER, ...TYPECHECK_CODE],
      productionScripts: [...BUILD_FOR_PRODUCTION, ...START_PRODUCTION_SERVER],
      installScripts: TSX_INSTALL_SCRIPTS,
      packageJson: {
        dependencies: {
          hono: '^4.7.4',
        },
        devDependencies: {
          typescript: TYPESCRIPT_VERSION,
          '@types/node': NODE_TYPES_VERSION,
        },
        scripts: {
          ...TYPECHECK_WITH_TSC,
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
      scriptDescriptions: [...START_DEV_SERVER, ...TYPECHECK_CODE],
      productionScripts: [...BUILD_FOR_PRODUCTION, ...START_PRODUCTION_SERVER],
      installScripts: TSX_INSTALL_SCRIPTS,
      packageJson: {
        dependencies: {},
        devDependencies: {
          typescript: TYPESCRIPT_VERSION,
          '@types/node': NODE_TYPES_VERSION,
        },
        scripts: {
          ...TYPECHECK_WITH_TSC,
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
      scriptDescriptions: [...START_DEV_SERVER, ...TYPECHECK_CODE],
      productionScripts: [...BUILD_FOR_PRODUCTION, PREVIEW_PRODUCTION_BUILD, ...START_PRODUCTION_SERVER],
      installScripts: { fsevents: false },
      moduleType: 'module',
      packageJson: {
        dependencies: {
          '@fontsource-variable/geist': '^5.3.0',
          '@fontsource-variable/geist-mono': '^5.3.0',
          '@tanstack/react-router': '^1.170.41',
          '@tanstack/react-start': '^1.168.60',
          '@tanstack/router-cli': '^1.167.43',
          react: '^19.2.8',
          'react-dom': '^19.2.8',
        },
        devDependencies: {
          typescript: TYPESCRIPT_VERSION,
          '@types/node': NODE_TYPES_VERSION,
          '@types/react': REACT_TYPES_VERSION,
          '@types/react-dom': '^19.2.5',
          '@tanstack/react-router-devtools': '^1.167.2',
          '@tailwindcss/vite': '^4.3.3',
          '@vitejs/plugin-react': '^6.1.2',
          nitro: $when(RUNS_NODE_SERVER, NITRO_VERSION),
          tailwindcss: '^4.3.3',
          vite: VITE_VERSION,
        },
        scripts: {
          ...TYPECHECK_WITH_TSC,
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
      packageJson: lintsWithEslint({
        dependencies: {
          '@radix-ui/react-slot': '^1.3.3',
          'radix-ui': '^1.6.7',
          'class-variance-authority': '^0.7.1',
          clsx: '^2.1.1',
          'lucide-react': '^1.37.0',
          react: '^19.2.8',
          'tw-animate-css': '^1.4.0',
          'tailwind-merge': '^3.6.0',
        },
        devDependencies: {
          typescript: TYPESCRIPT_VERSION,
          tailwindcss: '^4.3.3',
          '@tailwindcss/postcss': '^4.3.3',
          '@types/react': REACT_TYPES_VERSION,
        },
        scripts: TYPECHECK_WITH_TSC,
        exports: {
          './': './src/components/',
          './base.css': './src/base.css',
          './components/*': './src/components/*.tsx',
          './hooks/*': './src/hooks/*.ts',
          './lib/*': './src/lib/*.ts',
          './postcss.config.mjs': './postcss.config.mjs',
        },
      }),
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
      packageJson: lintsWithEslint({
        dependencies: {
          'better-auth': BETTER_AUTH_VERSION,
          '@better-auth/drizzle-adapter': $when({ orm: 'drizzle' }, BETTER_AUTH_VERSION),
          '@better-auth/prisma-adapter': $when({ orm: 'prisma' }, BETTER_AUTH_VERSION),
          '@repo/db': $when({ repo: 'turborepo', orm: true }, '*'),
        },
        devDependencies: {
          typescript: TYPESCRIPT_VERSION,
          '@types/node': $when({ repo: 'turborepo' }, NODE_TYPES_VERSION),
          '@cloudflare/workers-types': WORKERS_TYPES_IN_PACKAGE,
        },
        scripts: TYPECHECK_WITH_TSC,
        exports: {
          './auth': './src/auth.ts',
          './auth-client': './src/auth-client.ts',
          './session-cache': $when({ stack: 'tanstack-start' }, './src/session-cache.ts'),
        },
      }),
      appPackageJson: {
        dependencies: {
          'better-auth': BETTER_AUTH_VERSION,
        },
      },
      envs: [
        {
          value: 'BETTER_AUTH_SECRET=',
          monoScope: ['app'],
          secret: true,
          generateCommand: GENERATE_SECRET,
        },
        {
          value: 'BETTER_AUTH_URL={{appUrl}}',
          monoScope: ['app'],
          secret: true,
          origin: true,
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
      packageJson: lintsWithEslint({
        dependencies: {
          '@repo/auth': $when({ repo: 'turborepo', library: 'better-auth' }, '*'),
          '@repo/db': $when({ repo: 'turborepo', orm: true }, '*'),
          'drizzle-orm': $when({ repo: 'turborepo', orm: 'drizzle' }, '^0.45.2'),
          '@trpc/server': '^11.18.0',
          superjson: '^2.2.6',
          zod: '^4.5.4',
        },
        devDependencies: {
          typescript: TYPESCRIPT_VERSION,
          '@types/node': $when({ repo: 'turborepo' }, NODE_TYPES_VERSION),
          '@cloudflare/workers-types': WORKERS_TYPES_IN_PACKAGE,
          '@types/pg': $when({ repo: 'turborepo', orm: 'drizzle', database: 'postgres' }, PG_TYPES_VERSION),
        },
        scripts: TYPECHECK_WITH_TSC,
        exports: {
          '.': './src/index.ts',
        },
      }),
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
      envs: [NEXT_PUBLIC_APP_URL],
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
      // NativeWind 4 compiles with Tailwind CSS 3, while the Next.js and TanStack Start apps of a turborepo run Tailwind CSS 4.
      pinnedPackages: ['tailwindcss'],
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
          value: 'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=',
          monoScope: ['app'],
          stacks: ['nextjs'],
          thirdParty: POSTHOG_TOKEN_SOURCE,
        },
        {
          value: 'VITE_POSTHOG_PROJECT_TOKEN=',
          monoScope: ['app'],
          stacks: ['tanstack-start'],
          thirdParty: POSTHOG_TOKEN_SOURCE,
        },
      ],
    },
    vitest: {
      label: 'Vitest',
      hint: 'A Vite-native testing framework',
      installScripts: { fsevents: false },
      category: 'Testing',
      support: { stacks: ['nextjs', 'tanstack-start'] },
      scriptDescriptions: VITEST_SCRIPTS,
      packageJson: {
        devDependencies: {
          vitest: '^4.1.11',
          '@vitest/coverage-v8': '^4.1.11',
          '@vitejs/plugin-react': '^6.1.2',
          vite: VITE_VERSION,
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
      scriptDescriptions: VITEST_SCRIPTS,
      packageJson: {
        devDependencies: {
          vitest: '^4.1.11',
          '@vitest/coverage-v8': '^4.1.11',
          vite: VITE_VERSION,
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
      scriptDescriptions: [
        { script: 'test:e2e', description: 'Run the end-to-end tests' },
        { script: 'test:e2e:ui', description: 'Open the end-to-end tests in the Playwright UI' },
      ],
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
      scriptDescriptions: [RUN_TESTS, RUN_TESTS_IN_WATCH_MODE],
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
          scriptDescriptions: [REGENERATE_CLOUDFLARE_TYPES],
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
                preview: `vite preview --port=\${PORT:-{{port}}}`,
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
                preview: OPENNEXT_PREVIEW,
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
          scriptDescriptions: [REGENERATE_CLOUDFLARE_TYPES],
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
      serverOnly: true,
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
              '@types/pg': PG_TYPES_VERSION,
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
          interactiveScripts: ['db:migrate:remote'],
          scriptDescriptions: [
            WRITE_SQL_MIGRATION,
            RUN_MIGRATIONS,
            RUN_LOCAL_MIGRATIONS,
            RUN_REMOTE_MIGRATIONS,
            SET_UP_LOCAL_DATABASE,
          ],
          packageJson: {
            devDependencies: {
              '@libsql/client': $when(WITH_ORM, LIBSQL_CLIENT_VERSION),
            },
            scripts: {
              'db:generate': $when(WITH_ORM, 'drizzle-kit generate'),
              'db:migrate': $when(WITH_ORM, `wrangler d1 migrations apply DB --local ${WRANGLER_PERSIST_STATE}`),
              'db:migrate:local': $when(WITH_ORM, `wrangler d1 migrations apply DB --local ${WRANGLER_PERSIST_STATE}`),
              'db:migrate:remote': $when(WITH_ORM, 'wrangler d1 migrations apply DB --remote'),
              'local-setup': $when(
                WITH_ORM,
                `{{packageManager}} run db:generate && wrangler d1 migrations apply DB --local ${WRANGLER_PERSIST_STATE} && {{packageManager}} run db:seed`,
              ),
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
              when: WITH_ORM,
              file: 'd1',
            },
            {
              value: 'CLOUDFLARE_D1_DATABASE_ID="" # D1 database id from `wrangler d1 create`',
              monoScope: [{ pkg: 'db' }],
              when: WITH_ORM,
              file: 'd1',
            },
            {
              value: 'CLOUDFLARE_API_TOKEN="" # Cloudflare API token with D1 edit permission',
              monoScope: [{ pkg: 'db' }],
              when: WITH_ORM,
              file: 'd1',
            },
          ],
        },
      },
    },
    orm: {
      prompt: 'Configure an ORM?',
      serverOnly: true,
      selection: 'single',
      require: ['database'],
      options: {
        drizzle: {
          label: 'Drizzle',
          hint: 'Lightweight TypeScript ORM',
          installScripts: TSX_INSTALL_SCRIPTS,
          mono: { scope: 'pkg', name: 'db' },
          interactiveScripts: ['db:push'],
          scriptDescriptions: [WRITE_SQL_MIGRATION, RUN_MIGRATIONS, PUSH_SCHEMA, SEED_DATABASE, OPEN_DATABASE_STUDIO],
          firstRun: [
            {
              description: 'Create the migrations from the schema and apply them',
              commands: [{ script: 'db:generate' }, { script: 'db:migrate' }],
            },
          ],
          packageJson: lintsWithEslint({
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
              typescript: TYPESCRIPT_VERSION,
              '@types/node': NODE_TYPES_VERSION,
              '@cloudflare/workers-types': WORKERS_TYPES_IN_PACKAGE,
              'drizzle-kit': '^0.31.10',
              dotenv: '^17.4.2',
              tsx: TSX_RUNNER,
            },
            scripts: {
              ...TYPECHECK_WITH_TSC,
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
          }),
        },
        prisma: {
          label: 'Prisma',
          hint: 'Type-safe ORM with migrations',
          installScripts: { ...TSX_INSTALL_SCRIPTS, '@prisma/engines': true, prisma: false },
          require: { database: ['postgres', 'mysql'] },
          mono: { scope: 'pkg', name: 'db' },
          interactiveScripts: ['db:migrate'],
          scriptDescriptions: [
            GENERATE_PRISMA_CLIENT,
            RUN_MIGRATIONS,
            PUSH_SCHEMA,
            SEED_DATABASE,
            OPEN_DATABASE_STUDIO,
          ],
          firstRun: [
            {
              description: 'Generate the client and create the tables from the schema',
              commands: [{ script: 'db:generate' }, { script: 'db:push' }],
            },
          ],
          packageJson: lintsWithEslint({
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
              typescript: TYPESCRIPT_VERSION,
              '@types/node': NODE_TYPES_VERSION,
              '@cloudflare/workers-types': WORKERS_TYPES_IN_PACKAGE,
              dotenv: '^17.4.2',
              prisma: '^7.10.0',
              tsx: TSX_RUNNER,
            },
            scripts: {
              ...TYPECHECK_WITH_TSC,
              'db:generate': PRISMA_GENERATE,
              'db:migrate': 'prisma migrate dev',
              'db:push': 'prisma db push',
              'db:studio': 'prisma studio',
              'db:seed': 'prisma db seed',
              predev: PRISMA_GENERATE_IN_SINGLE_REPO(),
              pretypecheck: PRISMA_GENERATE_IN_SINGLE_REPO(),
              prebuild: PRISMA_GENERATE_IN_SINGLE_REPO(STACKS_WITH_BUILD_SCRIPT),
            },
            types: $when({ repo: 'turborepo' }, './dist/src/index.d.ts'),
            exports: {
              '.': './src/index.ts',
            },
          }),
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
          scriptDescriptions: [LINT_CODE, FORMAT_CODE, FIX_AND_FORMAT_CODE],
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
          scriptDescriptions: [LINT_CODE, FORMAT_CODE, FIX_AND_FORMAT_CODE],
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
          scriptDescriptions: [LINT_CODE],
          packageJson: {
            devDependencies: {
              eslint: ESLINT_VERSION,
              '@eslint/js': '^9.22.0',
              'typescript-eslint': '^8.68.0',
              globals: '^17.11.0',
              'eslint-plugin-react': $when({ stack: ['nextjs', 'tanstack-start', 'expo'] }, '^7.37.5'),
              'eslint-plugin-react-hooks': $when({ stack: ['nextjs', 'tanstack-start', 'expo'] }, '^7.1.1'),
              '@next/eslint-plugin-next': $when({ stack: 'nextjs' }, '^16.3.3'),
            },
            scripts: {
              lint: 'eslint .',
            },
            'lint-staged': ESLINT_STAGED_IN_WORKSPACE,
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
              eslint: ESLINT_VERSION,
            },
            scripts: {
              lint: 'eslint .',
            },
            'lint-staged': ESLINT_STAGED_IN_WORKSPACE,
          },
        },
        prettier: {
          label: 'Prettier',
          hint: 'Opinionated code formatter (no linter)',
          mono: { scope: 'root' },
          postGenerate: FORMAT_GENERATED_FILES,
          scriptDescriptions: [
            FORMAT_CODE,
            { script: 'format:check', description: 'Check the formatting without changing files' },
          ],
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
              [LINT_STAGED_FILES]: [
                $when({ linter: 'biome' }, 'biome check --write --unsafe --no-errors-on-unmatched'),
                $when({ linter: ['eslint', 'eslint-prettier'], repo: 'single' }, ESLINT_STAGED_COMMAND),
                $when({ linter: ['prettier', 'eslint-prettier'] }, PRETTIER_STAGED_COMMAND),
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
          scriptDescriptions: [
            { script: 'start:portless', description: 'Start the production server through portless' },
          ],
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
        packageJson: {
          devDependencies: {
            rimraf: '^6.0.1',
            syncpack: '^15.3.3',
          },
          scripts: {
            clean: 'rimraf "**/.turbo" "**/.next" "**/dist" "**/generated" "**/node_modules"',
            'versions:list': 'syncpack lint',
            'versions:fix': 'syncpack fix',
          },
        },
        scriptDescriptions: [
          { script: 'clean', description: 'Remove build outputs and installed dependencies' },
          { script: 'versions:list', description: 'List dependency versions that differ between workspaces' },
          { script: 'versions:fix', description: 'Align dependency versions across workspaces' },
        ],
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
      seed: { rows: ['users'], deletes: 'always' },
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
          value: 'NEXT_PUBLIC_PRIVY_APP_ID=',
          monoScope: ['app'],
          thirdParty: {
            description: 'Privy app ID',
            url: PRIVY_DASHBOARD_URL,
            whenBlank: 'the app shows a setup message instead of the wallet UI',
          },
        },
        {
          value: 'NEXT_PUBLIC_PRIVY_CLIENT_ID=',
          monoScope: ['app'],
          thirdParty: {
            description: 'Privy client ID (optional)',
            url: PRIVY_DASHBOARD_URL,
            whenBlank: 'Privy uses the settings of the app itself',
          },
        },
        {
          value: 'PRIVY_APP_SECRET=',
          monoScope: ['app'],
          secret: true,
          thirdParty: {
            description: 'Privy app secret',
            url: PRIVY_DASHBOARD_URL,
            whenBlank: 'a request that carries a `privy-token` cookie fails with an error naming this variable',
          },
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
          value: 'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=',
          monoScope: ['app'],
          thirdParty: {
            description: 'WalletConnect (Reown) project ID',
            url: 'https://dashboard.reown.com',
            whenBlank: 'the app shows a setup message instead of the wallet UI',
          },
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
      pkgPackageJson: LAMBDA_PKG_PACKAGE_JSON,
      packageJson: {
        dependencies: {
          '@repo/shared': '*',
        },
        devDependencies: {
          '@types/aws-lambda': AWS_LAMBDA_TYPES_VERSION,
        },
        scripts: {
          build: `bun build src/index.ts --outfile ${LAMBDA_OUTFILE} --target node`,
        },
      },
      packageManagerPackageJson: {
        npm: BUNDLE_LAMBDA_WITH_ESBUILD(),
        pnpm: BUNDLE_LAMBDA_WITH_ESBUILD(),
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
      pkgPackageJson: LAMBDA_PKG_PACKAGE_JSON,
      packageJson: {
        dependencies: {
          '@repo/shared': '*',
        },
        devDependencies: {
          '@types/aws-lambda': AWS_LAMBDA_TYPES_VERSION,
        },
        scripts: {
          build: `NODE_ENV=production bun build src/index.ts --outfile ${LAMBDA_OUTFILE} --target node`,
        },
      },
      packageManagerPackageJson: {
        npm: BUNDLE_LAMBDA_WITH_ESBUILD(` ${INLINE_PRODUCTION_NODE_ENV}`),
        pnpm: BUNDLE_LAMBDA_WITH_ESBUILD(` ${INLINE_PRODUCTION_NODE_ENV}`),
      },
    },
    'org-dashboard-nextjs': {
      label: 'Org Dashboard',
      hint: ORG_DASHBOARD_HINT,
      category: 'Business',
      scriptDescriptions: ORG_DASHBOARD_SCRIPTS,
      firstRun: ORG_DASHBOARD_FIRST_RUN,
      agentArchitecture: orgDashboardAgentArchitecture('Next.js'),
      context: orgDashboardContext('nextjs'),
      seed: ORG_DASHBOARD_SEED,
      pkgPackageJson: ORG_DASHBOARD_PKG_PACKAGE_JSON,
      rootPackageJson: ORG_DASHBOARD_ROOT_PACKAGE_JSON,
    },
    'org-dashboard-tanstack-start': {
      label: 'Org Dashboard (TanStack Start)',
      hint: ORG_DASHBOARD_HINT,
      category: 'Business',
      extends: 'org-dashboard-nextjs',
      scriptDescriptions: ORG_DASHBOARD_SCRIPTS,
      firstRun: ORG_DASHBOARD_FIRST_RUN,
      agentArchitecture: orgDashboardAgentArchitecture('TanStack Start'),
      context: orgDashboardContext('tanstack-start'),
      seed: ORG_DASHBOARD_SEED,
      pkgPackageJson: ORG_DASHBOARD_PKG_PACKAGE_JSON,
      rootPackageJson: ORG_DASHBOARD_ROOT_PACKAGE_JSON,
    },
    'multitenant-saas-nextjs': {
      label: 'Multitenant SaaS',
      hint: 'B2B SaaS dashboard with orgs, custom RBAC, and link-based invitations',
      category: 'Business',
      scriptDescriptions: SEEDING_SCRIPTS,
      firstRun: RUN_LOCAL_SETUP,
      seed: {
        rows: ['invitations', 'projects', 'members', 'organizations', 'users'],
        deletes: 'with-reset',
        target: 'refuses-remote-without-force',
      },
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
            envs: [SEED_PASSWORD],
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
      pkgPackageJson: {
        auth: {
          exports: {
            './types': './src/types.ts',
            './permissions': './src/permissions.ts',
            './invitation-link': './src/invitation-link.ts',
          },
        },
        api: {
          dependencies: {
            'better-auth': BETTER_AUTH_VERSION,
          },
          exports: {
            './search-query': './src/search-query.ts',
          },
        },
        db: {
          scripts: {
            'db:seed': 'cd {{workspaceRoot}} && {{packageManager}} run db:seed',
          },
        },
        ui: {
          dependencies: {
            '@tanstack/react-form': '^1.33.5',
            ...COMMAND_UI_DEPENDENCIES,
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
        },
      },
      envs: [NEXT_PUBLIC_APP_URL, CONTACT_FORM_URL],
    },
    'cloudflare-fullstack-nextjs': {
      label: 'Cloudflare Fullstack',
      hint: 'Auth + RBAC dashboard with a documents CRUD on D1, R2 uploads, and a cron Worker — all on Cloudflare',
      category: 'Business',
      scriptDescriptions: [...SEEDING_SCRIPTS, WRITE_DEFAULT_ROLES, WRITE_DEFAULT_ROLES_REMOTE],
      firstRun: [
        {
          description:
            'Set up the local database, write the default roles (the `db:roles` script) and seed demo data (this deletes the local D1 state, sign-ups included)',
          commands: [{ script: 'local-setup' }],
        },
      ],
      seed: { rows: ['documents', 'users'], deletes: 'with-reset', target: 'local-only' },
      agentArchitecture: [
        'Fullstack Cloudflare app: a Next.js (OpenNext) web app + a Hono cron Worker (Turborepo),',
        'Better Auth with the admin plugin for account administration, roles (admin/user/manager by',
        'default) whose permissions on business resources are read from D1, tRPC for typed APIs,',
        'TanStack Query for client data, Drizzle on Cloudflare D1, and direct-binding R2 uploads.',
        'The cron Worker purges expired documents (D1 rows + R2 objects) on a schedule.',
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
            packageJson: {
              dependencies: {
                'lucide-react': '^1.37.0',
                sonner: '^2.0.7',
                zod: '^4.5.4',
              },
            },
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
      pkgPackageJson: {
        auth: {
          exports: {
            './types': './src/types.ts',
            './permissions': './src/permissions.ts',
            './role-permissions': './src/role-permissions.ts',
            './role-assignment': './src/role-assignment.ts',
            './role-management': './src/role-management.ts',
            './role-store': './src/role-store.ts',
            './default-roles': './src/default-roles.ts',
          },
        },
        db: {
          scripts: {
            'db:seed': 'cd {{workspaceRoot}} && {{packageManager}} run db:seed',
          },
        },
        ui: {
          dependencies: {
            '@dnd-kit/core': '^6.3.1',
            '@dnd-kit/sortable': '^10.0.0',
            '@dnd-kit/utilities': '^3.2.2',
            '@tanstack/react-form': '^1.33.5',
            '@tanstack/react-table': '^8.21.3',
            ...COMMAND_UI_DEPENDENCIES,
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
          exports: {
            './pagination': './src/pagination.ts',
            './user-list': './src/user-list.ts',
            './search-query': './src/search-query.ts',
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
          'db:seed': '{{tsRunner}} --env-file=apps/web/.env --env-file=.env.seed scripts/seed.ts',
          'db:roles': '{{tsRunner}} scripts/default-roles.ts',
          'db:roles:remote': '{{tsRunner}} scripts/default-roles.ts --remote',
          'local-setup': '{{tsRunner}} scripts/local-setup.ts',
        },
      },
      envs: [{ ...SEED_PASSWORD, monoScope: ['root'], file: 'seed' }],
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
        },
      },
      envs: [NEXT_PUBLIC_APP_URL, CONTACT_FORM_URL],
    },
  },
} as const satisfies Meta;
