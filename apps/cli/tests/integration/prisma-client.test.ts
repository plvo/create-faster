import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, readTextFile, runCli } from './helpers';

const WORKERD_GENERATOR = `generator client {
  provider = "prisma-client"
  runtime  = "workerd"
  output   = "../generated/prisma"
}

generator nodeClient {
  provider = "prisma-client"
  output   = "../generated/prisma-node"
}`;

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

describe('Prisma + Postgres + Cloudflare (Hyperdrive)', () => {
  let projectPath: string;

  beforeAll(async () => {
    projectPath = await generate('prisma-pg-cf', ['--app', 'api:hono', '--database', 'postgres', '--orm', 'prisma', '--deployment', 'cloudflare']);
  });

  test('db client is a per-request factory over the Hyperdrive connection string', async () => {
    const index = await readTextFile(join(projectPath, 'src/lib/db/index.ts'));
    expect(index).toContain("import { PrismaPg } from '@prisma/adapter-pg';");
    expect(index).toContain('export function createDb(hyperdrive: Hyperdrive)');
    expect(index).toContain('new PrismaPg({ connectionString: hyperdrive.connectionString })');
    expect(index).toContain('export type Database = ReturnType<typeof createDb>;');
    expect(index).not.toContain('DATABASE_URL');
    expect(index).not.toContain('export const prisma');
    expect(index).not.toContain('globalForPrisma');
  });

  test('the Worker client is generated for workerd, with a Node client for scripts', async () => {
    const schema = await readTextFile(join(projectPath, 'prisma/schema.prisma'));
    expect(schema).toContain(WORKERD_GENERATOR);
  });

  test('seed connects directly through DATABASE_URL with the Node client', async () => {
    const seed = await readTextFile(join(projectPath, 'scripts/seed.ts'));
    expect(seed).toContain("import { PrismaPg } from '@prisma/adapter-pg';");
    expect(seed).toContain("import { PrismaClient } from '../generated/prisma-node/client';");
    expect(seed).toContain('connectionString: process.env.DATABASE_URL');
    expect(seed).not.toContain("from '../src/lib/db'");
  });

  test('drops the pg-connection-string dependency only the singleton TLS warning used', async () => {
    const pkg = await readJsonFile<{ dependencies: Record<string, string> }>(join(projectPath, 'package.json'));
    expect(pkg.dependencies['pg-connection-string']).toBeUndefined();
    expect(pkg.dependencies['pg-cloudflare']).toBeDefined();
  });

  test('agent notes describe the per-request client, not the singleton TLS default', async () => {
    const agent = await readTextFile(join(projectPath, 'AGENTS.md'));
    expect(agent).toContain('**Database — Hyperdrive**');
    expect(agent).not.toContain('TLS in production: the generated client');
  });
});

describe('Prisma + MySQL + Cloudflare (Hyperdrive)', () => {
  test('db client builds the adapter from the Hyperdrive binding fields', async () => {
    const projectPath = await generate('prisma-my-cf', ['--app', 'api:hono', '--database', 'mysql', '--orm', 'prisma', '--deployment', 'cloudflare']);
    const index = await readTextFile(join(projectPath, 'src/lib/db/index.ts'));
    expect(index).toContain("import { PrismaMariaDb } from '@prisma/adapter-mariadb';");
    expect(index).toContain('export function createDb(hyperdrive: Hyperdrive)');
    for (const field of ['host', 'port', 'user', 'password', 'database']) {
      expect(index).toContain(`${field}: hyperdrive.${field},`);
    }
    expect(index).not.toContain('DATABASE_URL');
    expect(index).not.toContain('export const prisma');

    const schema = await readTextFile(join(projectPath, 'prisma/schema.prisma'));
    expect(schema).toContain(WORKERD_GENERATOR);

    const seed = await readTextFile(join(projectPath, 'scripts/seed.ts'));
    expect(seed).toContain("import { PrismaMariaDb } from '@prisma/adapter-mariadb';");
    expect(seed).toContain('new PrismaMariaDb(process.env.DATABASE_URL');
  });
});

describe('Prisma + Cloudflare in a Turborepo', () => {
  test('the db package carries the factory, both generators and the Node seed client', async () => {
    const projectPath = await generate('prisma-pg-cf-turbo', [
      '--app',
      'web:nextjs',
      '--app',
      'api:hono',
      '--database',
      'postgres',
      '--orm',
      'prisma',
      '--deployment',
      'cloudflare',
    ]);
    const index = await readTextFile(join(projectPath, 'packages/db/src/index.ts'));
    expect(index).toContain("from '../generated/prisma/client'");
    expect(index).toContain('export function createDb(hyperdrive: Hyperdrive)');

    const schema = await readTextFile(join(projectPath, 'packages/db/prisma/schema.prisma'));
    expect(schema).toContain(WORKERD_GENERATOR);

    const seed = await readTextFile(join(projectPath, 'packages/db/scripts/seed.ts'));
    expect(seed).toContain("from '../generated/prisma-node/client'");
  });
});

describe('Prisma off Cloudflare stays a Node singleton', () => {
  test('postgres keeps the singleton client and a single generator', async () => {
    const projectPath = await generate('prisma-pg-node', ['--app', 'api:hono', '--database', 'postgres', '--orm', 'prisma']);
    const index = await readTextFile(join(projectPath, 'src/lib/db/index.ts'));
    expect(index).toContain('export const prisma =');
    expect(index).not.toContain('createDb');

    const schema = await readTextFile(join(projectPath, 'prisma/schema.prisma'));
    expect(schema).not.toContain('workerd');
    expect(schema).not.toContain('nodeClient');

    const seed = await readTextFile(join(projectPath, 'scripts/seed.ts'));
    expect(seed).toContain("import { prisma } from '../src/lib/db';");
  });

  test('mysql hands DATABASE_URL to the adapter whole so its TLS settings reach the driver', async () => {
    const projectPath = await generate('prisma-my-node', ['--app', 'api:hono', '--database', 'mysql', '--orm', 'prisma']);
    const index = await readTextFile(join(projectPath, 'src/lib/db/index.ts'));
    expect(index).toContain("new PrismaMariaDb(process.env.DATABASE_URL ?? 'mysql://localhost:3306/db')");
    expect(index).not.toContain('new URL(');
    expect(index).not.toContain('hostname');
  });
});
