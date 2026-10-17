import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateInstalledProject, startServer } from './helpers';

const HANGING_SERVER = `
import { createServer } from 'node:net';
createServer(() => {}).listen(Number(process.env.PORT), '127.0.0.1');
console.error('hanging-server-marker');
`;

const PLAIN_SERVER = `
import { createServer } from 'node:http';
createServer((_request, response) => {
  console.log('plain-server-served-request');
  response.end('ok');
}).listen(Number(process.env.PORT), '127.0.0.1');
`;

const API_SERVER = `
import { createServer } from 'node:http';
createServer((request, response) => {
  response.statusCode = request.url === '/health' ? 200 : 404;
  response.end();
}).listen(Number(process.env.PORT), '127.0.0.1');
`;

async function isAnswering(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
}

describe('startServer', () => {
  const scratchDirs: string[] = [];

  async function projectWithServer(source: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'create-faster-helpers-'));
    scratchDirs.push(dir);
    await writeFile(join(dir, 'server.mjs'), source);
    return dir;
  }

  afterEach(async () => {
    await Promise.all(scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test('reports the captured output when the server accepts connections but never replies', async () => {
    const dir = await projectWithServer(HANGING_SERVER);

    const failure = await startServer(['node', 'server.mjs'], dir, { readyTimeout: 2_000 }).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('hanging-server-marker');
  }, 15_000);

  test('stop returns what the server printed', async () => {
    const dir = await projectWithServer(PLAIN_SERVER);

    const server = await startServer(['node', 'server.mjs'], dir);
    const { stdout } = await server.stop();

    expect(stdout).toContain('plain-server-served-request');
  }, 15_000);

  test('waits for readyPath when the root path does not answer 2xx', async () => {
    const dir = await projectWithServer(API_SERVER);

    const server = await startServer(['node', 'server.mjs'], dir, { readyPath: '/health', readyTimeout: 5_000 });
    try {
      expect((await fetch(new URL('/health', server.url))).status).toBe(200);
    } finally {
      await server.stop();
    }
  }, 15_000);

  test('stop ends the server that a wrapper command started', async () => {
    const dir = await projectWithServer(PLAIN_SERVER);

    const server = await startServer(['sh', '-c', 'node server.mjs & wait'], dir);
    expect(await isAnswering(server.url)).toBe(true);

    await server.stop();

    expect(await isAnswering(server.url)).toBe(false);
  }, 15_000);
});

describe('generateInstalledProject', () => {
  async function tempDirs(): Promise<string[]> {
    return (await readdir(tmpdir())).filter((entry) => entry.startsWith('create-faster-test-'));
  }

  test('removes its temp dir when the generation fails', async () => {
    const before = await tempDirs();

    await expect(generateInstalledProject('unknown-stack', ['--app', 'unknown-stack:no-such-stack'])).rejects.toThrow();

    expect((await tempDirs()).filter((entry) => !before.includes(entry))).toEqual([]);
  });
});
