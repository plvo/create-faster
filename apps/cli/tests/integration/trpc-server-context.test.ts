import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

interface ContextCase {
  name: string;
  libraries: string;
  extraApps?: string[];
  extraFlags?: string[];
  serverPath: string;
  usesOptionsProxy: boolean;
}

const POSTGRES_DRIZZLE = ['--database', 'postgres', '--orm', 'drizzle'];
const D1_CLOUDFLARE = ['--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare'];
const HONO_APP = ['--app', 'api:hono'];

const CASES: ContextCase[] = [
  { name: 'single, caller', libraries: 'trpc', serverPath: 'src/trpc/server.tsx', usesOptionsProxy: false },
  {
    name: 'single, options proxy',
    libraries: 'trpc,tanstack-query',
    serverPath: 'src/trpc/server.tsx',
    usesOptionsProxy: true,
  },
  {
    name: 'single, caller, better-auth',
    libraries: 'trpc,better-auth',
    extraFlags: POSTGRES_DRIZZLE,
    serverPath: 'src/trpc/server.tsx',
    usesOptionsProxy: false,
  },
  {
    name: 'single, options proxy, better-auth',
    libraries: 'trpc,tanstack-query,better-auth',
    extraFlags: POSTGRES_DRIZZLE,
    serverPath: 'src/trpc/server.tsx',
    usesOptionsProxy: true,
  },
  {
    name: 'single, caller, d1',
    libraries: 'trpc,better-auth',
    extraFlags: D1_CLOUDFLARE,
    serverPath: 'src/trpc/server.tsx',
    usesOptionsProxy: false,
  },
  {
    name: 'single, options proxy, d1',
    libraries: 'trpc,tanstack-query,better-auth',
    extraFlags: D1_CLOUDFLARE,
    serverPath: 'src/trpc/server.tsx',
    usesOptionsProxy: true,
  },
  {
    name: 'turborepo, caller',
    libraries: 'trpc',
    extraApps: HONO_APP,
    serverPath: 'apps/web/src/trpc/server.tsx',
    usesOptionsProxy: false,
  },
  {
    name: 'turborepo, options proxy',
    libraries: 'trpc,tanstack-query',
    extraApps: HONO_APP,
    serverPath: 'apps/web/src/trpc/server.tsx',
    usesOptionsProxy: true,
  },
  {
    name: 'turborepo, options proxy, better-auth',
    libraries: 'trpc,tanstack-query,better-auth',
    extraApps: HONO_APP,
    extraFlags: POSTGRES_DRIZZLE,
    serverPath: 'apps/web/src/trpc/server.tsx',
    usesOptionsProxy: true,
  },
  {
    name: 'turborepo, caller, d1',
    libraries: 'trpc,better-auth',
    extraApps: HONO_APP,
    extraFlags: D1_CLOUDFLARE,
    serverPath: 'apps/web/src/trpc/server.tsx',
    usesOptionsProxy: false,
  },
  {
    name: 'turborepo, options proxy, d1',
    libraries: 'trpc,tanstack-query,better-auth',
    extraApps: HONO_APP,
    extraFlags: D1_CLOUDFLARE,
    serverPath: 'apps/web/src/trpc/server.tsx',
    usesOptionsProxy: true,
  },
];

describe('tRPC server context is built once per request', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  for (const [index, testCase] of CASES.entries()) {
    test(testCase.name, async () => {
      const projectName = `trpc-ctx-${index}`;
      const result = await runCli(
        [
          projectName,
          '--app',
          `web:nextjs:${testCase.libraries}`,
          ...(testCase.extraApps ?? []),
          ...(testCase.extraFlags ?? []),
          '--no-git',
          '--no-install',
          '--pm',
          'bun',
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(0);

      const server = await readTextFile(join(tempDir, projectName, testCase.serverPath));

      expect(server).toMatch(/^const getTRPCContext = cache\(/m);
      expect(server.match(/import \{[^}]*\bcache\b[^}]*\} from 'react';/g)).toHaveLength(1);

      if (testCase.usesOptionsProxy) {
        expect(server).toContain('ctx: getTRPCContext,');
      } else {
        expect(server).toContain('createCaller(getTRPCContext)');
      }
    });
  }
});
