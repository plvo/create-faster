import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { shipsWorkflows } from '../blueprint-workflows';
import { cleanupTempDir, createTempDir, PNPM_AVAILABLE, readJsonFile, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINTS_DIR = join(import.meta.dir, '../../templates/blueprints');
const BLUEPRINTS_WITH_WORKFLOWS = Object.keys(META.blueprints).filter((name) => shipsWorkflows(name, BLUEPRINTS_DIR));
const LINTERS = [undefined, ...Object.keys(META.project.linter.options)];
const PACKAGE_MANAGERS = ['bun', 'npm', 'pnpm', undefined];
const SCRIPT_INVOCATION = /\b(bun|npm|pnpm) run ([\w:-]+)/g;
const NPM_INSTALL = /\bnpm install\b/;

async function readWorkflows(projectDir: string): Promise<{ file: string; content: string }[]> {
  const workflowsDir = join(projectDir, '.github', 'workflows');
  const files = readdirSync(workflowsDir).filter((file) => file.endsWith('.yml'));
  return Promise.all(files.map(async (file) => ({ file, content: await readTextFile(join(workflowsDir, file)) })));
}

describe('workflows generated for blueprints', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('blueprints shipping a workflow are discovered', () => {
    expect(BLUEPRINTS_WITH_WORKFLOWS.length).toBeGreaterThan(0);
  });

  for (const blueprint of BLUEPRINTS_WITH_WORKFLOWS) {
    for (const linter of LINTERS) {
      for (const pm of PACKAGE_MANAGERS) {
        const runner = pm ?? 'npm';
        const skip = pm === 'pnpm' && !PNPM_AVAILABLE;
        const title = `${blueprint} with ${linter ?? 'no linter'} and ${pm ?? 'no package manager'} runs exactly the scripts the project defines${skip ? ' (skipped: pnpm is not installed)' : ''}`;

        test.skipIf(skip)(title, async () => {
          const name = `${blueprint}-${linter ?? 'none'}-${pm ?? 'unset'}`;
          const args = [name, '--blueprint', blueprint, '--no-git', '--no-install'];
          if (pm) args.push('--pm', pm);
          if (linter) args.push('--linter', linter);
          const result = await runCli(args, tempDir);
          expect(result.exitCode).toBe(0);

          const projectDir = join(tempDir, name);
          const { scripts = {} } = await readJsonFile<{ scripts?: Record<string, string> }>(
            join(projectDir, 'package.json'),
          );
          const workflows = await readWorkflows(projectDir);
          expect(workflows.length).toBeGreaterThan(0);

          for (const { file, content } of workflows) {
            const invoked = [...content.matchAll(SCRIPT_INVOCATION)].map(([, invokedRunner = '', script = '']) => ({
              runner: invokedRunner,
              script,
            }));
            expect(invoked.length).toBeGreaterThan(0);
            for (const { runner: invokedRunner, script } of invoked) {
              expect({ file, script, defined: script in scripts }).toEqual({ file, script, defined: true });
              expect({ file, script, runner: invokedRunner }).toEqual({ file, script, runner });
            }
            expect({ file, runsLint: invoked.some(({ script }) => script === 'lint') }).toEqual({
              file,
              runsLint: 'lint' in scripts,
            });
            expect({ file, installsFromLockfile: !NPM_INSTALL.test(content) }).toEqual({
              file,
              installsFromLockfile: pm !== undefined,
            });
          }
        });
      }
    }
  }

  test('the deploy workflow lints when the project has a linter script', async () => {
    const name = 'lints-with-biome';
    const result = await runCli(
      [name, '--blueprint', 'lambda-sst-hono', '--no-git', '--no-install', '--pm', 'bun', '--linter', 'biome'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    const [deploy] = await readWorkflows(join(tempDir, name));
    expect(deploy?.content).toContain('bun run lint');
  });
});
