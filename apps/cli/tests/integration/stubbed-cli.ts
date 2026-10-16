import { mkdir, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { type CliResult, runCli } from './helpers';

interface GeneratedProject {
  result: CliResult;
  projectPath: string;
  output: string;
}

export type GenerateProject = (name: string, args: string[], extraEnv?: Record<string, string>) => Promise<GeneratedProject>;

/**
 * Runs the CLI with stand-in executables first on PATH (a package manager, git, husky): each stub is
 * the body of a `sh` script. `generate` creates `<tempDir>/<name>` as the working directory and runs
 * the CLI there with the project name `name` and `args`.
 */
export async function createStubbedCli(
  tempDir: string,
  stubs: Record<string, string>,
): Promise<{ env: Record<string, string>; generate: GenerateProject }> {
  const stubBinDir = join(tempDir, 'stub-bin');
  await mkdir(stubBinDir);
  for (const [name, body] of Object.entries(stubs)) {
    await writeFile(join(stubBinDir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }
  const env = { PATH: `${stubBinDir}${delimiter}${process.env.PATH}` };

  async function generate(name: string, args: string[], extraEnv: Record<string, string> = {}) {
    const workDir = join(tempDir, name);
    await mkdir(workDir);
    const result = await runCli([name, ...args], workDir, { ...env, ...extraEnv });
    return { result, projectPath: join(workDir, name), output: result.stdout + result.stderr };
  }

  return { env, generate };
}
