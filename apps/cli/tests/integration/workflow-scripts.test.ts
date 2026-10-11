import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, readJsonFile, readTextFile, runCli } from './helpers';

const BLUEPRINTS_DIR = join(import.meta.dir, '../../templates/blueprints');
const BLUEPRINTS_WITH_WORKFLOWS = readdirSync(BLUEPRINTS_DIR).filter((name) =>
  existsSync(join(BLUEPRINTS_DIR, name, '__github/workflows')),
);
const LINTERS = [undefined, ...Object.keys(META.project.linter.options)];
const PACKAGE_MANAGERS = ['bun', 'npm', ...(Bun.which('pnpm') ? ['pnpm'] : [])];
const SCRIPT_INVOCATION = /\b(bun|npm|pnpm) run ([\w:-]+)/g;

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
        test(`${blueprint} with ${linter ?? 'no linter'} and ${pm} only runs scripts the project defines`, async () => {
          const name = `${blueprint}-${linter ?? 'none'}-${pm}`;
          const args = [name, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', pm];
          if (linter) args.push('--linter', linter);
          const result = await runCli(args, tempDir);
          expect(result.exitCode).toBe(0);

          const projectDir = join(tempDir, name);
          const { scripts = {} } = await readJsonFile<{ scripts?: Record<string, string> }>(
            join(projectDir, 'package.json'),
          );
          const workflows = await readWorkflows(projectDir);
          expect(workflows.length).toBeGreaterThan(0);

          const invocations = workflows.flatMap(({ file, content }) =>
            [...content.matchAll(SCRIPT_INVOCATION)].map(([, runner = '', script = '']) => ({ file, runner, script })),
          );
          expect(invocations.length).toBeGreaterThan(0);
          for (const { file, runner, script } of invocations) {
            expect({ file, script, defined: script in scripts }).toEqual({ file, script, defined: true });
            expect({ file, script, runner }).toEqual({ file, script, runner: pm });
          }
        });
      }
    }
  }

  test('the deploy workflow lints when the project has a linter script', async () => {
    const name = 'lints-with-biome';
    const result = await runCli(
      [name, '--blueprint', 'lambda-sst', '--no-git', '--no-install', '--pm', 'bun', '--linter', 'biome'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    const [deploy] = await readWorkflows(join(tempDir, name));
    expect(deploy?.content).toContain('bun run lint');
  });
});
