import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const COMMON_FLAGS = ['--database', 'postgres', '--orm', 'drizzle', '--deployment', 'sst', '--no-git', '--no-install'];

describe('SST runtime secrets', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(name: string, args: string[]): Promise<string> {
    const result = await runCli([name, ...args, ...COMMON_FLAGS, '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    return readTextFile(join(tempDir, name, 'sst.config.ts'));
  }

  function secretDeclarations(config: string): string[] {
    return [...config.matchAll(/new sst\.Secret\('(\w+)'\)/g)].map((match) => match[1] ?? '');
  }

  test('single repo: Next.js receives its secrets as environment variables of the same name', async () => {
    const config = await generate('sst-secrets-single', ['--app', 'web:nextjs:better-auth']);

    expect(secretDeclarations(config)).toEqual(['DatabaseUrl', 'BetterAuthSecret', 'BetterAuthUrl']);
    expect(config).toContain(`new sst.aws.Nextjs('web', {
      environment: {
        DATABASE_URL: secrets.DatabaseUrl.value,
        BETTER_AUTH_SECRET: secrets.BetterAuthSecret.value,
        BETTER_AUTH_URL: secrets.BetterAuthUrl.value,
      },
    });`);
  });

  test('turborepo: each app receives its own secrets from one declaration shared by the apps', async () => {
    const config = await generate('sst-secrets-turbo', [
      '--app',
      'web:nextjs:better-auth',
      '--app',
      'site:tanstack-start:better-auth',
      '--app',
      'api:hono',
    ]);

    expect(secretDeclarations(config)).toEqual(['DatabaseUrl', 'BetterAuthSecret', 'BetterAuthUrl']);
    expect(config).toContain(`new sst.aws.Nextjs('web', {
      path: 'apps/web/',
      environment: {
        DATABASE_URL: secrets.DatabaseUrl.value,
        BETTER_AUTH_SECRET: secrets.BetterAuthSecret.value,
        BETTER_AUTH_URL: secrets.BetterAuthUrl.value,
      },
    });`);
    expect(config).toContain(`new sst.aws.TanStackStart('site', {
      path: 'apps/site/',
      environment: {
        NODE_ENV: $dev ? 'development' : 'production',
        NITRO_PRESET: 'aws-lambda',
        DATABASE_URL: secrets.DatabaseUrl.value,
        BETTER_AUTH_SECRET: secrets.BetterAuthSecret.value,
        BETTER_AUTH_URL: secrets.BetterAuthUrl.value,
      },
    });`);
    expect(config).toContain(`new sst.aws.Function('api', {
      url: true,
      handler: 'apps/api/src/index.handler',
      environment: {
        NODE_ENV: $dev ? 'development' : 'production',
        DATABASE_URL: secrets.DatabaseUrl.value,
      },
    });`);
  });

  test('a blueprint on sst receives the secrets of its libraries and database', async () => {
    const result = await runCli(
      ['sst-secrets-blueprint', '--blueprint', 'org-dashboard', '--deployment', 'sst', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const config = await readTextFile(join(tempDir, 'sst-secrets-blueprint', 'sst.config.ts'));

    expect(secretDeclarations(config)).toEqual(['DatabaseUrl', 'BetterAuthSecret', 'BetterAuthUrl']);
    expect(config).toContain('BETTER_AUTH_SECRET: secrets.BetterAuthSecret.value');
  });

  test('a project without a runtime secret declares none', async () => {
    const result = await runCli(
      ['sst-secrets-none', '--app', 'web:nextjs', '--deployment', 'sst', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const config = await readTextFile(join(tempDir, 'sst-secrets-none', 'sst.config.ts'));

    expect(config).not.toContain('sst.Secret');
    expect(config).not.toContain('secrets.');
    expect(config).not.toContain('environment');
  });

  test('the generated notes tell how to set each secret per stage', async () => {
    await generate('sst-secrets-notes', ['--app', 'web:nextjs:better-auth']);
    const agents = await readTextFile(join(tempDir, 'sst-secrets-notes', 'AGENTS.md'));

    expect(agents).toContain('sst secret set DatabaseUrl');
    expect(agents).toContain('sst secret set BetterAuthSecret');
    expect(agents).toContain('sst secret set BetterAuthUrl');
    expect(agents).toContain('DATABASE_URL');
  });
});
