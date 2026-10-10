import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, readTextFile, runCli } from './helpers';

describe('TanStack Start + next-themes', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(projectName: string, modules: string): Promise<string> {
    const app = modules ? `${projectName}:tanstack-start:${modules}` : `${projectName}:tanstack-start`;
    const result = await runCli([projectName, '--app', app, '--no-git', '--no-install'], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, projectName);
  }

  describe('with next-themes', () => {
    let rootRoute: string;
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await generate('start-themes', 'next-themes');
      rootRoute = await readTextFile(join(projectPath, 'src/routes/__root.tsx'));
    });

    test('imports the ThemeProvider from next-themes', () => {
      expect(rootRoute).toContain("import { ThemeProvider } from 'next-themes'");
    });

    test('configures the provider like the Next.js providers', () => {
      expect(rootRoute).toContain('attribute="class"');
      expect(rootRoute).toContain('defaultTheme="system"');
      expect(rootRoute).toContain('enableSystem');
      expect(rootRoute).toContain('storageKey="start-themes-theme"');
      expect(rootRoute).not.toContain('disableTransitionOnChange');
    });

    test('wraps the body content so the theme script is the first node of the body', () => {
      const body = rootRoute.indexOf('<body>');
      const open = rootRoute.indexOf('<ThemeProvider');
      const children = rootRoute.indexOf('{children}');
      const close = rootRoute.indexOf('</ThemeProvider>');
      const scripts = rootRoute.indexOf('<Scripts />');
      expect(body).toBeLessThan(open);
      expect(open).toBeLessThan(children);
      expect(children).toBeLessThan(close);
      expect(close).toBeLessThan(scripts);
    });

    test('renders the html shell with lang and suppressHydrationWarning', () => {
      expect(rootRoute).toContain('<html lang="en" suppressHydrationWarning>');
    });

    test('adds the next-themes dependency without a theme toggle', async () => {
      const pkg = await readJsonFile<{ dependencies: Record<string, string> }>(join(projectPath, 'package.json'));
      expect(pkg.dependencies['next-themes']).toMatch(/^\^0\.4/);
      expect(await Bun.file(join(projectPath, 'src/components/mode-toggle.tsx')).exists()).toBe(false);
    });
  });

  describe('without next-themes', () => {
    let rootRoute: string;

    beforeAll(async () => {
      const projectPath = await generate('start-plain', '');
      rootRoute = await readTextFile(join(projectPath, 'src/routes/__root.tsx'));
    });

    test('renders the html shell with lang and suppressHydrationWarning', () => {
      expect(rootRoute).toContain('<html lang="en" suppressHydrationWarning>');
    });

    test('does not mention the theme provider', () => {
      expect(rootRoute).not.toContain('next-themes');
      expect(rootRoute).not.toContain('ThemeProvider');
    });
  });
});
