import { afterEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HOST_ID,
  isolatedProjectName,
  isolateDatabasePort,
  isOrphanedOwner,
  MAX_PROJECT_NAME_BASE_LENGTH,
  ownerOfProjectName,
  parseOwner,
} from '../e2e/docker-isolation';

describe('isolatedProjectName', () => {
  test('two calls in one process never give the same name, and each names its owner', () => {
    const names = Array.from({ length: 50 }, () => isolatedProjectName('bp-seed'));

    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name.startsWith('bp-seed-')).toBe(true);
      expect(ownerOfProjectName(name)).toEqual({ host: HOST_ID, pid: process.pid });
    }
  });

  test('a name made by another tool has no owner, even when it ends with digits and hex', () => {
    expect(ownerOfProjectName('bp-org-dashboard-next')).toBeNull();
    expect(ownerOfProjectName('my-e2e-app')).toBeNull();
    expect(ownerOfProjectName('tool-e2e-4242-abc123')).toBeNull();
    expect(ownerOfProjectName(`tool-${HOST_ID}-4242-abc123`)).toBeNull();
  });

  test('a base that would overflow a PostgreSQL identifier is refused', () => {
    expect(() => isolatedProjectName('x'.repeat(MAX_PROJECT_NAME_BASE_LENGTH + 1))).toThrow(/longer than/);
  });

  test('every base an e2e file passes fits, with the longest database prefix and a 7-digit pid', () => {
    const e2eDir = join(import.meta.dir, '../e2e');
    const bases = readdirSync(e2eDir)
      .filter((file) => file.endsWith('.test.ts'))
      .flatMap((file) => [...readFileSync(join(e2eDir, file), 'utf8').matchAll(/generateDockerProject\(\s*'([^']+)'/g)])
      .map((match) => match[1] as string);

    expect(bases.length).toBeGreaterThanOrEqual(5);
    for (const base of bases) {
      const longestName = `${base}-cfe2e-${HOST_ID}-4194304-abcdef`;
      expect([base, `postgres-${longestName}`.length <= 63]).toEqual([base, true]);
    }
  });
});

describe('isOrphanedOwner', () => {
  test('only a finished process of this host is an orphan', async () => {
    const child = Bun.spawn(['true']);
    await child.exited;
    const otherHost = HOST_ID === 'ffff' ? 'eeee' : 'ffff';

    expect(isOrphanedOwner({ host: HOST_ID, pid: child.pid })).toBe(true);
    expect(isOrphanedOwner({ host: HOST_ID, pid: process.pid })).toBe(false);
    expect(isOrphanedOwner({ host: otherHost, pid: child.pid })).toBe(false);
    expect(isOrphanedOwner(null)).toBe(false);
  });

  test('an owner label is a host and a pid, nothing else', () => {
    expect(parseOwner(`${HOST_ID}-42`)).toEqual({ host: HOST_ID, pid: 42 });
    for (const malformed of ['', '42', 'abc', `${HOST_ID}-`, `${HOST_ID}-4x`, 'zzzz-42']) {
      expect(parseOwner(malformed), malformed).toBeNull();
    }
  });
});

describe('isolateDatabasePort', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const write = async (relative: string, content: string): Promise<void> => {
    await mkdir(join(dir as string, relative, '..'), { recursive: true });
    await writeFile(join(dir as string, relative), content);
  };
  const read = (relative: string): Promise<string> => readFile(join(dir as string, relative), 'utf8');

  test('moves the host port of the compose file, every DATABASE_URL and the Hyperdrive binding to one free port', async () => {
    dir = await mkdtemp(join(tmpdir(), 'create-faster-isolation-'));
    await write('docker-compose.yml', 'services:\n  postgres:\n    ports:\n      - "30169:5432"\n');
    const env = (port: number): string => `DATABASE_URL="postgresql://postgres:password@localhost:${port}/postgres-app"\n`;
    await write('apps/web/.env.example', env(30169));
    await write('packages/db/.env.example', env(30169));
    const wrangler = (port: number): string => `{ "localConnectionString": "postgresql://postgres:password@localhost:${port}/postgres-app" }\n`;
    await write('apps/web/wrangler.jsonc', wrangler(30169));

    const port = await isolateDatabasePort(dir);

    expect(await read('docker-compose.yml')).toContain(`"${port}:5432"`);
    expect(await read('apps/web/wrangler.jsonc')).toBe(wrangler(port));
    expect(await read('apps/web/.env.example')).toBe(env(port));
  });

  test('fails, naming the file, when the old port is left in a form it does not rewrite', async () => {
    dir = await mkdtemp(join(tmpdir(), 'create-faster-isolation-'));
    await write('docker-compose.yml', 'ports:\n  - "30169:5432"\n');
    await write('apps/web/settings.txt', 'DATABASE_PORT=30169\n');

    await expect(isolateDatabasePort(dir)).rejects.toThrow(/30169.*apps\/web\/settings\.txt/);
  });
});
