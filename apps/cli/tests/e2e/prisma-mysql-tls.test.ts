import { afterAll, beforeAll, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type DatabaseContainer, describeWithDocker, removeDatabase, startDatabase } from './docker-database';
import { cleanupTempDir, createTempDir, runCli, runCommand } from './helpers';

const TIMEOUT_INSTALL = 180_000;

const PROBE = `import { prisma } from './src/lib/db';

console.log(\`users:\${await prisma.user.count()}\`);
await prisma.$disconnect();
`;

describeWithDocker('prisma + mysql url settings e2e')('prisma + mysql DATABASE_URL', () => {
  let tempDir: string;
  let projectDir: string;
  let container: DatabaseContainer;

  async function runProbe(query: string): Promise<{ exitCode: number; output: string }> {
    await writeFile(join(projectDir, '.env'), `DATABASE_URL="${container.connectionString}${query}"\n`);
    const result = await runCommand(['bun', 'probe.ts'], projectDir);
    return { exitCode: result.exitCode, output: result.stdout + result.stderr };
  }

  beforeAll(async () => {
    container = await startDatabase('mysql', 'prisma-mysql-tls');
    tempDir = await createTempDir();
    const result = await runCli(
      ['prisma-mysql-tls', '--app', 'api:hono', '--database', 'mysql', '--orm', 'prisma', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    projectDir = join(tempDir, 'prisma-mysql-tls');
    expect((await runCommand(['bun', 'install'], projectDir)).exitCode).toBe(0);
    await writeFile(join(projectDir, '.env'), `DATABASE_URL="${container.connectionString}"\n`);
    await writeFile(join(projectDir, 'probe.ts'), PROBE);
    expect((await runCommand(['bun', 'run', 'db:generate'], projectDir)).exitCode).toBe(0);
    expect((await runCommand(['bun', 'run', 'db:push'], projectDir)).exitCode).toBe(0);
  }, TIMEOUT_INSTALL + 120_000);

  afterAll(async () => {
    if (container) await removeDatabase(container.name);
    if (tempDir) await cleanupTempDir(tempDir);
  });

  test('connects without TLS when the url sets no TLS parameter (local Docker MySQL)', async () => {
    const { exitCode, output } = await runProbe('');
    expect(output).toContain('users:0');
    expect(exitCode).toBe(0);
  });

  // The Docker image serves a self-signed certificate: the driver rejects it only when the url's `ssl=true` reaches it.
  test('negotiates TLS and verifies the server certificate when the url sets ssl=true', async () => {
    const { exitCode, output } = await runProbe('?ssl=true');
    expect(output).toContain('SELF_SIGNED_CERT_IN_CHAIN');
    expect(exitCode).not.toBe(0);
  });
});
