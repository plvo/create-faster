import { log, outro } from '@clack/prompts';
import color from 'picocolors';
import type { InstallFailure } from '@/lib/post-generation';
import { quoteForShell } from '@/lib/project-location';

export function buildInstallFailureMessage(projectDir: string, failure: InstallFailure): string {
  return `Project files were generated, but the dependency install failed.

${failure.output}

Fix the cause, then retry in the project directory:

  cd ${quoteForShell(projectDir)} && ${failure.command}`;
}

export function displayInstallFailure(projectDir: string, failure: InstallFailure): void {
  log.error(buildInstallFailureMessage(projectDir, failure));
  outro(color.red('Dependencies were not installed'));
}
