import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

interface PackageJson {
  main?: string;
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

  async function generate(projectName: string, args: string[]): Promise<string> {
    const result = await runCli([projectName, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, projectName);
  }

  describe('without libraries', () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('expo-bare', ['--app', 'expo-bare:expo']);
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
      for (const name of ['expo-constants', 'expo-linking', 'react-native-screens', 'react-native-web', 'react-dom']) {
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

    test('declares every package its babel and runtime setup resolves from the app root', async () => {
      const pkg = await readJsonFile<PackageJson>(join(projectPath, 'package.json'));
      expect(pkg.dependencies).toHaveProperty(['react-native-reanimated']);
      expect(pkg.dependencies).toHaveProperty(['react-native-worklets']);
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
