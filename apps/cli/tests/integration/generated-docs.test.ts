import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

// A command written as `<pm> <script>` is only valid for scripts the package manager owns
// (`bun build` runs Bun's bundler, `npm dev` is an unknown command): scripts need `<pm> run <script>`.
const BARE_PM_COMMAND = /`(?:bun|npm|pnpm) (?:dev|build|start|check|lint|format|db:[\w:-]+)\b/;
const BUN_FORM = /\bbunx?\b/;

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
