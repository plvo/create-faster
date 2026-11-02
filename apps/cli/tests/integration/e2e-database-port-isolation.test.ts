import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Glob } from 'bun';
import { isolateDatabasePort } from '../e2e/docker-isolation';
import { cleanupTempDir, createTempDir, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const COMPOSE_PORT = /"(\d+):\d+"/;
const DATABASE_URL_PORT = /^DATABASE_URL="[a-z]+:\/\/[^@]+@localhost:(\d+)\//m;
const HYPERDRIVE_PORT = /"localConnectionString": "[a-z]+:\/\/[^@]+@localhost:(\d+)\//;

async function generate(tempDir: string, name: string, flags: string[]): Promise<string> {
  const result = await runCli([name, ...flags, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
  expect(result.exitCode, result.stderr).toBe(0);
  return join(tempDir, name);
}

const textFiles = (projectDir: string): string[] => [...new Glob('**/*').scanSync({ cwd: projectDir, dot: true, onlyFiles: true })];

async function portsOf(projectDir: string, pattern: RegExp, glob: string): Promise<number[]> {
  const files = [...new Glob(glob).scanSync({ cwd: projectDir, dot: true, onlyFiles: true })];
  const ports = await Promise.all(files.map(async (file) => Number(pattern.exec(await readFile(join(projectDir, file), 'utf8'))?.[1])));
  return ports;
}

async function expectNoFileMentions(projectDir: string, port: string): Promise<void> {
  const bare = new RegExp(`(?<!\\d)${port}(?!\\d)`);
  for (const file of textFiles(projectDir)) {
    const bytes = await readFile(join(projectDir, file));
    if (bytes.includes(0)) continue;
    expect([file, bare.test(bytes.toString('utf8'))]).toEqual([file, false]);
  }
}

describe('isolateDatabasePort on projects the real CLI generates', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('a blueprint: every DATABASE_URL and the compose mapping use the one new port, and the old one is nowhere', async () => {
    const projectDir = await generate(tempDir, 'isolated-blueprint', ['--blueprint', 'org-dashboard-nextjs']);
    const generatedPort = COMPOSE_PORT.exec(await readFile(join(projectDir, 'docker-compose.yml'), 'utf8'))?.[1] as string;

    const port = await isolateDatabasePort(projectDir);

    expect(String(port)).not.toBe(generatedPort);
    expect(COMPOSE_PORT.exec(await readFile(join(projectDir, 'docker-compose.yml'), 'utf8'))?.[1]).toBe(String(port));
    const urlPorts = await portsOf(projectDir, DATABASE_URL_PORT, '**/.env*example');
    expect(urlPorts.length).toBeGreaterThan(0);
    expect(urlPorts.every((urlPort) => urlPort === port)).toBe(true);
    await expectNoFileMentions(projectDir, generatedPort);
  });

  test('Postgres on Cloudflare: the Hyperdrive localConnectionString of wrangler.jsonc follows too', async () => {
    const projectDir = await generate(tempDir, 'isolated-hyperdrive', [
      '--app',
      'web:nextjs',
      '--database',
      'postgres',
      '--orm',
      'drizzle',
      '--deployment',
      'cloudflare',
    ]);
    const generatedPort = COMPOSE_PORT.exec(await readFile(join(projectDir, 'docker-compose.yml'), 'utf8'))?.[1] as string;
    expect(await portsOf(projectDir, HYPERDRIVE_PORT, 'wrangler.jsonc')).toEqual([Number(generatedPort)]);

    const port = await isolateDatabasePort(projectDir);

    expect(await portsOf(projectDir, HYPERDRIVE_PORT, 'wrangler.jsonc')).toEqual([port]);
    const urlPorts = await portsOf(projectDir, DATABASE_URL_PORT, '**/.env*example');
    expect(urlPorts.length).toBeGreaterThan(0);
    expect(urlPorts.every((urlPort) => urlPort === port)).toBe(true);
    await expectNoFileMentions(projectDir, generatedPort);
  });
});
