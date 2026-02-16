import { $ } from 'bun';

export { cleanupTempDir, createTempDir, fileExists, runCli } from '../integration/helpers';
export type { CliResult } from '../integration/helpers';

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCommand(args: string[], cwd: string): Promise<CommandResult> {
  try {
    const result = await $`${args}`
      .cwd(cwd)
      .env({ ...process.env, CI: '1', NEXT_TELEMETRY_DISABLED: '1' })
      .quiet();

    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  } catch (error: unknown) {
    const e = error as { exitCode?: number; stdout?: Buffer; stderr?: Buffer };
    return {
      exitCode: e.exitCode ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}
