import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, readJsonFile, readTextFile, runCli } from './helpers';

const DRIZZLE_TLS_IN_PRODUCTION = `connection: {
      connectionString: databaseUrl,
      ssl: process.env.NODE_ENV === 'production',
    },`;
const PRISMA_TLS_IN_PRODUCTION = `new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production',
});`;
const LOCAL_URL_WITHOUT_TLS = /^DATABASE_URL="postgresql:\/\/postgres:password@localhost:\d+\/postgres-[\w-]+\?sslmode=disable"/m;
const PRODUCTION_TLS_WARNING = 'function warnIfProductionTlsDisabled(databaseUrl: string | undefined): void {';
const DRIZZLE_WARNING_CALL = `  warnIfProductionTlsDisabled(databaseUrl);
  return drizzle({`;
const PRISMA_WARNING_CALL = `warnIfProductionTlsDisabled(process.env.DATABASE_URL);
// TLS in production unless DATABASE_URL sets sslmode: pg applies the parsed URL over these options.
const adapter = new PrismaPg({`;

const NODE_ENV_SOURCES = {
  nextjs: '- Next.js: `next build` replaces `process.env.NODE_ENV` with `production` in the server bundle',
  'tanstack-start': '- TanStack Start: `vite build` replaces it in the server bundle the same way',
  hono: '- Hono: Bun runs the source, so the client reads the variable at runtime. The `start` script sets it (`NODE_ENV=production bun run src/index.ts`)',
};
type ProbedStack = keyof typeof NODE_ENV_SOURCES;
const BUN_APPS_ELSEWHERE = 'Any other production entry of a Bun app';
const BUN_BUILD_INLINES = 'a plain `bun build` inlines `development`';
const CONNECTION_STRING_PARSER = "import { parse as parseConnectionString } from 'pg-connection-string';";

interface PackageJson {
  dependencies?: Record<string, string>;
}

let tempDir: string;

beforeAll(async () => {
  tempDir = await createTempDir();
});

afterAll(async () => {
  await cleanupTempDir(tempDir);
});

async function generate(projectName: string, args: string[]): Promise<string> {
  const result = await runCli([projectName, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
  expect(result.exitCode, result.stderr).toBe(0);
  return join(tempDir, projectName);
}

const TURBO_APPS = ['--app', 'web:nextjs', '--app', 'start:tanstack-start', '--app', 'api:hono'];
const TURBO_STACKS: ProbedStack[] = ['nextjs', 'tanstack-start', 'hono'];
const TURBO_ENV_FILES = ['packages/db/.env.example', 'apps/web/.env.example', 'apps/start/.env.example', 'apps/api/.env.example'];

const TOPOLOGIES = [
  {
    name: 'pg-ssl-next-drizzle',
    args: ['--app', 'pg-ssl-next-drizzle:nextjs', '--orm', 'drizzle'],
    stacks: ['nextjs'] as ProbedStack[],
    client: 'src/lib/db/index.ts',
    dbPackageJson: 'package.json',
    clientConfig: DRIZZLE_TLS_IN_PRODUCTION,
    warningCall: DRIZZLE_WARNING_CALL,
    envFiles: ['.env.example'],
  },
  {
    name: 'pg-ssl-start-drizzle',
    args: ['--app', 'pg-ssl-start-drizzle:tanstack-start', '--orm', 'drizzle'],
    stacks: ['tanstack-start'] as ProbedStack[],
    client: 'src/lib/db/index.ts',
    dbPackageJson: 'package.json',
    clientConfig: DRIZZLE_TLS_IN_PRODUCTION,
    warningCall: DRIZZLE_WARNING_CALL,
    envFiles: ['.env.example'],
  },
  {
    name: 'pg-ssl-turbo-drizzle',
    args: [...TURBO_APPS, '--orm', 'drizzle'],
    stacks: TURBO_STACKS,
    client: 'packages/db/src/index.ts',
    dbPackageJson: 'packages/db/package.json',
    clientConfig: DRIZZLE_TLS_IN_PRODUCTION,
    warningCall: DRIZZLE_WARNING_CALL,
    envFiles: TURBO_ENV_FILES,
  },
  {
    name: 'pg-ssl-next-prisma',
    args: ['--app', 'pg-ssl-next-prisma:nextjs', '--orm', 'prisma'],
    stacks: ['nextjs'] as ProbedStack[],
    client: 'src/lib/db/index.ts',
    dbPackageJson: 'package.json',
    clientConfig: PRISMA_TLS_IN_PRODUCTION,
    warningCall: PRISMA_WARNING_CALL,
    envFiles: ['.env.example'],
  },
  {
    name: 'pg-ssl-turbo-prisma',
    args: [...TURBO_APPS, '--orm', 'prisma'],
    stacks: TURBO_STACKS,
    client: 'packages/db/src/index.ts',
    dbPackageJson: 'packages/db/package.json',
    clientConfig: PRISMA_TLS_IN_PRODUCTION,
    warningCall: PRISMA_WARNING_CALL,
    envFiles: TURBO_ENV_FILES,
  },
];

describe.each(TOPOLOGIES)('$name', ({ name, args, stacks, client, dbPackageJson, clientConfig, warningCall, envFiles }) => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await generate(name, [...args, '--database', 'postgres']);
  });

  test('the client turns TLS on in production unless DATABASE_URL sets sslmode', async () => {
    expect(await readTextFile(join(projectDir, client))).toContain(clientConfig);
  });

  test('the client warns when production disables TLS for a remote host', async () => {
    const index = await readTextFile(join(projectDir, client));
    expect(index).toContain(PRODUCTION_TLS_WARNING);
    expect(index).toContain(warningCall);
  });

  test('the warning reads DATABASE_URL with the parser pg uses, declared next to pg', async () => {
    expect(await readTextFile(join(projectDir, client))).toContain(CONNECTION_STRING_PARSER);
    const pkg = await readJsonFile<PackageJson>(join(projectDir, dbPackageJson));
    expect(pkg.dependencies?.['pg-connection-string']).toBe('^2.14.1');
    expect(pkg.dependencies?.pg).toBeDefined();
  });

  test('the local DATABASE_URL disables TLS for the Docker database', async () => {
    for (const envFile of envFiles) {
      expect(await readTextFile(join(projectDir, envFile)), envFile).toMatch(LOCAL_URL_WITHOUT_TLS);
    }
  });

  test('AGENTS.md explains TLS in production and the local sslmode=disable', async () => {
    const agents = await readTextFile(join(projectDir, 'AGENTS.md'));
    expect(agents).toContain('`NODE_ENV=production`');
    expect(agents).toContain('`?sslmode=disable`');
    expect(agents).toContain('Never copy the local `DATABASE_URL` to production');
    expect(agents).toContain('the client logs a warning');
  });

  test('AGENTS.md says where each stack gets NODE_ENV=production', async () => {
    const agents = await readTextFile(join(projectDir, 'AGENTS.md'));
    for (const [stack, source] of Object.entries(NODE_ENV_SOURCES)) {
      if (stacks.includes(stack as ProbedStack)) expect(agents).toContain(source);
      else expect(agents).not.toContain(source);
    }
    if (stacks.includes('hono')) {
      expect(agents).toContain(BUN_APPS_ELSEWHERE);
      expect(agents).toContain(BUN_BUILD_INLINES);
    } else {
      expect(agents).not.toContain(BUN_APPS_ELSEWHERE);
      expect(agents).not.toContain(BUN_BUILD_INLINES);
    }
  });
});

