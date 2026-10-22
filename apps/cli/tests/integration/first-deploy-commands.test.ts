import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'bun';
import { cleanupTempDir, createTempDir, PNPM_AVAILABLE, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

// The first deploy of a Worker takes its secrets from a file, so the documented command forwards a flag to the `deploy`
// script. Package managers differ on how: npm needs a `--` before it, bun and pnpm pass it on as it is. The commands the
// docs print are run here over a `deploy` script that prints its arguments.
const DOCUMENTED = [
  { blueprint: 'cloudflare-fullstack-nextjs', document: 'docs/agents/cloudflare-deploy.md' },
  { blueprint: 'cloudflare-payload-nextjs', document: 'README.md' },
];
const PACKAGE_MANAGERS = ['bun', 'npm', 'pnpm'] as const;

describe.each(DOCUMENTED)('the first deploy command of $blueprint', ({ blueprint, document }) => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    await mkdir(join(tempDir, 'script'), { recursive: true });
    await Bun.write(join(tempDir, 'script/show-arguments.js'), 'console.log(JSON.stringify(process.argv.slice(2)));\n');
    await Bun.write(
      join(tempDir, 'script/package.json'),
      JSON.stringify({ name: 'deploy-script', private: true, scripts: { deploy: 'node show-arguments.js' } }),
    );
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test.each([...PACKAGE_MANAGERS])('under %s, it hands the secrets file to the script', async (pm) => {
    if (pm === 'pnpm' && !PNPM_AVAILABLE) return;
    const name = `${blueprint}-${pm}`;
    const result = await runCli([name, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', pm], tempDir);
    expect(result.exitCode, result.stderr).toBe(0);

    const text = await readTextFile(join(tempDir, name, document));
    const documented = text.match(/\(cd apps\/web && (\S+ run deploy [^)]*--secrets-file \.prod\.env)\)/)?.[1];
    expect(documented, `the first deploy of ${document}`).toBeDefined();

    const run = await $`sh -c ${documented as string}`.cwd(join(tempDir, 'script')).quiet().nothrow();
    expect(run.stderr.toString()).not.toContain('ERR');
    const printed = run.stdout.toString().trim().split('\n').at(-1) ?? '';
    expect(JSON.parse(printed)).toEqual(['--secrets-file', '.prod.env']);
    expect(documented?.startsWith(`${pm} run deploy`)).toBe(true);
    expect(documented?.includes(' -- --secrets-file')).toBe(pm === 'npm');
  });
});
