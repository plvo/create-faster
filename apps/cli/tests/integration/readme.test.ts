import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

describe('README of a single repo', () => {
  let dir: string;
  let readme: string;

  beforeAll(async () => {
    dir = await createTempDir();
    await runCli(
      [
        'myapp',
        '--app',
        'myapp:nextjs:shadcn,better-auth',
        '--database',
        'postgres',
        '--orm',
        'drizzle',
        '--linter',
        'biome',
        '--tooling',
        'husky',
        '--git',
        '--pm',
        'bun',
        '--no-install',
      ],
      dir,
    );
    readme = await readTextFile(join(dir, 'myapp', 'README.md'));
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('lists the app libraries', () => {
    expect(readme).toContain('**nextjs** with 2 libraries');
    expect(readme).toContain('- Libraries: shadcn, better-auth');
  });

  test('describes the database and the ORM', () => {
    expect(readme).toContain('## Database & ORM');
    expect(readme).toContain('- **Database**: postgres');
    expect(readme).toContain('- **ORM**: drizzle');
  });

  test('describes the linter and the tooling', () => {
    expect(readme).toContain('- Git version control initialized');
    expect(readme).toContain('- Linter: biome');
    expect(readme).toContain('- husky');
  });

  test('documents the migration command the project defines', () => {
    expect(readme).toContain('bun run db:migrate');
  });
});

describe('README of a single repo without database', () => {
  let dir: string;
  let readme: string;

  beforeAll(async () => {
    dir = await createTempDir();
    await runCli(['myapp', '--app', 'myapp:nextjs', '--no-git', '--no-install'], dir);
    readme = await readTextFile(join(dir, 'myapp', 'README.md'));
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('omits the database, library and tooling sections', () => {
    expect(readme).not.toContain('Database & ORM');
    expect(readme).not.toContain('db:migrate');
    expect(readme).not.toContain('Libraries:');
    expect(readme).not.toContain('Linter:');
  });

  test('omits the Development Tools heading when nothing belongs under it', () => {
    expect(readme).not.toContain('## Development Tools');
  });
});

describe('README of a turborepo', () => {
  let dir: string;
  let readme: string;

  beforeAll(async () => {
    dir = await createTempDir();
    await runCli(
      [
        'mono',
        '--app',
        'web:nextjs:shadcn,tanstack-query',
        '--app',
        'api:hono',
        '--database',
        'postgres',
        '--orm',
        'drizzle',
        '--linter',
        'biome',
        '--tooling',
        'husky',
        '--git',
        '--no-install',
      ],
      dir,
    );
    readme = await readTextFile(join(dir, 'mono', 'README.md'));
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('lists the libraries of each app', () => {
    expect(readme).toContain('### `apps/web` - nextjs');
    expect(readme).toContain('**Libraries** (2): shadcn, tanstack-query');
    expect(readme).toContain('### `apps/api` - hono');
    expect(readme).toContain('No additional libraries configured.');
  });

  test('describes the shared database package', () => {
    expect(readme).toContain('Uses shared database package (`packages/db`) with drizzle ORM.');
    expect(readme).toContain('- **Database**: postgres');
    expect(readme).toContain('- **ORM**: drizzle');
  });

  test('lists the database scripts the root package.json defines', () => {
    expect(readme).toContain('- `db:migrate` - Run database migrations');
    expect(readme).toContain('- `db:studio` - Open database management UI');
  });

  test('describes the tooling', () => {
    expect(readme).toContain('- husky');
  });
});

describe('README of a turborepo without database', () => {
  let dir: string;
  let readme: string;

  beforeAll(async () => {
    dir = await createTempDir();
    await runCli(['mono', '--app', 'web:nextjs', '--app', 'api:hono', '--no-git', '--no-install'], dir);
    readme = await readTextFile(join(dir, 'mono', 'README.md'));
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('omits the database sections and scripts', () => {
    expect(readme).not.toContain('Shared Packages');
    expect(readme).not.toContain('db:migrate');
    expect(readme).not.toContain('Uses shared database package');
  });

  test('keeps the Development Tools heading for the Turborepo entry', () => {
    expect(readme).toContain('## Development Tools\n\n- Turborepo for monorepo management');
  });
});

describe('README of a blueprint', () => {
  let dir: string;
  let readme: string;

  beforeAll(async () => {
    dir = await createTempDir();
    await runCli(['bp', '--blueprint', 'org-dashboard', '--linter', 'biome', '--no-git', '--no-install'], dir);
    readme = await readTextFile(join(dir, 'bp', 'README.md'));
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('lists the blueprint apps and their libraries', () => {
    expect(readme).toContain('### `apps/web` - nextjs');
    expect(readme).toContain('**Libraries** (7): shadcn, better-auth, trpc, tanstack-query');
    expect(readme).toContain('### `apps/batch` - node');
  });

  test('describes the blueprint database and the chosen linter', () => {
    expect(readme).toContain('- **Database**: postgres');
    expect(readme).toContain('- **ORM**: drizzle');
    expect(readme).toContain('- Linter: biome');
  });
});
