import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, readTextFile, runCli } from './helpers';

describe('CLI Integration', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Single repo generation', () => {
    test('generates basic Next.js project', async () => {
      const projectName = 'test-nextjs-single';
      const projectPath = join(tempDir, projectName);

      const result = await runCli([projectName, '--app', `${projectName}:nextjs`, '--no-git', '--no-install'], tempDir);

      expect(result.exitCode).toBe(0);
      expect(await fileExists(join(projectPath, 'package.json'))).toBe(true);
      expect(await fileExists(join(projectPath, 'src/app/page.tsx'))).toBe(true);

      const pkg = await readJsonFile<{
        name: string;
        dependencies: Record<string, string>;
      }>(join(projectPath, 'package.json'));
      expect(pkg.name).toBe(projectName);
      expect(pkg.dependencies.next).toBeDefined();
      expect(pkg.dependencies.react).toBeDefined();
    });

    test('generates Next.js with shadcn addon', async () => {
      const projectName = 'test-nextjs-shadcn';
      const projectPath = join(tempDir, projectName);

      const result = await runCli(
        [projectName, '--app', `${projectName}:nextjs:shadcn`, '--no-git', '--no-install'],
        tempDir,
      );

      expect(result.exitCode).toBe(0);

      const pkg = await readJsonFile<{
        dependencies: Record<string, string>;
      }>(join(projectPath, 'package.json'));
      expect(pkg.dependencies['radix-ui']).toBeDefined();
      expect(pkg.dependencies['class-variance-authority']).toBeDefined();

      expect(await fileExists(join(projectPath, 'src/components/ui/button.tsx'))).toBe(true);
      expect(await fileExists(join(projectPath, 'components.json'))).toBe(true);
    });

    test('generates Next.js with drizzle orm', async () => {
      const projectName = 'test-nextjs-drizzle';
      const projectPath = join(tempDir, projectName);

      const result = await runCli(
        [
          projectName,
          '--app',
          `${projectName}:nextjs`,
          '--database',
          'postgres',
          '--orm',
          'drizzle',
          '--no-git',
          '--no-install',
        ],
        tempDir,
      );

      expect(result.exitCode).toBe(0);

      const pkg = await readJsonFile<{
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
        scripts: Record<string, string>;
      }>(join(projectPath, 'package.json'));
      expect(pkg.dependencies['drizzle-orm']).toBeDefined();
      expect(pkg.dependencies.pg).toBeDefined();
      expect(pkg.scripts['db:generate']).toBeDefined();

      expect(await fileExists(join(projectPath, 'src/lib/db/schema.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'drizzle.config.ts'))).toBe(true);
      expect(await fileExists(join(projectPath, 'scripts/seed.ts'))).toBe(true);
    });
  });

  describe('Turborepo generation', () => {
    test('generates multi-app turborepo', async () => {
      const projectName = 'test-turborepo';
      const projectPath = join(tempDir, projectName);

      const result = await runCli(
        [projectName, '--app', 'web:nextjs', '--app', 'api:hono', '--no-git', '--no-install'],
        tempDir,
      );

      expect(result.exitCode).toBe(0);

      expect(await fileExists(join(projectPath, 'package.json'))).toBe(true);
      expect(await fileExists(join(projectPath, 'turbo.json'))).toBe(true);

      expect(await fileExists(join(projectPath, 'apps/web/package.json'))).toBe(true);
      expect(await fileExists(join(projectPath, 'apps/api/package.json'))).toBe(true);

      const webPkg = await readJsonFile<{
        name: string;
        dependencies: Record<string, string>;
      }>(join(projectPath, 'apps/web/package.json'));
      expect(webPkg.name).toBe('web');
      expect(webPkg.dependencies.next).toBeDefined();

      const apiPkg = await readJsonFile<{
        name: string;
        dependencies: Record<string, string>;
      }>(join(projectPath, 'apps/api/package.json'));
      expect(apiPkg.name).toBe('api');
      expect(apiPkg.dependencies.hono).toBeDefined();
    });

    test('generates turborepo with extracted packages', async () => {
      const projectName = 'test-turborepo-packages';
      const projectPath = join(tempDir, projectName);

      const result = await runCli(
        [
          projectName,
          '--app',
          'web:nextjs:shadcn',
          '--app',
          'mobile:expo',
          '--database',
          'postgres',
          '--orm',
          'drizzle',
          '--no-git',
          '--no-install',
        ],
        tempDir,
      );

      expect(result.exitCode).toBe(0);

      expect(await fileExists(join(projectPath, 'packages/ui/package.json'))).toBe(true);
      expect(await fileExists(join(projectPath, 'packages/db/package.json'))).toBe(true);

      const webPkg = await readJsonFile<{
        dependencies: Record<string, string>;
      }>(join(projectPath, 'apps/web/package.json'));
      expect(webPkg.dependencies['@repo/ui']).toBe('*');
      expect(webPkg.dependencies['@repo/db']).toBe('*');

      const uiPkg = await readJsonFile<{
        name: string;
        dependencies: Record<string, string>;
      }>(join(projectPath, 'packages/ui/package.json'));
      expect(uiPkg.name).toBe('@repo/ui');
      expect(uiPkg.dependencies['radix-ui']).toBeDefined();

      const dbPkg = await readJsonFile<{
        name: string;
        dependencies: Record<string, string>;
      }>(join(projectPath, 'packages/db/package.json'));
      expect(dbPkg.name).toBe('@repo/db');
      expect(dbPkg.dependencies['drizzle-orm']).toBeDefined();
      expect(dbPkg.dependencies.pg).toBeDefined();
    });
  });

  describe('ESLint linter', () => {
    test('generates ESLint config for single repo', async () => {
      const projectName = 'test-eslint-single';
      const projectPath = join(tempDir, projectName);

      const result = await runCli(
        [projectName, '--app', `${projectName}:nextjs`, '--linter', 'eslint', '--no-git', '--no-install'],
        tempDir,
      );

      expect(result.exitCode).toBe(0);

      expect(await fileExists(join(projectPath, 'eslint.config.mjs'))).toBe(true);
      expect(await fileExists(join(projectPath, 'packages'))).toBe(false);

      const config = await readTextFile(join(projectPath, 'eslint.config.mjs'));
      expect(config).toContain('defineConfig');
      expect(config).toContain('pluginNext');
      expect(config).not.toContain('@repo/eslint-config');

      const pkg = await readJsonFile<{
        devDependencies: Record<string, string>;
        scripts: Record<string, string>;
      }>(join(projectPath, 'package.json'));
      expect(pkg.devDependencies.eslint).toBeDefined();
      expect(pkg.devDependencies['@eslint/js']).toBeDefined();
      expect(pkg.devDependencies['typescript-eslint']).toBeDefined();
      expect(pkg.devDependencies['eslint-plugin-react']).toBeDefined();
      expect(pkg.devDependencies['@next/eslint-plugin-next']).toBeDefined();
      expect(pkg.scripts.lint).toBe('eslint .');
    });

    test('generates ESLint shared config for turborepo', async () => {
      const projectName = 'test-eslint-turbo';
      const projectPath = join(tempDir, projectName);

      const result = await runCli(
        [projectName, '--app', 'web:nextjs', '--app', 'api:hono', '--linter', 'eslint', '--no-git', '--no-install'],
        tempDir,
      );

      expect(result.exitCode).toBe(0);

      // Shared eslint-config package
      expect(await fileExists(join(projectPath, 'packages/eslint-config/package.json'))).toBe(true);
      expect(await fileExists(join(projectPath, 'packages/eslint-config/base.js'))).toBe(true);
      expect(await fileExists(join(projectPath, 'packages/eslint-config/next.js'))).toBe(true);
      expect(await fileExists(join(projectPath, 'packages/eslint-config/server.js'))).toBe(true);
      expect(await fileExists(join(projectPath, 'packages/eslint-config/react.js'))).toBe(true);
      expect(await fileExists(join(projectPath, 'packages/eslint-config/react-native.js'))).toBe(true);

      const eslintPkg = await readJsonFile<{
        name: string;
        exports: Record<string, string>;
        devDependencies: Record<string, string>;
      }>(join(projectPath, 'packages/eslint-config/package.json'));
      expect(eslintPkg.name).toBe('@repo/eslint-config');
      expect(eslintPkg.exports['./base']).toBe('./base.js');
      expect(eslintPkg.exports['./next']).toBe('./next.js');
      expect(eslintPkg.devDependencies.eslint).toBeDefined();

      // Per-app thin configs
      const webConfig = await readTextFile(join(projectPath, 'apps/web/eslint.config.mjs'));
      expect(webConfig).toContain('nextConfig');
      expect(webConfig).toContain('@repo/eslint-config/next');

      const apiConfig = await readTextFile(join(projectPath, 'apps/api/eslint.config.mjs'));
      expect(apiConfig).toContain('serverConfig');
      expect(apiConfig).toContain('@repo/eslint-config/server');

      // App package.jsons reference shared config
      const webPkg = await readJsonFile<{
        devDependencies: Record<string, string>;
        scripts: Record<string, string>;
      }>(join(projectPath, 'apps/web/package.json'));
      expect(webPkg.devDependencies['@repo/eslint-config']).toBe('*');
      expect(webPkg.scripts.lint).toBe('eslint .');

      // Root does NOT have eslint deps
      const rootPkg = await readJsonFile<{
        devDependencies: Record<string, string>;
      }>(join(projectPath, 'package.json'));
      expect(rootPkg.devDependencies.eslint).toBeUndefined();
    });

    test('generates correct ESLint config per stack in turborepo', async () => {
      const projectName = 'test-eslint-stacks';
      const projectPath = join(tempDir, projectName);

      const result = await runCli(
        [
          projectName,
          '--app',
          'web:nextjs',
          '--app',
          'mobile:expo',
          '--app',
          'api:hono',
          '--app',
          'start:tanstack-start',
          '--linter',
          'eslint',
          '--no-git',
          '--no-install',
        ],
        tempDir,
      );

      expect(result.exitCode).toBe(0);

      const webConfig = await readTextFile(join(projectPath, 'apps/web/eslint.config.mjs'));
      expect(webConfig).toContain('nextConfig');

      const mobileConfig = await readTextFile(join(projectPath, 'apps/mobile/eslint.config.mjs'));
      expect(mobileConfig).toContain('reactNativeConfig');

      const apiConfig = await readTextFile(join(projectPath, 'apps/api/eslint.config.mjs'));
      expect(apiConfig).toContain('serverConfig');

      const startConfig = await readTextFile(join(projectPath, 'apps/start/eslint.config.mjs'));
      expect(startConfig).toContain('reactConfig');
    });
  });

  describe('Prettier', () => {
    test('generates Prettier config for single repo', async () => {
      const projectName = 'test-prettier-single';
      const projectPath = join(tempDir, projectName);

      const result = await runCli(
        [projectName, '--app', `${projectName}:nextjs`, '--linter', 'prettier', '--no-git', '--no-install'],
        tempDir,
      );

      expect(result.exitCode).toBe(0);

      expect(await fileExists(join(projectPath, '.prettierrc'))).toBe(true);
      expect(await fileExists(join(projectPath, '.prettierignore'))).toBe(true);

      const prettierrc = await readTextFile(join(projectPath, '.prettierrc'));
      expect(prettierrc).toContain('prettier-plugin-tailwindcss');
      expect(prettierrc).toContain('"singleQuote": true');

      const pkg = await readJsonFile<{
        devDependencies: Record<string, string>;
        scripts: Record<string, string>;
      }>(join(projectPath, 'package.json'));
      expect(pkg.devDependencies.prettier).toBeDefined();
      expect(pkg.devDependencies['prettier-plugin-tailwindcss']).toBeDefined();
      expect(pkg.scripts.format).toContain('prettier');
      expect(pkg.scripts['format:check']).toContain('prettier');

      // No ESLint files should exist
      expect(await fileExists(join(projectPath, 'eslint.config.mjs'))).toBe(false);
    });

    test('generates Prettier config for turborepo', async () => {
      const projectName = 'test-prettier-turbo';
      const projectPath = join(tempDir, projectName);

      const result = await runCli(
        [projectName, '--app', 'web:nextjs', '--app', 'api:hono', '--linter', 'prettier', '--no-git', '--no-install'],
        tempDir,
      );

      expect(result.exitCode).toBe(0);

      // Prettier configs at root
      expect(await fileExists(join(projectPath, '.prettierrc'))).toBe(true);
      expect(await fileExists(join(projectPath, '.prettierignore'))).toBe(true);

      // Root package.json has prettier deps and scripts
      const rootPkg = await readJsonFile<{
        devDependencies: Record<string, string>;
        scripts: Record<string, string>;
      }>(join(projectPath, 'package.json'));
      expect(rootPkg.devDependencies.prettier).toBeDefined();
      expect(rootPkg.devDependencies['prettier-plugin-tailwindcss']).toBeDefined();
      expect(rootPkg.scripts.format).toContain('prettier');

      // No eslint-config package should exist
      expect(await fileExists(join(projectPath, 'packages/eslint-config'))).toBe(false);
    });
  });

  describe('ESLint + Prettier', () => {
    test('generates combined config for single repo', async () => {
      const projectName = 'test-eslint-prettier-single';
      const projectPath = join(tempDir, projectName);

      const result = await runCli(
        [projectName, '--app', `${projectName}:nextjs`, '--linter', 'eslint-prettier', '--no-git', '--no-install'],
        tempDir,
      );

      expect(result.exitCode).toBe(0);

      // ESLint config with prettier integration
      expect(await fileExists(join(projectPath, 'eslint.config.mjs'))).toBe(true);
      const eslintConfig = await readTextFile(join(projectPath, 'eslint.config.mjs'));
      expect(eslintConfig).toContain('eslintConfigPrettier');
      expect(eslintConfig).toContain('eslint-config-prettier/flat');

      // Prettier configs
      expect(await fileExists(join(projectPath, '.prettierrc'))).toBe(true);
      expect(await fileExists(join(projectPath, '.prettierignore'))).toBe(true);

      // All deps in single package.json
      const pkg = await readJsonFile<{
        devDependencies: Record<string, string>;
        scripts: Record<string, string>;
      }>(join(projectPath, 'package.json'));
      expect(pkg.devDependencies.eslint).toBeDefined();
      expect(pkg.devDependencies.prettier).toBeDefined();
      expect(pkg.devDependencies['eslint-config-prettier']).toBeDefined();
      expect(pkg.scripts.lint).toBe('eslint .');
      expect(pkg.scripts.format).toContain('prettier');
    });

    test('generates combined config for turborepo', async () => {
      const projectName = 'test-eslint-prettier-turbo';
      const projectPath = join(tempDir, projectName);

      const result = await runCli(
        [
          projectName,
          '--app',
          'web:nextjs',
          '--app',
          'api:hono',
          '--linter',
          'eslint-prettier',
          '--no-git',
          '--no-install',
        ],
        tempDir,
      );

      expect(result.exitCode).toBe(0);

      // Shared eslint-config with eslint-config-prettier dep
      const eslintPkg = await readJsonFile<{
        name: string;
        devDependencies: Record<string, string>;
      }>(join(projectPath, 'packages/eslint-config/package.json'));
      expect(eslintPkg.name).toBe('@repo/eslint-config');
      expect(eslintPkg.devDependencies.eslint).toBeDefined();
      expect(eslintPkg.devDependencies['eslint-config-prettier']).toBeDefined();

      // base.js has eslint-config-prettier integration
      const baseJs = await readTextFile(join(projectPath, 'packages/eslint-config/base.js'));
      expect(baseJs).toContain('eslintConfigPrettier');
      expect(baseJs).toContain('eslint-config-prettier/flat');

      // Prettier configs at root
      expect(await fileExists(join(projectPath, '.prettierrc'))).toBe(true);
      expect(await fileExists(join(projectPath, '.prettierignore'))).toBe(true);

      // Root has prettier deps + scripts
      const rootPkg = await readJsonFile<{
        devDependencies: Record<string, string>;
        scripts: Record<string, string>;
      }>(join(projectPath, 'package.json'));
      expect(rootPkg.devDependencies.prettier).toBeDefined();
      expect(rootPkg.devDependencies['prettier-plugin-tailwindcss']).toBeDefined();
      expect(rootPkg.scripts.format).toContain('prettier');

      // Root does NOT have eslint deps
      expect(rootPkg.devDependencies.eslint).toBeUndefined();

      // Apps reference shared config
      const webPkg = await readJsonFile<{
        devDependencies: Record<string, string>;
        scripts: Record<string, string>;
      }>(join(projectPath, 'apps/web/package.json'));
      expect(webPkg.devDependencies['@repo/eslint-config']).toBe('*');
      expect(webPkg.scripts.lint).toBe('eslint .');
    });

    test('ESLint configs do NOT have prettier import in turborepo (handled by base.js)', async () => {
      const projectName = 'test-eslint-prettier-stacks';
      const projectPath = join(tempDir, projectName);

      const result = await runCli(
        [
          projectName,
          '--app',
          'web:nextjs',
          '--app',
          'api:hono',
          '--linter',
          'eslint-prettier',
          '--no-git',
          '--no-install',
        ],
        tempDir,
      );

      expect(result.exitCode).toBe(0);

      // Per-app configs in turborepo are thin wrappers — no prettier import
      const webConfig = await readTextFile(join(projectPath, 'apps/web/eslint.config.mjs'));
      expect(webConfig).toContain('nextConfig');
      expect(webConfig).not.toContain('eslintConfigPrettier');

      const apiConfig = await readTextFile(join(projectPath, 'apps/api/eslint.config.mjs'));
      expect(apiConfig).toContain('serverConfig');
      expect(apiConfig).not.toContain('eslintConfigPrettier');
    });
  });
});
