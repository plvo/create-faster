import './timeout';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { cleanupTempDir, createTempDir, fileExists, runCli } from './helpers';

const FORMAT_RAN_MARKER = 'format-ran.txt';
const FORMAT_IN_REPOSITORY_MARKER = 'format-in-repository.txt';

describe('post-generate steps run by the CLI', () => {
  let tempDir: string;
  let stubBinDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    stubBinDir = join(tempDir, 'stub-bin');
    await mkdir(stubBinDir);
    await writeFile(
      join(stubBinDir, 'npm'),
      `#!/bin/sh
case "$1 $2" in
  "--version "*) echo 10.0.0 ;;
  "install "*) mkdir -p node_modules ;;
  "run format")
    test -d node_modules || exit 3
    if [ -n "$STUB_FORMAT_FAILS" ]; then echo "stub formatter: cannot parse src/app.ts" >&2; exit 1; fi
    if [ -d .git ]; then echo in-repository > ${FORMAT_IN_REPOSITORY_MARKER}; fi
    echo ran > ${FORMAT_RAN_MARKER} ;;
esac
`,
      { mode: 0o755 },
    );
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  async function generate(name: string, args: string[], env: Record<string, string> = {}) {
    const workDir = join(tempDir, name);
    await mkdir(workDir);
    const result = await runCli([name, '--app', `${name}:nextjs`, '--pm', 'npm', ...args], workDir, {
      PATH: `${stubBinDir}${delimiter}${process.env.PATH}`,
      ...env,
    });
    return { result, projectPath: join(workDir, name), output: result.stdout + result.stderr };
  }

  test('runs the format script after the install, in the repository created beforehand', async () => {
    const { result, projectPath } = await generate('formats', ['--linter', 'prettier', '--git']);

    expect(result.exitCode).toBe(0);
    expect(await readFile(join(projectPath, FORMAT_RAN_MARKER), 'utf8')).toBe('ran\n');
    expect(await fileExists(join(projectPath, FORMAT_IN_REPOSITORY_MARKER))).toBe(true);
  });

  test('runs it for the formatter of a composite linter', async () => {
    const { result, projectPath } = await generate('composite', ['--linter', 'eslint-prettier', '--no-git']);

    expect(result.exitCode).toBe(0);
    expect(await fileExists(join(projectPath, FORMAT_RAN_MARKER))).toBe(true);
  });

  test('runs nothing for a linter that declares no step', async () => {
    const { result, projectPath } = await generate('no-step', ['--linter', 'eslint', '--no-git']);

    expect(result.exitCode).toBe(0);
    expect(await fileExists(join(projectPath, FORMAT_RAN_MARKER))).toBe(false);
  });

  test('a failing step only warns: the run succeeds and the summary gives the command to rerun', async () => {
    const { result, projectPath, output } = await generate('format-fails', ['--linter', 'prettier', '--no-git'], {
      STUB_FORMAT_FAILS: '1',
    });

    expect(result.exitCode).toBe(0);
    expect(output).toContain('"Format the generated files" failed: stub formatter: cannot parse src/app.ts');
    expect(output).toContain('Project created successfully');
    expect(output).toMatch(/# Format the generated files:[\s│]+npm run format/);
    expect(await fileExists(join(projectPath, 'package.json'))).toBe(true);
  });

  test('--no-install skips the step and lists it among the next steps after the install', async () => {
    const { result, projectPath, output } = await generate('no-install', [
      '--linter',
      'prettier',
      '--no-git',
      '--no-install',
    ]);

    expect(result.exitCode).toBe(0);
    expect(await fileExists(join(projectPath, FORMAT_RAN_MARKER))).toBe(false);
    expect(output).toMatch(/# Install dependencies:[\s│]+npm install[\s│]+# Format the generated files:[\s│]+npm run format/);
  });

  test('a successful step is not repeated in the next steps', async () => {
    const { output } = await generate('done', ['--linter', 'prettier', '--no-git']);

    expect(output).not.toContain('# Format the generated files:');
  });
});
