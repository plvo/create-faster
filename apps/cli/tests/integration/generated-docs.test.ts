import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

// A command written as `<pm> <script>` is only valid for scripts the package manager owns
// (`bun build` runs Bun's bundler, `npm dev` is an unknown command): scripts need `<pm> run <script>`.
const BARE_PM_COMMAND = /`(?:bun|npm|pnpm) (?:dev|build|start|check|lint|format|db:[\w:-]+)\b/;
const BUN_FORM = /\bbunx?\b/;

describe('generated AGENTS.md places the schema and names the database', () => {
  let dir: string;

  async function agentsOf(name: string, args: string[]): Promise<string> {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], dir);
    expect(result.exitCode).toBe(0);
    return readTextFile(join(dir, name, 'AGENTS.md'));
  }

  beforeAll(async () => {
    dir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('a single repo has no db package: the Drizzle schema is in src/lib/db', async () => {
    const agents = await agentsOf('drizzle-single', [
      '--app',
      'drizzle-single:nextjs',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
    ]);
    expect(agents).toContain('`src/lib/db/schema.ts`');
    expect(agents).not.toContain('db package');
  });

  test('a turborepo keeps the Drizzle schema in packages/db', async () => {
    const agents = await agentsOf('drizzle-turbo', [
      '--app',
      'web:nextjs',
      '--app',
      'api:hono',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
    ]);
    expect(agents).toContain('`packages/db/src/schema.ts`');
  });

  test('a single repo has no db package: the Prisma schema is in prisma/', async () => {
    const agents = await agentsOf('prisma-single', [
      '--app',
      'prisma-single:nextjs',
      '--database',
      'postgres',
      '--orm',
      'prisma',
    ]);
    expect(agents).toContain('`prisma/schema.prisma`');
    expect(agents).not.toContain('db package');
  });

  test('a turborepo keeps the Prisma schema in packages/db', async () => {
    const agents = await agentsOf('prisma-turbo', [
      '--app',
      'web:nextjs',
      '--app',
      'api:hono',
      '--database',
      'postgres',
      '--orm',
      'prisma',
    ]);
    expect(agents).toContain('`packages/db/prisma/schema.prisma`');
  });

  test.each([
    ['single', ['--app', 'd1-single:nextjs'], 'd1-single'],
    ['turborepo', ['--app', 'web:nextjs', '--app', 'api:hono'], 'd1-turbo'],
  ])('the %s Stack list names Cloudflare D1', async (_repo, apps, name) => {
    const agents = await agentsOf(name, [...apps, '--deployment', 'cloudflare', '--database', 'd1', '--orm', 'drizzle']);
    expect(agents).toContain('- Database: Cloudflare D1');
  });
});

describe('turborepo docs and summary list every app and package', () => {
  let dir: string;
  let stdout: string;
  let readme: string;
  let agents: string;

  beforeAll(async () => {
    dir = await createTempDir();
    const result = await runCli(
      [
        'mono',
        '--app',
        'web:nextjs:shadcn,better-auth',
        '--app',
        'api:hono',
        '--app',
        'worker:node',
        '--app',
        'mobile:expo',
        '--database',
        'postgres',
        '--orm',
        'drizzle',
        '--no-git',
        '--no-install',
        '--pm',
        'npm',
      ],
      dir,
    );
    expect(result.exitCode).toBe(0);
    stdout = stripVTControlCharacters(result.stdout);
    readme = await readTextFile(join(dir, 'mono', 'README.md'));
    agents = await readTextFile(join(dir, 'mono', 'AGENTS.md'));
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('README gives the dev URL of every app that serves, not of the ones that do not', () => {
    expect(readme).toContain('- web: [http://localhost:3000](http://localhost:3000)');
    expect(readme).toContain('- api: [http://localhost:3001](http://localhost:3001)');
    expect(readme).not.toContain('- worker:');
    expect(readme).not.toContain('- mobile:');
  });

  test('AGENTS.md gives the dev URL of every app that serves', () => {
    expect(agents).toContain('- `apps/web` — nextjs (http://localhost:3000)');
    expect(agents).toContain('- `apps/api` — hono (http://localhost:3001)');
    expect(agents).toContain('- `apps/worker` — node\n');
    expect(agents).toContain('- `apps/mobile` — expo\n');
  });

  test('README and AGENTS.md list every generated package', () => {
    for (const name of ['ui', 'auth', 'db']) {
      expect(readme).toContain(`- \`packages/${name}\``);
      expect(agents).toContain(`- \`packages/${name}\``);
    }
    expect(agents).toContain('- `packages/db` — Drizzle schema and client');
    expect(agents).not.toContain('\n\n\n');
  });

  test('a Cloudflare turborepo of Next.js apps has no root start script and its README does not list one', async () => {
    const args = ['cf', '--app', 'web:nextjs', '--app', 'docs:nextjs', '--deployment', 'cloudflare'];
    const result = await runCli([...args, '--no-git', '--no-install', '--pm', 'npm'], dir);
    expect(result.exitCode).toBe(0);
    const root = JSON.parse(await readTextFile(join(dir, 'cf', 'package.json'))) as { scripts: Record<string, string> };
    expect(root.scripts.start).toBeUndefined();
    expect(await readTextFile(join(dir, 'cf', 'README.md'))).not.toContain('- `start`');
  });

  test('AGENTS.md has no Packages section when the turborepo generates none', async () => {
    const result = await runCli(
      ['bare', '--app', 'web:nextjs', '--app', 'api:hono', '--no-git', '--no-install', '--pm', 'npm'],
      dir,
    );
    expect(result.exitCode).toBe(0);
    const bare = await readTextFile(join(dir, 'bare', 'AGENTS.md'));
    expect(bare).not.toContain('## Packages');
    expect(bare).not.toContain('\n\n\n');
  });

  test('the CLI summary lists every generated package', () => {
    expect(stdout).toContain('├─ 📦 packages/');
    expect(stdout).toMatch(/ui\/\s/);
    expect(stdout).toMatch(/auth\/\s/);
    expect(stdout).toContain('db/ (Drizzle + PostgreSQL)');
  });
});

