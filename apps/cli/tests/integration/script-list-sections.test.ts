import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const MONO = ['--app', 'web:nextjs', '--app', 'api:hono'];
const CASES = [
  ['single D1 without an ORM', ['--app', 'web:nextjs', '--database', 'd1', '--deployment', 'cloudflare']],
  [
    'single D1 with Drizzle',
    ['--app', 'web:nextjs', '--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare'],
  ],
  ['single Drizzle', ['--app', 'web:nextjs', '--database', 'postgres', '--orm', 'drizzle']],
  ['turborepo Prisma', [...MONO, '--database', 'postgres', '--orm', 'prisma']],
  ['multitenant-saas-nextjs', ['--blueprint', 'multitenant-saas-nextjs']],
  ['cloudflare-fullstack-nextjs', ['--blueprint', 'cloudflare-fullstack-nextjs']],
] as const;

const POINTER = /\(see ([\w ]+?) (below|in the README)\)/g;

describe('a Scripts list that points to a README section', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test.each(CASES)('%s: the README has the section', async (label, args) => {
    const name = label.replace(/\W+/g, '-').toLowerCase();
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'npm'], dir);
    expect(result.exitCode).toBe(0);
    const agents = await readTextFile(join(dir, name, 'AGENTS.md'));
    const readme = await readTextFile(join(dir, name, 'README.md'));

    const pointers = [...agents.matchAll(POINTER), ...readme.matchAll(POINTER)];
    expect(pointers.length).toBeGreaterThan(0);
    for (const [pointer, section] of pointers) {
      expect(readme, pointer).toContain(`\n## ${section}\n`);
    }
  });
});
