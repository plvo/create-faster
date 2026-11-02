import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedProjectName, isolateDatabasePort, isOrphanedOwner, ownerOfProjectName } from '../e2e/docker-isolation';

describe('isolatedProjectName', () => {
  test('two calls in one process never give the same name, and each names its owner', () => {
    const names = Array.from({ length: 50 }, () => isolatedProjectName('bp-seed'));

    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name.startsWith('bp-seed-')).toBe(true);
      expect(ownerOfProjectName(name)).toBe(process.pid);
    }
  });

  test('fits the project name rule and the 63 characters of a PostgreSQL database name once prefixed', () => {
    const name = isolatedProjectName('bp-org-dashboard-next');

    expect(name).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
    expect(`postgres-${name}`.length).toBeLessThanOrEqual(63);
  });

  test('a name that is not an isolated one has no owner', () => {
    expect(ownerOfProjectName('bp-org-dashboard-next')).toBeNull();
    expect(ownerOfProjectName('my-e2e-app')).toBeNull();
  });
});

describe('isOrphanedOwner', () => {
  test('a running process is not orphaned, a process that exited is, a missing owner never is', async () => {
    const child = Bun.spawn(['true']);
    await child.exited;

    expect(isOrphanedOwner(process.pid)).toBe(false);
    expect(isOrphanedOwner(child.pid)).toBe(true);
    expect(isOrphanedOwner(null)).toBe(false);
  });
});

describe('isolateDatabasePort', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test('moves the host port of the compose file and every DATABASE_URL to one free port', async () => {
    dir = await mkdtemp(join(tmpdir(), 'create-faster-isolation-'));
    await mkdir(join(dir, 'apps/web'), { recursive: true });
    await mkdir(join(dir, 'packages/db'), { recursive: true });
    await writeFile(join(dir, 'docker-compose.yml'), 'services:\n  postgres:\n    ports:\n      - "30169:5432"\n');
    const env = (port: number): string => `DATABASE_URL="postgresql://postgres:password@localhost:${port}/postgres-app"\nOTHER=30169\n`;
    await writeFile(join(dir, 'apps/web/.env.example'), env(30169));
    await writeFile(join(dir, 'packages/db/.env.example'), env(30169));

    const port = await isolateDatabasePort(dir);

    expect(await readFile(join(dir, 'docker-compose.yml'), 'utf8')).toContain(`"${port}:5432"`);
    expect(await readFile(join(dir, 'apps/web/.env.example'), 'utf8')).toBe(env(port));
    expect(await readFile(join(dir, 'packages/db/.env.example'), 'utf8')).toBe(env(port));
  });
});
