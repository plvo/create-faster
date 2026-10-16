import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

// The official images start a temporary server on a unix socket only (no TCP) to run the init scripts,
// then restart it. A probe through the socket passes on that server, so `docker compose up --wait`
// returns before the database accepts connections on the published port.
const HEALTHCHECKS = [
  {
    database: 'postgres',
    probe: 'pg_isready -h 127.0.0.1 -U postgres -d postgres-{name}',
  },
  {
    database: 'mysql',
    probe: '"mysqladmin", "ping", "-h", "127.0.0.1", "-u", "root", "-ppassword"',
  },
];

let tempDir: string;

beforeAll(async () => {
  tempDir = await createTempDir();
});

afterAll(async () => {
  await cleanupTempDir(tempDir);
});

describe.each(HEALTHCHECKS)('$database compose healthcheck', ({ database, probe }) => {
  test('probes over TCP so --wait means the published port accepts connections', async () => {
    const name = `healthcheck-${database}`;
    const result = await runCli([name, '--app', `${name}:hono`, '--database', database, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    const compose = await readTextFile(join(tempDir, name, 'docker-compose.yml'));
    expect(compose).toContain(probe.replace('{name}', name));
  });
});
