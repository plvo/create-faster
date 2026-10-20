import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const startBlueprints = Object.entries(META.blueprints).filter(([, blueprint]) =>
  blueprint.context.apps.some((app) => app.stackName === 'tanstack-start'),
);

const ruleBody = (css: string, selector: string): string | undefined => {
  const match = css.match(new RegExp(`(?:^|\\n)${selector}\\s*\\{([^}]*)\\}`));
  return match?.[1];
};

describe('TanStack Start font variables', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(args: string[]): Promise<string> {
    const [projectName] = args;
    const result = await runCli([...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, projectName ?? '');
  }

  async function expectGeistThroughVariables(appDir: string): Promise<string> {
    const css = await readTextFile(join(appDir, 'src/styles.css'));
    expect(css).toContain("@import '@fontsource-variable/geist';");
    expect(css).toContain("@import '@fontsource-variable/geist-mono';");
    const root = ruleBody(css, ':root') ?? '';
    expect(root).toMatch(/--font-geist-sans:\s*'Geist Variable'/);
    expect(root).toMatch(/--font-geist-mono:\s*'Geist Mono Variable'/);
    expect(ruleBody(css, 'body') ?? '').not.toContain('font-family');
    expect(css).not.toMatch(/(^|\n)code\s*\{/);

    const manifest = JSON.parse(await readTextFile(join(appDir, 'package.json')));
    expect(manifest.dependencies['@fontsource-variable/geist']).toBeDefined();
    expect(manifest.dependencies['@fontsource-variable/geist-mono']).toBeDefined();
    return css;
  }

  test('a Start app with shadcn loads Geist and leaves the font mapping to the shadcn theme', async () => {
    const projectDir = await generate(['start-fonts-shadcn', '--app', 'start-fonts-shadcn:tanstack-start:shadcn']);
    await expectGeistThroughVariables(projectDir);
    const theme = await readTextFile(join(projectDir, 'src/styles/shadcn.css'));
    expect(theme).toContain('--font-sans: var(--font-geist-sans)');
    expect(theme).toContain('--font-mono: var(--font-geist-mono)');
  });

  test('a Start app without shadcn maps the theme fonts to the Geist variables', async () => {
    const projectDir = await generate(['start-fonts-plain', '--app', 'start-fonts-plain:tanstack-start']);
    const css = await expectGeistThroughVariables(projectDir);
    expect(css).toContain('--font-sans: var(--font-geist-sans)');
    expect(css).toContain('--font-mono: var(--font-geist-mono)');
  });

  test('a Start app of a turborepo loads Geist in the app', async () => {
    const projectDir = await generate(['start-fonts-turbo', '--app', 'web:tanstack-start:shadcn', '--app', 'api:hono']);
    await expectGeistThroughVariables(join(projectDir, 'apps/web'));
    const theme = await readTextFile(join(projectDir, 'packages/ui/src/base.css'));
    expect(theme).toContain('--font-sans: var(--font-geist-sans)');
  });

  test('at least one blueprint has a Start app', () => {
    expect(startBlueprints.length).toBeGreaterThan(0);
  });

  describe.each(startBlueprints)('blueprint %s', (name, blueprint) => {
    test('loads Geist through the font variables', async () => {
      const projectDir = await generate([name, '--blueprint', name]);
      const startApps = blueprint.context.apps.filter((app) => app.stackName === 'tanstack-start');
      const isSingleRepo = blueprint.context.apps.length === 1;
      for (const app of startApps) {
        await expectGeistThroughVariables(isSingleRepo ? projectDir : join(projectDir, 'apps', app.appName));
      }
    });
  });
});