describe('recreate command', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test.each([
    ['bun', 'bunx create-faster'],
    ['npm', 'npx create-faster'],
  ])('is run with the runner of --pm %s', async (pm, runner) => {
    const name = `recreate-${pm}`;
    const result = await runCli([name, '--app', `${name}:nextjs`, '--no-git', '--no-install', '--pm', pm], dir);
    expect(result.exitCode).toBe(0);
    expect(stripVTControlCharacters(result.stdout)).toContain(`${runner} ${name} --app ${name}:nextjs`);
  });

  test.skipIf(!Bun.which('pnpm'))('is run with pnpm dlx under --pm pnpm', async () => {
    const args = ['recreate-pnpm', '--app', 'recreate-pnpm:nextjs', '--no-git', '--no-install', '--pm', 'pnpm'];
    const result = await runCli(args, dir);
    expect(result.exitCode).toBe(0);
    expect(stripVTControlCharacters(result.stdout)).toContain('pnpm dlx create-faster recreate-pnpm --app');
  });
});

describe('generated docs write commands every package manager runs', () => {
  let dir: string;

  async function generate(name: string, args: string[], pm: string): Promise<string> {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', pm], dir);
    expect(result.exitCode).toBe(0);
    return join(dir, name);
  }

  beforeAll(async () => {
    dir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(dir);
  });

  test('single repo AGENTS.md under npm lists scripts as npm run', async () => {
    const project = await generate(
      'single-npm',
      ['--app', 'single-npm:nextjs:shadcn', '--database', 'postgres', '--orm', 'prisma', '--linter', 'biome'],
      'npm',
    );
    const agents = await readTextFile(join(project, 'AGENTS.md'));
    expect(agents).toContain('`npm run dev`');
    expect(agents).toContain('`npm run build`');
    expect(agents).toContain('`npm run db:push`');
    expect(agents).toContain('`npm run check`');
    expect(agents).toContain('npx shadcn@latest add');
    expect(agents).not.toMatch(BARE_PM_COMMAND);
    expect(agents).not.toMatch(BUN_FORM);
  });

  test('single repo AGENTS.md under bun does not call the Bun bundler', async () => {
    const project = await generate(
      'single-bun',
      ['--app', 'single-bun:tanstack-start', '--database', 'postgres', '--orm', 'drizzle'],
      'bun',
    );
    const agents = await readTextFile(join(project, 'AGENTS.md'));
    expect(agents).toContain('`bun run build`');
    expect(agents).toContain('`bun run db:generate`');
    expect(agents).not.toMatch(BARE_PM_COMMAND);
  });

  test('turborepo AGENTS.md under npm lists scripts as npm run', async () => {
    const project = await generate(
      'turbo-npm',
      ['--app', 'web:nextjs', '--app', 'admin:tanstack-start', '--database', 'postgres', '--orm', 'drizzle'],
      'npm',
    );
    const agents = await readTextFile(join(project, 'AGENTS.md'));
    expect(agents).toContain('`npm run dev`');
    expect(agents).toContain('`npm run build`');
    expect(agents).toContain('`npm run db:generate`');
    expect(agents).not.toMatch(BARE_PM_COMMAND);
  });

  test('Cloudflare and Drizzle notes follow the package manager', async () => {
    const project = await generate(
      'cf-npm',
      ['--app', 'cf-npm:nextjs', '--deployment', 'cloudflare', '--database', 'd1', '--orm', 'drizzle'],
      'npm',
    );
    const agents = await readTextFile(join(project, 'AGENTS.md'));
    expect(agents).toContain('`npm run build:cf`');
    expect(agents).toContain('npm run deploy --secrets-file .prod.env');
    expect(agents).not.toMatch(BUN_FORM);
  });

  test('blueprint README and agent guides follow the package manager', async () => {
    const project = await generate('bp-npm', ['--blueprint', 'cloudflare-static-site'], 'npm');
    const readme = await readTextFile(join(project, 'README.md'));
    expect(readme).toContain('npm install\nnpm run dev');
    expect(readme).not.toMatch(BUN_FORM);
    const guide = await readTextFile(join(project, 'docs/agents/cloudflare-deploy.md'));
    expect(guide).toContain('npm run deploy');
    expect(guide).not.toMatch(BUN_FORM);
  });

  test('Hono on Cloudflare notes follow the package manager', async () => {
    const project = await generate(
      'hono-cf-npm',
      ['--app', 'hono-cf-npm:hono', '--deployment', 'cloudflare'],
      'npm',
    );
    const agents = await readTextFile(join(project, 'AGENTS.md'));
    expect(agents).toContain('`npm run preview`');
    expect(agents).not.toMatch(/\bbun run\b/);
  });
});
