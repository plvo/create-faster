import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  cleanupTempDir,
  createTempDir,
  fileExists,
  filesUnder,
  printedScriptsMissingFrom,
  readTextFile,
  runCli,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const COMBINATIONS: [string, string, string[]][] = [
  ['single repo, Next.js', 'single-next', ['--app', 'web:nextjs']],
  ['single repo, TanStack Start', 'single-start', ['--app', 'web:tanstack-start']],
  ['single repo, Hono', 'single-hono', ['--app', 'api:hono']],
  ['turborepo, two Next.js apps', 'mono-next', ['--app', 'web:nextjs', '--app', 'admin:nextjs']],
  ['turborepo, Hono and Next.js', 'mono-hono', ['--app', 'api:hono', '--app', 'web:nextjs']],
];

const DOCUMENTS = ['README.md', 'AGENTS.md'];
const FORBIDDEN_IN_DOCS = [/drizzle/i, /\bdb:(generate|migrate|seed|push|studio)/, /local-setup/, /## Seeding/];

describe('the d1 database without an ORM', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    for (const [, name, apps] of COMBINATIONS) {
      const result = await runCli(
        [name, ...apps, '--database', 'd1', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
    }
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe.each(COMBINATIONS)('%s', (_, name) => {
    const projectFile = (file: string) => readTextFile(join(tempDir, name, file));

    test('no package.json carries a Drizzle script, a Wrangler migration script or the libSQL client', async () => {
      const root = join(tempDir, name);
      const manifests = (await filesUnder(root, ['node_modules'])).filter((file) => file.endsWith('package.json'));
      expect(manifests.length).toBeGreaterThan(0);
      for (const manifest of manifests) {
        const text = await readTextFile(manifest);
        expect(text).not.toMatch(/drizzle/i);
        expect(text).not.toContain('@libsql/client');
        expect(text).not.toMatch(/"(db:[\w:]+|local-setup)"/);
        expect(text).not.toContain('d1 migrations');
      }
    });

    test.each(DOCUMENTS)('%s: says nothing about Drizzle, migrations scripts or seeding', async (file) => {
      const doc = await projectFile(file);
      for (const forbidden of FORBIDDEN_IN_DOCS) expect(doc).not.toMatch(forbidden);
    });

    test.each(DOCUMENTS)('%s: the D1 provisioning goes from the paste of the id straight to the deploy', async (file) => {
      const doc = await projectFile(file);
      expect(doc).toContain('2. Copy the `database_id`');
      expect(doc).toContain('3. Deploy.');
      expect(doc).not.toMatch(/^4\. /m);
    });

    test.each(DOCUMENTS)('%s: every printed script exists in the directory it is run from', async (file) => {
      expect(await printedScriptsMissingFrom(join(tempDir, name), await projectFile(file))).toEqual([]);
    });

    test('the D1 binding has no migrations directory and no credentials file is generated', async () => {
      const root = join(tempDir, name);
      const wranglerFiles = (await filesUnder(root, ['node_modules'])).filter((file) => file.endsWith('wrangler.jsonc'));
      expect(wranglerFiles.length).toBeGreaterThan(0);
      for (const file of wranglerFiles) {
        const text = await readTextFile(file);
        expect(text).toContain('"binding": "DB"');
        expect(text).not.toContain('migrations_dir');
      }
      expect(await fileExists(join(root, '.env.d1.example'))).toBe(false);
      expect(await fileExists(join(root, 'packages/db'))).toBe(false);
    });
  });

  test('TanStack Start: the Cloudflare notes do not describe a db the project does not have', async () => {
    const agents = await readTextFile(join(tempDir, 'single-start', 'AGENTS.md'));
    expect(await fileExists(join(tempDir, 'single-start', 'src/lib/server.ts'))).toBe(false);
    expect(agents).not.toContain('src/lib/server.ts');
    expect(agents).not.toContain('createDb');
  });
});

describe('the d1 database with an ORM keeps its provisioning steps', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(
      ['with-orm', '--app', 'web:tanstack-start', '--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test.each(DOCUMENTS)('%s: local migration, remote migration and deploy are steps 3, 4 and 5', async (file) => {
    const doc = await readTextFile(join(tempDir, 'with-orm', file));
    expect(doc).toContain('3. Generate the migrations');
    expect(doc).toContain('4. Apply the migrations to the production database');
    expect(doc).toContain('5. Deploy.');
  });

  test('AGENTS.md: describes the db exported by src/lib/server.ts', async () => {
    const agents = await readTextFile(join(tempDir, 'with-orm', 'AGENTS.md'));
    expect(agents).toContain('`src/lib/server.ts` exports a `db`');
    expect(await fileExists(join(tempDir, 'with-orm', 'src/lib/server.ts'))).toBe(true);
  });
});
