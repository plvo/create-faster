import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { filesUnder } from '../integration/helpers';
import {
  type CommandResult,
  cleanupTempDir,
  createTempDir,
  getFreePort,
  PNPM_AVAILABLE,
  runCli,
  runCommand,
  startServer,
} from './helpers';

const TIMEOUT_INSTALL = 240_000;
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_TEST = 120_000;
const TIMEOUT_BUNDLE = 300_000;
const TIMEOUT_DOCTOR = 300_000;
const TIMEOUT_DEV_SERVER = 240_000;

const CLASS_NAME = /className='([^']*)'/g;
const DOCUMENTED_DUPLICATES = ['expo-constants', 'expo-font', 'expo-linking'];

if (!PNPM_AVAILABLE) {
  console.warn('Skipping pnpm Expo turborepo e2e: pnpm is not installed');
}

const PACKAGE_MANAGERS = [
  { pm: 'bun', exec: ['bunx'], available: true },
  { pm: 'pnpm', exec: ['pnpm', 'exec'], available: PNPM_AVAILABLE },
];

for (const { pm, exec, available } of PACKAGE_MANAGERS) {
  describe.skipIf(!available)(`expo next to a React 19 app in a turborepo (${pm})`, () => {
    const name = `expo-turbo-${pm}`;
    let projectDir: string;
    let mobileDir: string;
    let installResult: CommandResult;

    beforeAll(async () => {
      const tempDir = await createTempDir();
      const result = await runCli(
        [
          name,
          '--app',
          'web:tanstack-start:mdx,next-themes,shadcn',
          '--app',
          'mobile:expo:nativewind,jest-expo',
          '--no-git',
          '--no-install',
          '--pm',
          pm,
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(0);

      projectDir = join(tempDir, name);
      mobileDir = join(projectDir, 'apps/mobile');
      installResult = await runCommand([pm, 'install'], projectDir);
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
      'type-checks the mobile app',
      async () => {
        const result = await runCommand([...exec, 'tsc', '--noEmit'], mobileDir);
        expect(result.exitCode).toBe(0);
      },
      TIMEOUT_TYPECHECK,
    );

    test(
      'runs jest',
      async () => {
        const result = await runCommand([pm, 'run', 'test'], mobileDir);
        expect(result.exitCode).toBe(0);
      },
      TIMEOUT_TEST,
    );

    test(
      'defines every class the screens use in the Tailwind config',
      async () => {
        const stylesheet = join(projectDir, 'nativewind.css');
        const build = await runCommand(
          [...exec, 'tailwindcss', '-i', 'src/styles/globals.css', '-o', stylesheet],
          mobileDir,
        );
        expect(build.exitCode).toBe(0);

        const css = await readFile(stylesheet, 'utf8');
        const sources = (await filesUnder(join(mobileDir, 'src'))).filter((file) => file.endsWith('.tsx'));
        const classes = (await Promise.all(sources.map((file) => readFile(file, 'utf8'))))
          .flatMap((source) => [...source.matchAll(CLASS_NAME)])
          .flatMap(([, value]) => (value ?? '').split(/\s+/).filter(Boolean));

        expect(classes.length).toBeGreaterThan(0);
        const undefinedClasses = classes.filter((name) => !css.includes(`.${name.replace(/[^\w-]/g, '\\$&')}`));
        expect(undefinedClasses).toEqual([]);
      },
      TIMEOUT_TEST,
    );

    test(
      'serves the web dev bundle with NativeWind in class dark mode, which its color scheme API needs',
      async () => {
        const port = await getFreePort();
        const server = await startServer([...exec, 'expo', 'start', '--web', '--port', String(port)], mobileDir, {
          port,
          readyTimeout: TIMEOUT_DEV_SERVER,
        });
        try {
          const page = await (await fetch(server.url)).text();
          const entry = page.match(/src="([^"]*entry\.bundle[^"]*)"/)?.[1] ?? '';
          expect(entry).toContain('entry.bundle');

          const bundle = await fetch(new URL(entry.replaceAll('&amp;', '&'), server.url));
          expect(bundle.status).toBe(200);
          const code = await bundle.text();
          expect(code).toContain('darkMode: class');
          expect(code).not.toContain('darkMode: media');
        } finally {
          await server.stop();
        }
      },
      TIMEOUT_DEV_SERVER + 60_000,
    );

    test.skipIf(pm !== 'bun')(
      'expo-doctor reports only the duplicate native modules the mobile AGENTS.md documents',
      async () => {
        const result = await runCommand([...exec, 'expo-doctor'], mobileDir);
        const output = `${result.stdout}\n${result.stderr}`;

        expect(output).toContain('1 check failed');
        expect(output).toContain('Check that no duplicate dependencies are installed');
        const duplicates = [...output.matchAll(/Found duplicates for (\S+):/g)].map(([, name]) => name);
        expect(duplicates).toEqual(DOCUMENTED_DUPLICATES);

        const agents = await readFile(join(mobileDir, 'AGENTS.md'), 'utf8');
        for (const name of DOCUMENTED_DUPLICATES) expect(agents).toContain(name);
      },
      TIMEOUT_DOCTOR,
    );

    test(
      'bundles the mobile app with Metro',
      async () => {
        const result = await runCommand([...exec, 'expo', 'export', '--platform', 'ios'], mobileDir);
        expect(result.exitCode).toBe(0);
      },
      TIMEOUT_BUNDLE,
    );
  });
}
