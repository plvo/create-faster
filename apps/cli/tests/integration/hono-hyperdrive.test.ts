import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readTextFile, runCli } from './helpers';

const COMMON = ['--no-git', '--no-install', '--pm', 'bun'];

const SINGLE_REPO_CASES = [
  { name: 'hono-hd-pg', database: 'postgres', localConnectionString: 'postgresql://postgres:password@localhost:' },
  { name: 'hono-hd-my', database: 'mysql', localConnectionString: 'mysql://mysql:password@localhost:' },
];

describe.each(SINGLE_REPO_CASES)('Hono + cloudflare + $database', ({ name, database, localConnectionString }) => {
  let projectPath: string;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, name);
    const result = await runCli(
      [name, '--app', `${name}:hono`, '--database', database, '--orm', 'drizzle', '--deployment', 'cloudflare', ...COMMON],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('wrangler.jsonc declares the HYPERDRIVE binding with a local connection string', async () => {
    const wrangler = await readTextFile(join(projectPath, 'wrangler.jsonc'));
    expect(wrangler).toContain('"binding": "HYPERDRIVE"');
    expect(wrangler).toContain(`"localConnectionString": "${localConnectionString}`);
    expect(wrangler).toContain('used by `wrangler dev` only');
  });

  test('tsconfig includes the generated worker types so Hyperdrive resolves', async () => {
    const tsconfig = await readTextFile(join(projectPath, 'tsconfig.json'));
    expect(tsconfig).toContain('"cloudflare-env.d.ts"');
  });

  test('the app types its bindings so c.env.HYPERDRIVE is checked', async () => {
    const app = await readTextFile(join(projectPath, 'src/app.ts'));
    expect(app).toContain('new Hono<{ Bindings: CloudflareEnv }>()');
  });

  test('agent doc describes the per-request Hyperdrive pattern for Hono', async () => {
    const agent = await readTextFile(join(projectPath, 'AGENTS.md'));
    expect(agent).toContain('**Database — Hyperdrive**');
    expect(agent).toContain('await createDb(c.env.HYPERDRIVE)');
    expect(agent).toContain('bun run preview');
  });
});

describe('Hono + cloudflare without a Hyperdrive database', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('no database: typed bindings and cf-typegen docs, no hyperdrive binding or docs', async () => {
    const result = await runCli(['hono-hd-none', '--app', 'hono-hd-none:hono', '--deployment', 'cloudflare', ...COMMON], tempDir);
    expect(result.exitCode).toBe(0);
    const root = join(tempDir, 'hono-hd-none');
    expect(await readTextFile(join(root, 'wrangler.jsonc'))).not.toContain('hyperdrive');
    expect(await readTextFile(join(root, 'src/app.ts'))).toContain('new Hono<{ Bindings: CloudflareEnv }>()');
    const agent = await readTextFile(join(root, 'AGENTS.md'));
    expect(agent).toContain('Run it after install');
    expect(agent).not.toContain('Hyperdrive');
  });

  test('d1: keeps its D1 binding, types c.env, gets no hyperdrive binding', async () => {
    const result = await runCli(
      ['hono-hd-d1', '--app', 'hono-hd-d1:hono', '--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare', ...COMMON],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const wrangler = await readTextFile(join(tempDir, 'hono-hd-d1', 'wrangler.jsonc'));
    expect(wrangler).toContain('"d1_databases"');
    expect(wrangler).not.toContain('hyperdrive');
    expect(await readTextFile(join(tempDir, 'hono-hd-d1', 'src/app.ts'))).toContain('Bindings: CloudflareEnv');
  });

  test('postgres off cloudflare: no wrangler config, no worker types in tsconfig or app', async () => {
    const result = await runCli(
      ['hono-hd-node', '--app', 'hono-hd-node:hono', '--database', 'postgres', '--orm', 'drizzle', ...COMMON],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const root = join(tempDir, 'hono-hd-node');
    expect(await fileExists(join(root, 'wrangler.jsonc'))).toBe(false);
    expect(await readTextFile(join(root, 'tsconfig.json'))).not.toContain('cloudflare-env.d.ts');
    expect(await readTextFile(join(root, 'src/app.ts'))).not.toContain('Bindings');
  });
});

describe('Turborepo: Next.js + Hono + cloudflare + postgres', () => {
  let projectPath: string;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, 'hono-hd-turbo');
    const result = await runCli(
      [
        'hono-hd-turbo',
        '--app', 'web:nextjs',
        '--app', 'api:hono',
        '--database', 'postgres',
        '--orm', 'drizzle',
        '--deployment', 'cloudflare',
        ...COMMON,
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('both apps declare HYPERDRIVE', async () => {
    expect(await readTextFile(join(projectPath, 'apps/api/wrangler.jsonc'))).toContain('"binding": "HYPERDRIVE"');
    expect(await readTextFile(join(projectPath, 'apps/web/wrangler.jsonc'))).toContain('"binding": "HYPERDRIVE"');
  });

  test('the Hono app gets the worker types and typed bindings, the Next.js app is unchanged', async () => {
    expect(await readTextFile(join(projectPath, 'apps/api/tsconfig.json'))).toContain('"cloudflare-env.d.ts"');
    expect(await readTextFile(join(projectPath, 'apps/api/src/app.ts'))).toContain('Bindings: CloudflareEnv');
    expect(await readTextFile(join(projectPath, 'apps/web/tsconfig.json'))).not.toContain('"cloudflare-env.d.ts"');
  });
});

describe('Agent doc: localConnectionString runtime per stack', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('a Next.js + Start + Hono turborepo names the right runtime for each app', async () => {
    const result = await runCli(
      [
        'hono-hd-mixed',
        '--app', 'web:nextjs',
        '--app', 'start:tanstack-start',
        '--app', 'api:hono',
        '--database', 'postgres',
        '--orm', 'drizzle',
        '--deployment', 'cloudflare',
        ...COMMON,
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const agent = await readTextFile(join(tempDir, 'hono-hd-mixed', 'AGENTS.md'));
    expect(agent).toContain('  - Next.js: `wrangler dev`/local only');
    expect(agent).toContain('  - Hono: `wrangler dev` only');
    expect(agent).toContain('  - TanStack Start: `vite dev` and `vite preview` only');
  });

  test('an Expo-only project gets no Hyperdrive section, no stack deploys through it', async () => {
    const result = await runCli(
      ['hono-hd-expo', '--app', 'mobile:expo', '--database', 'postgres', '--orm', 'drizzle', '--deployment', 'cloudflare', ...COMMON],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    expect(await readTextFile(join(tempDir, 'hono-hd-expo', 'AGENTS.md'))).not.toContain('Hyperdrive');
  });

  test('a Start app alone keeps the single-stack sentence', async () => {
    const result = await runCli(
      ['hono-hd-start', '--app', 'web:tanstack-start', '--database', 'postgres', '--orm', 'drizzle', '--deployment', 'cloudflare', ...COMMON],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const agent = await readTextFile(join(tempDir, 'hono-hd-start', 'AGENTS.md'));
    expect(agent).toContain('`localConnectionString` is used by `vite dev` and `vite preview` only and matches your local `DATABASE_URL`.');
  });
});
