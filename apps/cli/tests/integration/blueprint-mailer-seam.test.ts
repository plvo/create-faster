import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const LINK = 'http://localhost:3000/reset-password?token=abc';

async function runWithNodeEnv(script: string, nodeEnv: string) {
  const proc = Bun.spawn(['bun', '-e', script], {
    env: { ...process.env, NODE_ENV: nodeEnv },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  return { stdout, stderr };
}

describe.each([
  {
    blueprint: 'multitenant-saas-nextjs',
    seamFile: 'link-delivery.ts',
    kinds: ['reset-password'] as string[],
    call: (file: string, kind: string) =>
      `import { deliverLink } from ${JSON.stringify(file)}; deliverLink({ kind: ${JSON.stringify(kind)}, to: 'a@b.co', link: ${JSON.stringify(LINK)} });`,
    forgotPasswordForm: 'apps/web/src/app/(auth)/forgot-password/forgot-password-form.tsx',
  },
  {
    blueprint: 'cloudflare-fullstack-nextjs',
    seamFile: 'email.ts',
    kinds: ['reset-password', 'change-email'] as string[],
    call: (file: string, kind: string) =>
      `import { deliverLink } from ${JSON.stringify(file)}; await deliverLink({ kind: ${JSON.stringify(kind)}, to: 'a@b.co', link: ${JSON.stringify(LINK)} });`,
    forgotPasswordForm: 'apps/web/src/app/(auth)/forgot-password/forgot-password-form.tsx',
  },
])('$blueprint delivers links through one mailer seam', ({ blueprint, seamFile, kinds, call, forgotPasswordForm }) => {
  let tempDir: string;
  let projectPath: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(['mt', '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    projectPath = join(tempDir, 'mt');
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  const deliver = (nodeEnv: string, kind: string) =>
    runWithNodeEnv(call(join(projectPath, 'packages/auth/src', seamFile), kind), nodeEnv);

  test('auth.ts never logs a link itself', async () => {
    const auth = await readTextFile(join(projectPath, 'packages/auth/src/auth.ts'));
    expect(auth).toContain(`./${seamFile.replace('.ts', '')}`);
    expect(auth).not.toContain('console.');
  });

  test.each(kinds)('development logs the %s link without a warning', async (kind) => {
    const { stdout, stderr } = await deliver('development', kind);
    expect(stdout).toContain(`[${kind}] a@b.co`);
    expect(stdout).toContain(LINK);
    expect(stderr).toBe('');
  });

  test.each(kinds)('production still logs the %s link and warns that no mailer is configured', async (kind) => {
    const { stdout, stderr } = await deliver('production', kind);
    expect(stdout).toContain(LINK);
    expect(stderr).toContain(`[${kind}] No mailer is configured`);
    expect(stderr).toContain(seamFile);
  });

  test('the forgot-password confirmation does not promise an inbox delivery', async () => {
    const form = await readTextFile(join(projectPath, forgotPasswordForm));
    expect(form).toContain('a reset link has been sent');
    expect(form).not.toContain('Check your inbox');
    expect(form).not.toContain('on its way');
  });

  test('the generated agent docs say where the links appear and where to plug a mailer', async () => {
    const docs = await readTextFile(join(projectPath, 'docs/agents/auth-rbac.md'));
    expect(docs).toContain(seamFile);
    expect(docs).toContain('No mailer is configured');
    expect(docs).toContain('server console');
  });
});
