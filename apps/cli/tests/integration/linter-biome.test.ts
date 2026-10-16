import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, readJsonFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

interface BiomeConfig {
  $schema: string;
  vcs: { enabled: boolean; useIgnoreFile: boolean };
  files: { includes: string[] };
  linter: { rules: { recommended?: boolean; preset?: string } };
  overrides?: { includes: string[]; linter: { rules: Record<string, Record<string, string>> } }[];
}

describe('biome config', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(name: string, args: string[]): Promise<{ dir: string; config: BiomeConfig }> {
    const result = await runCli(
      [name, ...args, '--linter', 'biome', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const dir = join(tempDir, name);
    return { dir, config: await readJsonFile<BiomeConfig>(join(dir, 'biome.json')) };
  }

  test('reads the generated .gitignore so build and generated output is never linted', async () => {
    const { dir, config } = await generate('biome-ignore', ['--app', 'biome-ignore:tanstack-start']);
    expect(config.vcs).toMatchObject({ enabled: true, useIgnoreFile: true });
    expect(await fileExists(join(dir, '.gitignore'))).toBe(true);
  });

  test('takes its schema from the installed Biome and uses the preset field', async () => {
    const { config } = await generate('biome-schema', ['--app', 'biome-schema:nextjs']);
    expect(config.$schema).toBe('./node_modules/@biomejs/biome/configuration_schema.json');
    expect(config.linter.rules.preset).toBe('recommended');
    expect(config.linter.rules).not.toHaveProperty('recommended');
  });

  test('skips the generated route tree of a TanStack Start app', async () => {
    const { config } = await generate('biome-start', ['--app', 'biome-start:tanstack-start']);
    expect(config.files.includes).toContain('!**/routeTree.gen.ts');
  });

  test('does not carry the route tree exclusion without a TanStack Start app', async () => {
    const { config } = await generate('biome-next', ['--app', 'biome-next:nextjs']);
    expect(config.files.includes).not.toContain('!**/routeTree.gen.ts');
  });

  test('lets a shadcn sidebar write its cookie, as the registry ships it', async () => {
    const { config } = await generate('biome-shadcn', ['--app', 'biome-shadcn:nextjs:shadcn']);
    expect(config.overrides).toEqual([
      {
        includes: ['**/components/ui/sidebar.tsx'],
        linter: { rules: { suspicious: { noDocumentCookie: 'off' } } },
      },
    ]);
  });

  test('keeps noDocumentCookie on without shadcn', async () => {
    const { config } = await generate('biome-no-shadcn', ['--app', 'biome-no-shadcn:nextjs']);
    expect(config.overrides).toBeUndefined();
  });
});
