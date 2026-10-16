import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readJsonFile, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

interface AppPackageJson {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

describe('Next.js bundle analysis', () => {
  let tempDir: string;

  const generate = async (name: string, args: string[]): Promise<string> => {
    const result = await runCli([name, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
    expect(result.exitCode).toBe(0);
    return join(tempDir, name);
  };

  const expectTurbopackAnalyzerOnly = async (appPath: string): Promise<void> => {
    const pkg = await readJsonFile<AppPackageJson>(join(appPath, 'package.json'));
    expect(pkg.scripts.analyze).toBe('next experimental-analyze');
    expect(pkg.dependencies['@next/bundle-analyzer']).toBeUndefined();
    expect(pkg.devDependencies['@next/bundle-analyzer']).toBeUndefined();

    const config = await readTextFile(join(appPath, 'next.config.ts'));
    expect(config).not.toContain('bundle-analyzer');
    expect(config).not.toContain('withBundleAnalyzer');
    expect(config).not.toContain('ANALYZE');
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('single repo: the config exports the plain Next.js config', async () => {
    const projectPath = await generate('analyze-single', ['--app', 'web:nextjs']);
    await expectTurbopackAnalyzerOnly(projectPath);
    expect(await readTextFile(join(projectPath, 'next.config.ts'))).toContain('export default nextConfig;');
  });

  test('single repo with mdx: the config exports the config wrapped by MDX only', async () => {
    const projectPath = await generate('analyze-mdx', ['--app', 'web:nextjs:mdx']);
    await expectTurbopackAnalyzerOnly(projectPath);
    expect(await readTextFile(join(projectPath, 'next.config.ts'))).toContain('export default withMDX(nextConfig);');
  });

  test('turborepo: every Next.js app keeps the analyze script only', async () => {
    const projectPath = await generate('analyze-mono', ['--app', 'web:nextjs:mdx', '--app', 'admin:nextjs']);
    for (const app of ['web', 'admin']) {
      await expectTurbopackAnalyzerOnly(join(projectPath, 'apps', app));
    }
  });

  test('cloudflare: the OpenNext dev init stays and no analyzer wraps the config', async () => {
    const projectPath = await generate('analyze-cf', ['--app', 'web:nextjs:mdx', '--deployment', 'cloudflare']);
    await expectTurbopackAnalyzerOnly(projectPath);
    const config = await readTextFile(join(projectPath, 'next.config.ts'));
    expect(config).toContain('initOpenNextCloudflareForDev');
    expect(config).toContain('export default withMDX(nextConfig);');
  });
});
