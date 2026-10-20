import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  cleanupTempDir,
  createTempDir,
  fileExists,
  printedScriptsMissingFrom,
  readJsonFile,
  readTextFile,
  runCli,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

interface PackageJson {
  main?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const majorOf = (range: string | undefined): number => Number.parseInt((range ?? '').replace(/^[^\d]*/, ''), 10);

describe('Expo app', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(projectName: string, args: string[], pm = 'bun'): Promise<string> {
    const result = await runCli([projectName, ...args, '--no-git', '--no-install', '--pm', pm], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, projectName);
  }

  describe('without libraries', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('expo-bare', ['--app', 'expo-bare:expo']);
    });

    test('starts its dev server with dev, the only script a single repo needs, and has no start', async () => {
      const pkg = await readJsonFile<PackageJson>(join(projectPath, 'package.json'));
      expect(pkg.scripts?.dev).toBe('expo start');
      expect(pkg.scripts).not.toHaveProperty(['dev:expo']);
      expect(pkg.scripts).not.toHaveProperty(['start']);
    });

    test('uses the expo-router entry as the app entry point', async () => {
      const pkg = await readJsonFile<PackageJson>(join(projectPath, 'package.json'));
      expect(pkg.main).toBe('expo-router/entry');
    });

    test('does not set app config keys that Expo removed', async () => {
      const config = await readTextFile(join(projectPath, 'app.config.ts'));
      expect(config).not.toContain('newArchEnabled');
      expect(config).not.toMatch(/^\s*splash:/m);
    });

    test('declares the peer dependencies expo-router requires', async () => {
      const pkg = await readJsonFile<PackageJson>(join(projectPath, 'package.json'));
      for (const name of [
        'expo-constants',
        'expo-linking',
        'react-native-screens',
        'react-native-web',
        'react-dom',
        'react-native-reanimated',
        'react-native-worklets',
      ]) {
        expect(pkg.dependencies).toHaveProperty([name]);
      }
    });

    test('does not import a stylesheet nor generate a babel config', async () => {
      const layout = await readTextFile(join(projectPath, 'src/app/_layout.tsx'));
      expect(layout).not.toContain('globals.css');
      expect(await fileExists(join(projectPath, 'babel.config.js'))).toBe(false);
    });

