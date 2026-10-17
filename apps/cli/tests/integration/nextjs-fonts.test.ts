import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, fileExists, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const FONT_VARIABLES = ['geistSans.variable', 'geistMono.variable'];

const nextjsBlueprints = Object.entries(META.blueprints).filter(([, blueprint]) =>
  blueprint.context.apps.some((app) => app.stackName === 'nextjs'),
);

const openingTag = (source: string, tag: 'html' | 'body'): string => {
  const match = source.match(new RegExp(`<${tag}\\b[^>]*>`));
  if (!match) throw new Error(`no <${tag}> element in the layout`);
  return match[0];
};

describe('Next.js font variables', () => {
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

  async function readLayouts(projectDir: string, appNames: string[]): Promise<string[]> {
    const candidates = [join(projectDir, 'src/app/layout.tsx'), ...appNames.map((name) => join(projectDir, 'apps', name, 'src/app/layout.tsx'))];
    const layouts: string[] = [];
    for (const candidate of candidates) {
      if (await fileExists(candidate)) layouts.push(await readTextFile(candidate));
    }
    return layouts;
  }

  function expectVariablesOnHtml(layout: string): void {
    const html = openingTag(layout, 'html');
    for (const variable of FONT_VARIABLES) {
      expect(html).toContain(variable);
      expect(openingTag(layout, 'body')).not.toContain(variable);
    }
  }

  test('a Next.js app with shadcn sets the font variables on <html>', async () => {
    const projectDir = await generate(['fonts-shadcn', '--app', 'fonts-shadcn:nextjs:shadcn']);
    const layouts = await readLayouts(projectDir, []);
    expect(layouts).toHaveLength(1);
    expectVariablesOnHtml(layouts[0] as string);
  });

  test('a Next.js app without shadcn sets the font variables on <html>', async () => {
    const projectDir = await generate(['fonts-plain', '--app', 'fonts-plain:nextjs']);
    const layouts = await readLayouts(projectDir, []);
    expect(layouts).toHaveLength(1);
    expectVariablesOnHtml(layouts[0] as string);
  });

  test('a Next.js app without shadcn takes the body font from the theme, not a fixed stack', async () => {
    const projectDir = await generate(['fonts-theme', '--app', 'fonts-theme:nextjs']);
    const css = await readTextFile(join(projectDir, 'src/styles/globals.css'));
    expect(css).toContain('--font-sans: var(--font-geist-sans)');
    expect(css).not.toMatch(/font-family:\s*Arial/);
  });

  test('a Next.js app of a turborepo sets the font variables on <html>', async () => {
    const projectDir = await generate(['fonts-turbo', '--app', 'web:nextjs:shadcn', '--app', 'api:hono']);
    const layouts = await readLayouts(projectDir, ['web']);
    expect(layouts).toHaveLength(1);
    expectVariablesOnHtml(layouts[0] as string);
  });

  test('at least one blueprint has a Next.js app', () => {
    expect(nextjsBlueprints.length).toBeGreaterThan(0);
  });

  describe.each(nextjsBlueprints)('blueprint %s', (name, blueprint) => {
    test('sets the font variables on <html>', async () => {
      const projectDir = await generate([name, '--blueprint', name]);
      const appNames = blueprint.context.apps.filter((app) => app.stackName === 'nextjs').map((app) => app.appName);
      const layouts = await readLayouts(projectDir, appNames);
      expect(layouts.length).toBeGreaterThan(0);
      for (const layout of layouts) expectVariablesOnHtml(layout);
    });
  });
});
