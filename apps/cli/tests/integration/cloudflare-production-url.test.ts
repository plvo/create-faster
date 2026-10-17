import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BINARY_RUNNER = { bun: 'bunx', npm: 'npx', pnpm: 'pnpm exec' } as const;
const SUBDOMAIN_URL = 'https://api.cloudflare.com/client/v4/accounts/<account id>/workers/subdomain';

type PackageManager = keyof typeof BINARY_RUNNER;

function expectInOrder(text: string, markers: string[]): void {
  let from = 0;
  for (const marker of markers) {
    const at = text.indexOf(marker, from);
    expect(at, `"${marker}" after offset ${from}`).toBeGreaterThanOrEqual(0);
    from = at + marker.length;
  }
}

describe.each(Object.keys(BINARY_RUNNER) as PackageManager[])('cloudflare-fullstack-nextjs deploy notes with %s', (pm) => {
  const projectName = `urls-${pm}`;
  const runner = BINARY_RUNNER[pm];
  const productionUrl = `https://${projectName}-web.<subdomain>.workers.dev`;
  let tempDir: string;
  let notes: string;
  let schema: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(
      [projectName, '--blueprint', 'cloudflare-fullstack-nextjs', '--no-install', '--no-git', '--pm', pm],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    notes = await readTextFile(join(tempDir, projectName, 'docs/agents/cloudflare-deploy.md'));
    schema = await readTextFile(join(tempDir, projectName, 'packages/db/src/schema.ts'));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('the production URL is learned from Wrangler and the Workers API before the secrets, the build and the deploy', () => {
    expectInOrder(notes, [
      `(cd apps/web && ${runner} wrangler whoami)`,
      `$( (cd apps/web && WRANGLER_HIDE_BANNER=true ${runner} wrangler auth token) )`,
      SUBDOMAIN_URL,
      productionUrl,
      '### Secrets',
      '## Build & deploy',
      'export NEXT_PUBLIC_APP_URL=',
      `(cd apps/web && ${pm} run build:cf)`,
      `(cd apps/web && ${pm} run deploy -- --secrets-file .prod.env)`,
    ]);
  });

  test('a first deploy of a Worker that has no workers.dev subdomain yet says where to register one', () => {
    expect(notes).toContain('10007');
    expect(notes).toContain('https://dash.cloudflare.com/<account id>/workers/onboarding');
  });

  test('the build sets the production URL itself and the secrets file reuses it, so .env needs no real value', () => {
    expect(notes).toContain(`export NEXT_PUBLIC_APP_URL=${productionUrl}`);
    expect(notes).toContain(
      `printf 'BETTER_AUTH_SECRET=%s\\nBETTER_AUTH_URL=%s\\n' "$(openssl rand -base64 32)" "$NEXT_PUBLIC_APP_URL" > apps/web/.prod.env`,
    );
    expect(notes).not.toContain('stay in `.env` at build time');
    expect(notes).toMatch(/Only `NEXT_PUBLIC_APP_URL` is given to the build/);
  });

  test('the first admin is promoted with a remote D1 command that matches the generated schema', () => {
    expect(notes).toContain(
      `(cd apps/web && ${runner} wrangler d1 execute DB --remote --command "UPDATE users SET role = 'admin' WHERE email = '<your email>'")`,
    );
    expect(schema).toContain("sqliteTable('users'");
    expect(schema).toContain("role: text('role')");
    expect(schema).toContain("email: text('email')");
    expectInOrder(notes, ['## Build & deploy', '## First admin', 'wrangler d1 execute DB --remote']);
  });

  test('the known warnings are listed and called harmless', () => {
    expect(notes).toContain('Missing required secrets');
    expect(notes).toMatch(/middleware.*deprecat/i);
    expect(notes).toContain('harmless');
  });
});

describe('Production URL notes of the Cloudflare agent context', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(name: string, args: string[]): Promise<string> {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    return readTextFile(join(tempDir, name, 'AGENTS.md'));
  }

  test('a Next.js app with better-auth and tRPC learns the URL, builds with it and knows the warnings', async () => {
    const agents = await generate('url-next', [
      '--app',
      'web:nextjs:better-auth,trpc',
      '--database',
      'd1',
      '--orm',
      'drizzle',
      '--deployment',
      'cloudflare',
    ]);

    expectInOrder(agents, [
      '### Production URL',
      'bunx wrangler whoami',
      'WRANGLER_HIDE_BANNER=true bunx wrangler auth token',
      SUBDOMAIN_URL,
      'https://url-next.<subdomain>.workers.dev',
      '### Database: D1',
    ]);
    expect(agents).toContain('`BETTER_AUTH_URL` is the public URL of the Worker');
    expect(agents).toContain('NEXT_PUBLIC_APP_URL');
    expect(agents).toContain('Missing required secrets');
    expect(agents).toMatch(/middleware.*deprecat/i);
  });

  test('a turborepo runs Wrangler from the app that holds the Worker config and names each Worker URL', async () => {
    const agents = await generate('url-mono', [
      '--app',
      'api:hono',
      '--app',
      'web:tanstack-start:better-auth',
      '--database',
      'd1',
      '--orm',
      'drizzle',
      '--deployment',
      'cloudflare',
    ]);

    expect(agents).toContain('(cd apps/web && bunx wrangler whoami)');
    expect(agents).toContain('$( (cd apps/web && WRANGLER_HIDE_BANNER=true bunx wrangler auth token) )');
    expect(agents).toContain('https://url-mono-web.<subdomain>.workers.dev');
    expect(agents).not.toContain('NEXT_PUBLIC_APP_URL');
  });

  test('a project without better-auth has no URL to learn', async () => {
    const agents = await generate('url-none', ['--app', 'web:nextjs', '--deployment', 'cloudflare']);

    expect(agents).not.toContain('### Production URL');
    expect(agents).not.toContain('wrangler auth token');
  });
});
