import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { describeWithDocker } from './docker-database';
import { type CommandResult, cleanupTempDir, createTempDir, type RunningServer, runCli, runCommand } from './helpers';
import { buildAndStartWeb, describeFailure, describePaging, describeSearch, SEEDED_ADMIN, signIn } from './org-dashboard';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_SETUP = 240_000;
const TIMEOUT_BUILD = 300_000;
const TIMEOUT_SERVER = 120_000;

const BLUEPRINT = 'org-dashboard-nextjs';

describeWithDocker(`${BLUEPRINT} blueprint e2e`)(`${BLUEPRINT}: local-setup, production build and paged lists`, () => {
  let projectDir: string;
  let setup: CommandResult;
  let server: RunningServer;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const name = 'bp-org-dashboard-next';
    const result = await runCli([name, '--blueprint', BLUEPRINT, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, name);
    const install = await runCommand(['bun', 'install'], projectDir);
    expect(install.exitCode, install.stderr).toBe(0);
    setup = await runCommand(['bun', 'run', 'local-setup'], projectDir);
  }, TIMEOUT_INSTALL + TIMEOUT_SETUP);

  afterAll(async () => {
    await server?.stop();
    if (projectDir) {
      await runCommand(['docker', 'compose', 'down', '--volumes'], projectDir);
      await cleanupTempDir(join(projectDir, '..'));
    }
  });

  test('local-setup starts the database, applies the schema and seeds the demo accounts', () => {
    expect(setup.exitCode, describeFailure(setup)).toBe(0);
    expect(setup.stdout).toContain('Seeding complete.');
  });

  test(
    'a seeded account signs in against the Next.js production server',
    async () => {
      server = await buildAndStartWeb(projectDir);

      const cookie = await signIn(server, SEEDED_ADMIN, '10.3.0.1');
      const session = await fetch(new URL('/api/auth/get-session', server.url), { headers: { cookie } });
      expect(session.status).toBe(200);
      const body = (await session.json()) as { user: { email: string; role: string } } | null;
      expect(body?.user).toMatchObject({ email: SEEDED_ADMIN, role: 'admin' });
    },
    TIMEOUT_BUILD + TIMEOUT_SERVER,
  );

  describePaging({ server: () => server, projectDir: () => projectDir });

  describeSearch({ server: () => server, projectDir: () => projectDir });

  test('the server logs no error while paging', async () => {
    const { stdout, stderr } = await server.stop();
    expect(`${stdout}\n${stderr}`).not.toMatch(/Error|⨯/);
  });
});
