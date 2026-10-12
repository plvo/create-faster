import { log, outro } from '@clack/prompts';
import color from 'picocolors';
import type { InstallFailure } from '@/lib/post-generation';

export function buildInstallFailureMessage(projectName: string, failure: InstallFailure): string {
  return `Project files were generated, but the dependency install failed.

${failure.output}

Fix the cause, then retry in the project directory:

  cd ${projectName} && ${failure.command}`;
}

export function displayInstallFailure(projectName: string, failure: InstallFailure): void {
  log.error(buildInstallFailureMessage(projectName, failure));
  outro(color.red('Dependencies were not installed'));
}
