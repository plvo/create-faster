import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';

const LINK = 'http://localhost:3000/reset-password?token=abc';

describe('multitenant-saas delivers reset and invitation links through one mailer seam', () => {
  let tempDir: string;
  let authDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(['mt', '--blueprint', 'multitenant-saas', '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    authDir = join(tempDir, 'mt/packages/auth/src');
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function deliver(nodeEnv: string) {
    const script = `import { deliverLink } from ${JSON.stringify(join(authDir, 'link-delivery.ts'))}; deliverLink({ kind: 'reset-password', to: 'a@b.co', link: ${JSON.stringify(LINK)} });`;
    const proc = Bun.spawn(['bun', '-e', script], {
      env: { ...process.env, NODE_ENV: nodeEnv },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    await proc.exited;
    return { stdout, stderr };
  }

  test('both better-auth callbacks go through deliverLink and never log a link themselves', async () => {
    const auth = await readTextFile(join(authDir, 'auth.ts'));
    expect(auth).toContain("from './link-delivery'");
    expect(auth).toMatch(/sendResetPassword[\s\S]*deliverLink\(\{ kind: 'reset-password'/);
    expect(auth).toMatch(/sendInvitationEmail[\s\S]*deliverLink\(\{ kind: 'invitation'/);
    expect(auth).not.toContain('console.');
  });

  test('development logs the link without a warning', async () => {
    const { stdout, stderr } = await deliver('development');
    expect(stdout).toContain(LINK);
    expect(stdout).toContain('a@b.co');
    expect(stderr).toBe('');
  });

  test('production still logs the link and warns that no mailer is configured', async () => {
    const { stdout, stderr } = await deliver('production');
    expect(stdout).toContain(LINK);
    expect(stderr).toContain('No mailer is configured');
    expect(stderr).toContain('link-delivery.ts');
  });

  test('the generated agent docs say where the links appear and where to plug a mailer', async () => {
    const docs = await readTextFile(join(tempDir, 'mt/docs/agents/auth-rbac.md'));
    expect(docs).toContain('link-delivery.ts');
    expect(docs).toContain('No mailer is configured');
    expect(docs).toContain('server console');
  });
});
