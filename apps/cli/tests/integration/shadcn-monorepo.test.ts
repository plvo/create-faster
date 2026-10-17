import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  cleanupTempDir,
  createTempDir,
  fileExists,
  readJsonFile,
  readTextFile,
  resolveExportTarget,
  runCli,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

interface ComponentsJson {
  style: string;
  rsc: boolean;
  tsx: boolean;
  tailwind: { config: string; css: string; baseColor: string; cssVariables: boolean };
  iconLibrary: string;
  aliases: { components: string; hooks: string; lib: string; utils: string; ui: string };
}

interface UiManifest {
  name: string;
  exports: Record<string, string>;
  dependencies: Record<string, string>;
}

const PACKAGE_NAME = '@repo/ui';

function resolveExport(exports: Record<string, string>, specifier: string): string | undefined {
  return resolveExportTarget(exports, `.${specifier.slice(PACKAGE_NAME.length)}`);
}

describe('shadcn components.json', () => {
  let tempDir: string;
  let turborepo: string;
  let singleRepo: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const flags = ['--no-git', '--no-install', '--pm', 'bun'];
    const mono = await runCli(
      ['mono', '--app', 'web:nextjs:shadcn', '--app', 'admin:tanstack-start:shadcn', ...flags],
      tempDir,
    );
    expect(mono.exitCode).toBe(0);
    const single = await runCli(['single', '--app', 'web:nextjs:shadcn', ...flags], tempDir);
    expect(single.exitCode).toBe(0);
    turborepo = join(tempDir, 'mono');
    singleRepo = join(tempDir, 'single');
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('turborepo', () => {
    const apps = ['web', 'admin'];

    test('every app and the ui package carry a components.json', async () => {
      for (const app of apps) expect(await fileExists(join(turborepo, 'apps', app, 'components.json'))).toBe(true);
      expect(await fileExists(join(turborepo, 'packages/ui/components.json'))).toBe(true);
    });

    test('the app and the ui package agree on style, icon library, base color and Tailwind v4 config', async () => {
      const ui = await readJsonFile<ComponentsJson>(join(turborepo, 'packages/ui/components.json'));
      for (const app of apps) {
        const config = await readJsonFile<ComponentsJson>(join(turborepo, 'apps', app, 'components.json'));
        expect(config.style).toBe(ui.style);
        expect(config.iconLibrary).toBe(ui.iconLibrary);
        expect(config.tailwind.baseColor).toBe(ui.tailwind.baseColor);
        expect(config.tailwind.cssVariables).toBe(ui.tailwind.cssVariables);
        expect(config.tailwind.config).toBe('');
        expect(ui.tailwind.config).toBe('');
      }
    });

    test('the icon library of components.json is a dependency of the ui package', async () => {
      const ui = await readJsonFile<ComponentsJson>(join(turborepo, 'packages/ui/components.json'));
      const manifest = await readJsonFile<UiManifest>(join(turborepo, 'packages/ui/package.json'));
      expect(manifest.dependencies[`${ui.iconLibrary}-react`]).toBeDefined();
    });

    test('the ui, hooks and utils aliases of an app are the ones of the ui package', async () => {
      const ui = await readJsonFile<ComponentsJson>(join(turborepo, 'packages/ui/components.json'));
      for (const app of apps) {
        const { aliases } = await readJsonFile<ComponentsJson>(join(turborepo, 'apps', app, 'components.json'));
        expect(aliases.ui).toBe(ui.aliases.ui);
        expect(aliases.hooks).toBe(ui.aliases.hooks);
        expect(aliases.utils).toBe(ui.aliases.utils);
      }
    });

    test('every alias that targets the ui package resolves through its exports to a generated file or directory', async () => {
      const uiPath = join(turborepo, 'packages/ui');
      const ui = await readJsonFile<ComponentsJson>(join(uiPath, 'components.json'));
      const manifest = await readJsonFile<UiManifest>(join(uiPath, 'package.json'));
      const resolve = (alias: string, leaf: string) => resolveExport(manifest.exports, `${alias}/${leaf}`);

      expect(resolveExport(manifest.exports, ui.aliases.utils)).toBe('./src/lib/utils.ts');
      expect(await fileExists(join(uiPath, 'src/lib/utils.ts'))).toBe(true);
      expect(resolve(ui.aliases.ui, 'button')).toBe('./src/components/ui/button.tsx');
      expect(await fileExists(join(uiPath, 'src/components/ui/button.tsx'))).toBe(true);
      expect(resolve(ui.aliases.hooks, 'use-mobile')).toBe('./src/hooks/use-mobile.ts');
      expect(await fileExists(join(uiPath, 'src/hooks/use-mobile.ts'))).toBe(true);
      expect(resolve(ui.aliases.components, 'ui/button')).toBe('./src/components/ui/button.tsx');
      expect(resolve(ui.aliases.lib, 'utils')).toBe('./src/lib/utils.ts');
    });

    test('the Tailwind css of every components.json is the stylesheet of the ui package', async () => {
      const uiPath = join(turborepo, 'packages/ui');
      const ui = await readJsonFile<ComponentsJson>(join(uiPath, 'components.json'));
      expect(await fileExists(join(uiPath, ui.tailwind.css))).toBe(true);
      for (const app of apps) {
        const appPath = join(turborepo, 'apps', app);
        const config = await readJsonFile<ComponentsJson>(join(appPath, 'components.json'));
        expect(join(appPath, config.tailwind.css)).toBe(join(uiPath, ui.tailwind.css));
      }
    });

    test('the agent notes name the ui package directory and run the command from the app directory', async () => {
      for (const app of apps) {
        const notes = await readTextFile(join(turborepo, 'apps', app, 'AGENTS.md'));
        expect(notes).toContain('packages/ui/src/components/ui/');
        expect(notes).toContain(`cd apps/${app} && bunx shadcn@latest add <name>`);
        expect(notes).toContain('@repo/ui/components/ui/<name>');
      }
    });
  });

  describe('single repo', () => {
    test('has one components.json at the root and no ui package', async () => {
      expect(await fileExists(join(singleRepo, 'components.json'))).toBe(true);
      expect(await fileExists(join(singleRepo, 'packages'))).toBe(false);
    });

    test('keeps the local aliases', async () => {
      const config = await readJsonFile<ComponentsJson>(join(singleRepo, 'components.json'));
      expect(config.tailwind.css).toBe('src/styles/globals.css');
      expect(config.aliases.components).toBe('@/components');
      expect(config.aliases.hooks).toBe('@/hooks');
      expect(config.aliases.utils).toBe('src/lib/utils');
    });

    test('the agent notes name src/components/ui and run the command from the project root', async () => {
      const notes = await readTextFile(join(singleRepo, 'AGENTS.md'));
      expect(notes).toContain('src/components/ui/');
      expect(notes).toContain('`bunx shadcn@latest add <name>`');
      expect(notes).not.toContain('packages/ui');
    });
  });
});
