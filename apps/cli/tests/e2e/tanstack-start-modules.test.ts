import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  type CommandResult,
  cleanupTempDir,
  createTempDir,
  expectServesPageWithClientScript,
  runCli,
  runCommand,
  type ServerOutput,
  startServer,
} from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_BUILD = 180_000;
const TIMEOUT_START = 60_000;

describe('tanstack-start-loaded', () => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      [
        'tanstack-start-loaded',
        '--app',
        'tanstack-start-loaded:tanstack-start:shadcn,next-themes,react-hook-form,tanstack-query,tanstack-devtools,evlog',
        '--no-git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, 'tanstack-start-loaded');
    installResult = await runCommand(['bun', 'install'], projectDir);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test(
    'installs dependencies',
    () => {
      expect(installResult.exitCode).toBe(0);
    },
    TIMEOUT_INSTALL,
  );

  test(
    'builds',
    async () => {
      const result = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_BUILD,
  );

  test(
    'start serves the built app and its client assets, with evlog logging each request',
    async () => {
      const server = await startServer(['bun', 'run', 'start'], projectDir);
      let output: ServerOutput;
      try {
        await expectServesPageWithClientScript(server.url);
      } finally {
        output = await server.stop();
      }
      expect(output.stdout).toContain('"service":"tanstack-start-loaded"');
    },
    TIMEOUT_START,
  );

  test(
    'start server-renders the next-themes script as the first node of the body',
    async () => {
      const server = await startServer(['bun', 'run', 'start'], projectDir);
      try {
        const html = await (await fetch(server.url)).text();
        expect(html).toContain('<html lang="en"');
        expect(html).toMatch(/<body><script[^>]*>[^<]*"tanstack-start-loaded-theme"/);
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_START,
  );

  test(
    'type-checks',
    async () => {
      const result = await runCommand(['bunx', 'tsc', '--noEmit'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_TYPECHECK,
  );
});

describe('tanstack-start-mdx', () => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      ['tanstack-start-mdx', '--app', 'tanstack-start-mdx:tanstack-start:mdx', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, 'tanstack-start-mdx');
    installResult = await runCommand(['bun', 'install'], projectDir);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test(
    'installs dependencies',
    () => {
      expect(installResult.exitCode).toBe(0);
    },
    TIMEOUT_INSTALL,
  );

  test(
    'builds',
    async () => {
      const result = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_BUILD,
  );

  test(
    'type-checks',
    async () => {
      const result = await runCommand(['bunx', 'tsc', '--noEmit'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_TYPECHECK,
  );

  test(
    'start serves /mdx and a document page with their rendered content, and 404s an unknown document',
    async () => {
      const server = await startServer(['bun', 'run', 'start'], projectDir);
      try {
        const home = await fetch(`${server.url}/mdx`);
        expect(home.status).toBe(200);
        const homeHtml = await home.text();
        expect(homeHtml).toContain('<title>Home</title>');
        expect(homeHtml).toContain('<h1 class="h1-mdx">Home</h1>');
        expect(homeHtml).toContain('href="/mdx/cool"');

        const cool = await fetch(`${server.url}/mdx/cool`);
        expect(cool.status).toBe(200);
        const coolHtml = await cool.text();
        expect(coolHtml).toContain('<title>Cool</title>');
        expect(coolHtml).toContain('<h1 class="h1-mdx">Cool</h1>');
        expect(coolHtml).toContain('<blockquote class="blockquote-mdx">');

        const missing = await fetch(`${server.url}/mdx/does-not-exist`);
        expect(missing.status).toBe(404);
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_START,
  );
});
