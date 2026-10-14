import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type DatabaseContainer, describeWithDocker, removeDatabase, startDatabase } from './docker-database';
import { cleanupTempDir, createTempDir, runCli, runCommand } from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TLS_WARNING = '[db] DATABASE_URL disables TLS for';
// The Docker image serves a self-signed certificate: mysql2 reports it as a handshake error, the MariaDB connector by name.
const TLS_REJECTION = /SELF_SIGNED_CERT_IN_CHAIN|HANDSHAKE_SSL_ERROR|self.signed certificate/;

const PROBES = {
  drizzle: `import { db, userTable } from './src/lib/db';

const rows = await db.select().from(userTable);
console.log(\`users:\${rows.length}\`);
process.exit(0);
`,
  prisma: `import { prisma } from './src/lib/db';

console.log(\`users:\${await prisma.user.count()}\`);
await prisma.$disconnect();
`,
};

const FIRST_RUN_SCRIPTS = {
  drizzle: ['db:generate', 'db:migrate'],
  prisma: ['db:generate', 'db:push'],
};

async function runProbe(
  projectDir: string,
  nodeEnv: 'development' | 'production',
  databaseUrl: string,
): Promise<{ exitCode: number; output: string }> {
  const child = Bun.spawn(['bun', 'probe.ts'], {
    cwd: projectDir,
    env: { ...process.env, NODE_ENV: nodeEnv, DATABASE_URL: databaseUrl },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, output: stdout + stderr };
}

describeWithDocker('mysql production e2e')('mysql DATABASE_URL in production', () => {
  describe.each(['drizzle', 'prisma'] as const)('%s', (orm) => {
    let tempDir: string;
    let container: DatabaseContainer;
    let projectDir: string;
    let localUrl: string;
    let urlWithoutTlsSetting: string;

    beforeAll(async () => {
      const name = `mysql-production-${orm}`;
      container = await startDatabase('mysql', name);
      tempDir = await createTempDir();
      const result = await runCli(
        [name, '--app', 'api:hono', '--database', 'mysql', '--orm', orm, '--no-git', '--no-install', '--pm', 'bun'],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
      projectDir = join(tempDir, name);

      const generated = (await readFile(join(projectDir, '.env.example'), 'utf8')).match(/^DATABASE_URL="([^"]+)"/m);
      expect(generated).not.toBeNull();
      localUrl = `${container.connectionString}${new URL(generated?.[1] ?? '').search}`;
      urlWithoutTlsSetting = container.connectionString;

      expect((await runCommand(['bun', 'install'], projectDir)).exitCode).toBe(0);
      await writeFile(join(projectDir, '.env'), `DATABASE_URL="${localUrl}"\n`);
      await writeFile(join(projectDir, 'probe.ts'), PROBES[orm]);
      for (const script of FIRST_RUN_SCRIPTS[orm]) {
        const run = await runCommand(['bun', 'run', script], projectDir);
        expect(run.exitCode, run.stdout + run.stderr).toBe(0);
      }
    }, TIMEOUT_INSTALL + 120_000);

    afterAll(async () => {
      if (container) await removeDatabase(container.name);
      if (tempDir) await cleanupTempDir(tempDir);
    });

    test('the generated local URL connects without TLS in development and in production', async () => {
      for (const nodeEnv of ['development', 'production'] as const) {
        const { exitCode, output } = await runProbe(projectDir, nodeEnv, localUrl);
        expect(output, nodeEnv).toContain('users:0');
        expect(output, nodeEnv).not.toContain(TLS_WARNING);
        expect(exitCode, nodeEnv).toBe(0);
      }
    });

    test('a URL without ssl connects without TLS in development', async () => {
      const { exitCode, output } = await runProbe(projectDir, 'development', urlWithoutTlsSetting);
      expect(output).toContain('users:0');
      expect(exitCode).toBe(0);
    });

    test('a URL without ssl negotiates TLS and verifies the certificate in production', async () => {
      const { exitCode, output } = await runProbe(projectDir, 'production', urlWithoutTlsSetting);
      expect(output).toMatch(TLS_REJECTION);
      expect(exitCode).not.toBe(0);
    });

    test('ssl=false toward a remote host logs a warning in production', async () => {
      const remote = localUrl.replace('127.0.0.1', 'db.invalid');
      const { output } = await runProbe(projectDir, 'production', remote);
      expect(output).toContain(`${TLS_WARNING} db.invalid in production`);
    });
  });
});