describe('postgres without an ORM', () => {
  test('the local DATABASE_URL disables TLS for the Docker database', async () => {
    const projectDir = await generate('pg-ssl-no-orm', ['--app', 'pg-ssl-no-orm:nextjs', '--database', 'postgres']);
    expect(await readTextFile(join(projectDir, '.env.example'))).toMatch(LOCAL_URL_WITHOUT_TLS);
    const pkg = await readJsonFile<PackageJson>(join(projectDir, 'package.json'));
    expect(pkg.dependencies?.['pg-connection-string']).toBeUndefined();
  });
});

describe('postgres through Hyperdrive', () => {
  test('the Worker client keeps the binding connection string alone', async () => {
    const projectDir = await generate('pg-ssl-hyperdrive', [
      '--app',
      'web:nextjs',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
      '--deployment',
      'cloudflare',
    ]);
    const index = await readTextFile(join(projectDir, 'src/lib/db/index.ts'));
    expect(index).toContain('new Client({ connectionString: hyperdrive.connectionString })');
    expect(index).not.toContain('ssl');
    expect(await readTextFile(join(projectDir, '.env.example'))).toMatch(LOCAL_URL_WITHOUT_TLS);
    const pkg = await readJsonFile<PackageJson>(join(projectDir, 'package.json'));
    expect(pkg.dependencies?.['pg-connection-string']).toBeUndefined();
  });
});

describe('postgres blueprints', () => {
  const postgresBlueprints = Object.entries(META.blueprints)
    .filter(([, blueprint]) => blueprint.context.project.database === 'postgres')
    .map(([blueprint, { context }]) => ({
      blueprint,
      client: context.apps.length > 1 ? 'packages/db/src/index.ts' : 'src/lib/db/index.ts',
    }));

  test('every postgres blueprint is covered', () => {
    expect(postgresBlueprints.map(({ blueprint }) => blueprint).sort()).toEqual([
      'dapp-privy-nextjs',
      'dapp-rainbowkit-nextjs',
      'multitenant-saas-nextjs',
      'org-dashboard-nextjs',
    ]);
  });

  test.each(postgresBlueprints)('$blueprint: the drizzle client turns TLS on in production', async ({
    blueprint,
    client,
  }) => {
    const projectDir = await generate(`pg-ssl-${blueprint}`, ['--blueprint', blueprint]);
    expect(await readTextFile(join(projectDir, client))).toContain(DRIZZLE_TLS_IN_PRODUCTION);
  });
});