    test('types the Expo globals explicitly', async () => {
      const tsconfig = await readTextFile(join(projectPath, 'tsconfig.json'));
      expect(tsconfig).toContain('"expo/types"');
      expect(tsconfig).not.toContain('"jest"');
    });
  });

  describe('with nativewind', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('expo-nativewind', ['--app', 'expo-nativewind:expo:nativewind']);
    });

    test('writes the stylesheet where the root layout and the metro config read it', async () => {
      const layout = await readTextFile(join(projectPath, 'src/app/_layout.tsx'));
      const metro = await readTextFile(join(projectPath, 'metro.config.js'));
      expect(layout).toContain("import '@/styles/globals.css'");
      expect(metro).toContain("input: './src/styles/globals.css'");
      expect(await fileExists(join(projectPath, 'src/styles/globals.css'))).toBe(true);
    });

    test('compiles className through the nativewind babel setup', async () => {
      const babel = await readTextFile(join(projectPath, 'babel.config.js'));
      expect(babel).toContain("jsxImportSource: 'nativewind'");
      expect(babel).toContain("'nativewind/babel'");
    });

    test('sets the dark mode to class, which react-native-css-interop needs to set the color scheme on web', async () => {
      const config = await readTextFile(join(projectPath, 'tailwind.config.js'));
      expect(config).toContain("darkMode: 'class'");
    });

    test('declares every package its babel and runtime setup resolves from the app root', async () => {
      const pkg = await readJsonFile<PackageJson>(join(projectPath, 'package.json'));
      expect(pkg.dependencies).toHaveProperty(['react-native-css-interop']);
      expect(pkg.devDependencies).toHaveProperty(['babel-preset-expo']);
      expect(pkg.devDependencies).toHaveProperty(['@babel/plugin-transform-react-jsx']);
    });
  });

  describe('with jest-expo', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('expo-jest', ['--app', 'expo-jest:expo:jest-expo']);
    });

    test('awaits the asynchronous render of Testing Library', async () => {
      const test = await readTextFile(join(projectPath, 'tests/unit/example.test.tsx'));
      expect(test).toContain('await render(');
    });

    test('declares the packages jest-expo and Testing Library require', async () => {
      const pkg = await readJsonFile<PackageJson>(join(projectPath, 'package.json'));
      expect(pkg.devDependencies).toHaveProperty(['@react-native/jest-preset']);
      expect(pkg.devDependencies).toHaveProperty(['@babel/runtime']);
      expect(pkg.devDependencies).toHaveProperty(['test-renderer']);
      expect(pkg.devDependencies).not.toHaveProperty(['react-test-renderer']);
    });

    test('types the jest globals', async () => {
      const tsconfig = await readTextFile(join(projectPath, 'tsconfig.json'));
      expect(tsconfig).toContain('"jest"');
    });

    test('does not generate a babel config', async () => {
      expect(await fileExists(join(projectPath, 'babel.config.js'))).toBe(false);
    });

    test('lets the bun store through the transform ignore list, since jest-expo only knows the pnpm one', async () => {
      const jestConfig = await readTextFile(join(projectPath, 'jest.config.js'));
      expect(jestConfig).toContain('.bun|');
    });

    test('keeps the bare jest-expo preset with pnpm', async () => {
      const pnpmPath = await generate('expo-jest-pnpm', ['--app', 'expo-jest-pnpm:expo:jest-expo'], 'pnpm');
      const jestConfig = await readTextFile(join(pnpmPath, 'jest.config.js'));
      expect(jestConfig).not.toContain('transformIgnorePatterns');
    });
  });

  describe('next to a Next.js app in a turborepo', () => {
    const MOBILE_START = '(cd apps/mobile && bun run dev:expo)';
    let projectPath: string;
    let summary: string;

    beforeAll(async () => {
      const result = await runCli(
        [
          'expo-next-turbo',
          '--app',
          'mobile:expo:nativewind,jest-expo',
          '--app',
          'web:nextjs',
          '--no-git',
          '--no-install',
          '--pm',
          'bun',
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
      summary = result.stdout;
      projectPath = join(tempDir, 'expo-next-turbo');
    });

    test('leaves the Expo app out of the root dev and start, which turbo runs without a terminal', async () => {
      const root = await readJsonFile<PackageJson>(join(projectPath, 'package.json'));
      const mobile = await readJsonFile<PackageJson>(join(projectPath, 'apps/mobile/package.json'));
      const web = await readJsonFile<PackageJson>(join(projectPath, 'apps/web/package.json'));

      expect(root.scripts?.dev).toBe('turbo dev');
      expect(root.scripts?.start).toBe('turbo start');
      expect(mobile.scripts).not.toHaveProperty(['dev']);
      expect(mobile.scripts).not.toHaveProperty(['start']);
      expect(mobile.scripts?.['dev:expo']).toBe('expo start');
      expect(web.scripts).toHaveProperty(['dev']);
      expect(web.scripts).toHaveProperty(['start']);
    });

    test('prints the command that starts the Expo app from the root, in the summary, the README and AGENTS.md', async () => {
      const readme = await readTextFile(join(projectPath, 'README.md'));
      const agents = await readTextFile(join(projectPath, 'AGENTS.md'));

      for (const text of [summary, readme, agents]) {
        expect(text).toContain(MOBILE_START);
        expect(await printedScriptsMissingFrom(projectPath, text)).toEqual([]);
      }
      expect(readme).toContain('the root `dev` does not start');
    });

    test('tells the Expo app how to start, switch to Expo Go, and what NativeWind, jest-expo and expo-doctor do', async () => {
      const agents = await readTextFile(join(projectPath, 'apps/mobile/AGENTS.md'));

      expect(agents).toContain('(cd apps/mobile && bun run dev:expo)');
      expect(agents).toContain('(cd apps/mobile && bun run dev:expo --go)');
      expect(agents).toContain('(cd apps/mobile && bun run dev:expo --clear)');
      expect(agents).toContain('(cd apps/mobile && bun run test)');
      expect(agents).toContain('(cd apps/mobile && bun run test:watch)');
      expect(agents).toContain("darkMode: 'class'");
      for (const duplicate of ['expo-doctor', 'expo-constants', 'expo-font', 'expo-linking']) {
        expect(agents).toContain(duplicate);
      }
    });

    test('a turborepo of Expo apps only has no root dev, no dev task, and starts each app from its directory', async () => {
      const onlyExpo = await generate('expo-only-turbo', ['--app', 'a:expo', '--app', 'b:expo']);
      const root = await readJsonFile<PackageJson>(join(onlyExpo, 'package.json'));
      const turbo = await readTextFile(join(onlyExpo, 'turbo.json'));
      const readme = await readTextFile(join(onlyExpo, 'README.md'));

      expect(root.scripts).not.toHaveProperty(['dev']);
      expect(turbo).not.toContain('"dev"');
      expect(readme).not.toContain('bun run dev\n');
      for (const text of [readme, await readTextFile(join(onlyExpo, 'AGENTS.md'))]) {
        expect(text).toContain('(cd apps/a && bun run dev:expo)');
        expect(text).toContain('(cd apps/b && bun run dev:expo)');
        expect(await printedScriptsMissingFrom(onlyExpo, text)).toEqual([]);
      }
    });

    test('does not tell a project that installs no duplicates to expect them', async () => {
      const npmPath = await generate('expo-next-turbo-npm', ['--app', 'mobile:expo', '--app', 'web:nextjs'], 'npm');
      const agents = await readTextFile(join(npmPath, 'apps/mobile/AGENTS.md'));
      expect(agents).not.toContain('expo-doctor');
    });
  });

  describe('next to a React 19 app in a turborepo', () => {
    test('shares the React and React types major with the web app', async () => {
      const projectPath = await generate('expo-turbo', [
        '--app',
        'web:tanstack-start',
        '--app',
        'mobile:expo',
      ]);
      const web = await readJsonFile<PackageJson>(join(projectPath, 'apps/web/package.json'));
      const mobile = await readJsonFile<PackageJson>(join(projectPath, 'apps/mobile/package.json'));
      expect(majorOf(mobile.dependencies?.react)).toBe(majorOf(web.dependencies?.react));
      expect(majorOf(mobile.devDependencies?.['@types/react'])).toBe(majorOf(web.devDependencies?.['@types/react']));
    });
  });
});
