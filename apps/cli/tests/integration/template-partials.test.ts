import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const PARTIAL_NAMES = ['d1-binding', 'hyperdrive-binding', 'client-options', 'api-host', 'asset-host', 'cookie-plugin'];

const withoutDbPort = (content: string) => content.replace(/localhost:\d+\//g, 'localhost:PORT/');

async function generate(tempDir: string, args: string[]): Promise<string> {
  const result = await runCli([...args, '--no-git', '--no-install'], tempDir);
  expect(result.exitCode).toBe(0);
  return join(tempDir, args[0] ?? '');
}

const d1Wrangler = (name: string, main: string, flags: string, beforeD1: string, migrationsDir: string) => `{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "${name}",
  "main": "${main}",
  "compatibility_date": "2026-06-12",
${flags}${beforeD1},
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "${name}-db",
      "database_id": "REPLACE_WITH_D1_DATABASE_ID",
      "migrations_dir": "${migrationsDir}"
    }
  ]
}
`;

const NEXTJS_FLAGS = `  // global_fetch_strictly_public routes fetch() through the public internet so OpenNext asset serving avoids Worker subrequest limits
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],`;
const NEXTJS_ASSETS = `
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  }`;
const WORKER_FLAGS = `  "compatibility_flags": ["nodejs_compat"]`;

describe('Templates rendered through partials', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Cloudflare single repos', () => {
    test('hono + d1: wrangler.jsonc carries the D1 binding', async () => {
      const path = await generate(tempDir, [
        'cf-hono-d1',
        '--app',
        'cf-hono-d1:hono',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
      ]);
      expect(await readTextFile(join(path, 'wrangler.jsonc'))).toBe(
        d1Wrangler('cf-hono-d1', 'src/index.ts', WORKER_FLAGS, '', 'drizzle'),
      );
    });

    test('nextjs + d1 + better-auth: wrangler.jsonc and server.ts', async () => {
      const path = await generate(tempDir, [
        'cf-next-d1',
        '--app',
        'cf-next-d1:nextjs:better-auth,posthog',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
      ]);
      expect(await readTextFile(join(path, 'wrangler.jsonc'))).toBe(
        d1Wrangler('cf-next-d1', '.open-next/worker.js', NEXTJS_FLAGS, NEXTJS_ASSETS, 'drizzle'),
      );
      expect(await readTextFile(join(path, 'src/lib/server.ts'))).toBe(`import 'server-only';
import { nextCookies } from 'better-auth/next-js';
import { createDb } from '@/lib/db';
import { createAuth } from '@/lib/auth/create-auth';
import { getEnv } from '@/lib/env';

export async function getDb() {
  return createDb((await getEnv()).DB);
}

export async function getAuth() {
  return createAuth(await getDb(), nextCookies());
}
`);
    });

    test('nextjs + postgres: wrangler.jsonc carries the Hyperdrive binding for wrangler dev', async () => {
      const path = await generate(tempDir, [
        'cf-next-pg',
        '--app',
        'cf-next-pg:nextjs',
        '--database',
        'postgres',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
      ]);
      expect(withoutDbPort(await readTextFile(join(path, 'wrangler.jsonc')))).toBe(`{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "cf-next-pg",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-06-12",
${NEXTJS_FLAGS}${NEXTJS_ASSETS},
  // Run \`wrangler hyperdrive create <name> --connection-string=...\` and paste the id below.
  // localConnectionString is used by \`wrangler dev\` only; it matches the local DATABASE_URL in .env.
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "REPLACE_WITH_HYPERDRIVE_ID",
      "localConnectionString": "postgresql://postgres:password@localhost:PORT/postgres-cf-next-pg"
    }
  ]
}
`);
    });

    test('tanstack-start + mysql: wrangler.jsonc carries the Hyperdrive binding for vite dev and preview', async () => {
      const path = await generate(tempDir, [
        'cf-start-mysql',
        '--app',
        'cf-start-mysql:tanstack-start',
        '--database',
        'mysql',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
      ]);
      expect(withoutDbPort(await readTextFile(join(path, 'wrangler.jsonc')))).toBe(`{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "cf-start-mysql",
  "main": "src/server.ts",
  "compatibility_date": "2026-06-12",
${WORKER_FLAGS},
  // Run \`wrangler hyperdrive create <name> --connection-string=...\` and paste the id below.
  // localConnectionString is used by \`vite dev\` and \`vite preview\` only; it matches the local DATABASE_URL in .env.
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "REPLACE_WITH_HYPERDRIVE_ID",
      "localConnectionString": "mysql://mysql:password@localhost:PORT/mysql-cf-start-mysql"
    }
  ]
}
`);
    });

    test('tanstack-start + d1 + better-auth: wrangler.jsonc and server.ts', async () => {
      const path = await generate(tempDir, [
        'cf-start-d1',
        '--app',
        'cf-start-d1:tanstack-start:better-auth,posthog',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
      ]);
      expect(await readTextFile(join(path, 'wrangler.jsonc'))).toBe(
        d1Wrangler('cf-start-d1', 'src/server.ts', WORKER_FLAGS, '', 'drizzle'),
      );
      expect(await readTextFile(join(path, 'src/lib/server.ts')))
        .toBe(`import { tanstackStartCookies } from 'better-auth/tanstack-start';
import { env } from 'cloudflare:workers';
import { createDb } from '@/lib/db';
import { createAuth } from '@/lib/auth/create-auth';

export const db = createDb(env.DB);
export const auth = createAuth(db, tanstackStartCookies());
`);
    });
  });

  describe('Cloudflare turborepo + d1', () => {
    let path: string;

    beforeAll(async () => {
      path = await generate(tempDir, [
        'cf-turbo-d1',
        '--app',
        'web:nextjs',
        '--app',
        'start:tanstack-start',
        '--app',
        'api:hono',
        '--database',
        'd1',
        '--orm',
        'drizzle',
        '--deployment',
        'cloudflare',
      ]);
    });

    test('each wrangler.jsonc names its D1 database after the app and points at the shared migrations', async () => {
      const migrationsDir = '../../packages/db/drizzle';
      expect(await readTextFile(join(path, 'apps/web/wrangler.jsonc'))).toBe(
        d1Wrangler('web', '.open-next/worker.js', NEXTJS_FLAGS, NEXTJS_ASSETS, migrationsDir),
      );
      expect(await readTextFile(join(path, 'apps/start/wrangler.jsonc'))).toBe(
        d1Wrangler('start', 'src/server.ts', WORKER_FLAGS, '', migrationsDir),
      );
      expect(await readTextFile(join(path, 'apps/api/wrangler.jsonc'))).toBe(
        d1Wrangler('api', 'src/index.ts', WORKER_FLAGS, '', migrationsDir),
      );
    });

    test('no partial file is emitted into the project', async () => {
      const files = await readdir(path, { recursive: true });
      const emitted = files.filter((file) => PARTIAL_NAMES.some((name) => basename(file).startsWith(name)));
      expect(emitted).toEqual([]);
    });
  });

  describe('Turborepo + postgres: better-auth and posthog on nextjs and tanstack-start', () => {
    let path: string;

    beforeAll(async () => {
      path = await generate(tempDir, [
        'turbo-pg',
        '--app',
        'web:nextjs:better-auth,posthog',
        '--app',
        'start:tanstack-start:better-auth,posthog',
        '--app',
        'api:hono',
        '--database',
        'postgres',
        '--orm',
        'drizzle',
      ]);
    });

    test('each app builds its auth instance with its own cookie plugin', async () => {
      expect(await readTextFile(join(path, 'apps/web/src/lib/auth/auth.ts')))
        .toBe(`import { nextCookies } from 'better-auth/next-js';
import { createAuth } from '@repo/auth/auth';

export const auth = createAuth(nextCookies());
`);
      expect(await readTextFile(join(path, 'apps/start/src/lib/auth/auth.ts')))
        .toBe(`import { tanstackStartCookies } from 'better-auth/tanstack-start';
import { createAuth } from '@repo/auth/auth';

export const auth = createAuth(tanstackStartCookies());
`);
    });

    test('each app agent doc names its cookie plugin', async () => {
      expect(await readTextFile(join(path, 'apps/web/AGENTS.md'))).toContain(
        "`src/lib/auth/auth.ts` exports this app's `auth`, built from the factory with `nextCookies()`: import it from there.",
      );
      expect(await readTextFile(join(path, 'apps/start/AGENTS.md'))).toContain(
        "`src/lib/auth/auth.ts` exports this app's `auth`, built from the factory with `tanstackStartCookies()`: import it from there.",
      );
    });

    test('nextjs initializes PostHog with the shared client options', async () => {
      expect(await readTextFile(join(path, 'apps/web/src/instrumentation-client.ts'))).toBe(`import posthog from 'posthog-js';

if (process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN, {
    api_host: '/ingest',
    ui_host: 'https://us.posthog.com',
    defaults: '2026-05-30',
    capture_exceptions: true,
    debug: process.env.NODE_ENV === 'development',
  });
}
`);
    });

    test('tanstack-start initializes PostHog with the shared client options', async () => {
      expect(await readTextFile(join(path, 'apps/start/src/components/analytics-provider.tsx')))
        .toBe(`import { PostHogProvider } from '@posthog/react'

const POSTHOG_PROJECT_TOKEN = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  if (!POSTHOG_PROJECT_TOKEN) return children

  return (
    <PostHogProvider
      apiKey={POSTHOG_PROJECT_TOKEN}
      options={{
        api_host: '/ingest',
        ui_host: 'https://us.posthog.com',
        defaults: '2026-05-30',
        capture_exceptions: true,
        debug: import.meta.env.DEV,
      }}
    >
      {children}
    </PostHogProvider>
  )
}
`);
    });

    test('nextjs rewrites /ingest to the PostHog US hosts', async () => {
      expect(await readTextFile(join(path, 'apps/web/next.config.ts'))).toContain(`  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/array/:path*',
        destination: 'https://us-assets.i.posthog.com/array/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ];
  },
`);
    });

    test('tanstack-start proxies /ingest to the PostHog US hosts', async () => {
      expect(await readTextFile(join(path, 'apps/start/src/routes/ingest/$.ts'))).toContain(
        "\n\nconst API_HOST = 'us.i.posthog.com'\nconst ASSET_HOST = 'us-assets.i.posthog.com'\nconst PROXY_PREFIX = '/ingest'\n",
      );
    });

    test('no partial file is emitted into the project', async () => {
      const files = await readdir(path, { recursive: true });
      const emitted = files.filter((file) => PARTIAL_NAMES.some((name) => basename(file).startsWith(name)));
      expect(emitted).toEqual([]);
    });
  });
});
