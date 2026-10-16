import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { cleanupTempDir, createTempDir, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const REPO_NODE_MODULES = resolve(import.meta.dir, '../../../../node_modules');
const SQL_LEAK = 'SQLITE_ERROR: no such table: users (select * from users where id = 42)';

const APPS = [
  { name: 'hono-plain', args: ['--app', 'hono-plain:hono'] },
  { name: 'hono-evlog', args: ['--app', 'hono-evlog:hono:evlog'] },
  { name: 'hono-cloudflare', args: ['--app', 'hono-cloudflare:hono', '--deployment', 'cloudflare'] },
];

type ErrorBody = { ok: boolean; message: string; stack?: string };

describe.each(APPS)('generated Hono app, $name', ({ name, args }) => {
  let tempDir: string;
  let app: Hono;
  let nodeEnv: string | undefined;
  const originalConsole = { log: console.log, info: console.info, error: console.error };
  let logged: string[] = [];

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);
    await symlink(REPO_NODE_MODULES, join(tempDir, name, 'node_modules'));
    console.log = console.info = console.error = (...args: unknown[]) => {
      logged.push(args.map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : String(arg))).join(' '));
    };
    process.env.NODE_ENV = 'production';
    app = (await import(join(tempDir, name, 'src/app.ts'))).default;
    delete process.env.NODE_ENV;
    app.get('/boom', () => {
      throw new Error(SQL_LEAK);
    });
    app.get('/unauthorized', () => {
      throw new HTTPException(401, { message: 'Missing token' });
    });
  });

  afterAll(async () => {
    Object.assign(console, originalConsole);
    await cleanupTempDir(tempDir);
  });

  beforeEach(() => {
    nodeEnv = process.env.NODE_ENV;
    logged = [];
  });

  afterEach(() => {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  });

  test('an unexpected error in production returns a generic 500 and logs the error with its stack', async () => {
    process.env.NODE_ENV = 'production';
    const res = await app.request('/boom');
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ ok: false, message: 'Internal server error' });
    expect(text).not.toContain('SQLITE_ERROR');
    expect(logged.join('\n')).toContain(SQL_LEAK);
    expect(logged.join('\n')).toContain('hono-app.test.ts');
  });

  test('an unexpected error without NODE_ENV set is masked like production', async () => {
    delete process.env.NODE_ENV;
    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    expect(((await res.json()) as ErrorBody).message).toBe('Internal server error');
  });

  test('an unexpected error in development returns its message', async () => {
    process.env.NODE_ENV = 'development';
    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    expect(((await res.json()) as ErrorBody).message).toBe(SQL_LEAK);
  });

  test('an HTTPException keeps its status and message in production', async () => {
    process.env.NODE_ENV = 'production';
    const res = await app.request('/unauthorized');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, message: 'Missing token' });
  });

  test('a preflight from any origin is allowed', async () => {
    const res = await app.request('/health/1', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type,Authorization');
  });

  test.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])('a preflight for %s allows the method', async (method) => {
    const res = await app.request('/health/1', {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': method },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')?.split(',')).toContain(method);
  });

  test('a cross-origin response carries the allowed origin, error responses included', async () => {
    process.env.NODE_ENV = 'production';
    const ok = await app.request('/health/1', { headers: { Origin: 'https://app.example' } });
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const failed = await app.request('/boom', { headers: { Origin: 'https://app.example' } });
    expect(failed.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
