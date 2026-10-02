import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, runCli, runCommand } from './helpers';

const TIMEOUT_PROJECT = 300_000;

const PROJECTS: { name: string; args: string[] }[] = [
  { name: 'nextjs-shadcn', args: ['--app', 'nextjs-shadcn:nextjs:shadcn'] },
  { name: 'tanstack-shadcn', args: ['--app', 'tanstack-shadcn:tanstack-start:shadcn'] },
  { name: 'turbo-mdx', args: ['--app', 'web:nextjs:shadcn,mdx', '--app', 'api:hono'] },
  {
    name: 'turbo-mixed',
    args: [
      '--app',
      'web:nextjs:shadcn,vitest',
      '--app',
      'admin:tanstack-start:shadcn',
      '--app',
      'api:hono:vitest-node',
      '--app',
      'mobile:expo:nativewind,jest-expo',
    ],
  },
  ...[
    'dapp-privy',
    'dapp-rainbowkit',
    'lambda-sst',
    'lambda-terraform-aws',
    'org-dashboard',
    'multitenant-saas',
    'cloudflare-static-site',
    'cloudflare-fullstack',
    'showcase',
  ].map((blueprint) => ({ name: blueprint, args: ['--blueprint', blueprint] })),
];

describe('oxc linter on generated projects', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  for (const { name, args } of PROJECTS) {
    test(
      `${name}: lint and format run cleanly`,
      async () => {
        const generated = await runCli(
          [name, ...args, '--linter', 'oxc', '--no-git', '--no-install', '--pm', 'bun'],
          tempDir,
        );
        expect(generated.exitCode).toBe(0);

        const projectDir = join(tempDir, name);
        expect((await runCommand(['bun', 'install'], projectDir)).exitCode).toBe(0);

        const lint = await runCommand(['bun', 'run', 'lint'], projectDir);
        expect(lint.stdout).not.toContain('error');
        expect(lint.stderr).not.toContain('[@shadcn/lint]');
        expect(lint.exitCode).toBe(0);

        const format = await runCommand(['bun', 'run', 'format'], projectDir);
        expect(format.exitCode).toBe(0);
      },
      TIMEOUT_PROJECT,
    );
  }
});
