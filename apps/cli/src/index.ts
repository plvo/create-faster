import { intro, log, outro } from '@clack/prompts';
import { ASCII, INTRO_MESSAGE } from '@/lib/constants';
import { getErrorMessage } from '@/lib/error-utils';
import { displayGenerationErrors, generateProjectFiles } from '@/lib/file-generator';
import { findMissingPackageManager, missingPackageManagerMessage } from '@/lib/package-manager';
import { runPostGeneration } from '@/lib/post-generation';
import { getProjectDir, getProjectPath } from '@/lib/project-location';
import { getAllTemplatesForContext } from '@/lib/template-resolver';
import { displayInstallFailure } from '@/tui/install-failure';
import { printError } from '@/tui/print-error';
import { displayOutroCliCommand, displaySummaryNote } from '@/tui/summary';
import type { TemplateContext } from '@/types/ctx';
import { promptForContext } from './cli';
import { parseFlags } from './flags';

async function main() {
  const partial = parseFlags();

  console.log(ASCII);

  intro(INTRO_MESSAGE);

  try {
    const config = await promptForContext(partial);

    const isTurborepo = config.apps.length > 1;

    const ctx: TemplateContext = {
      ...config,
      repo: isTurborepo ? 'turborepo' : 'single',
      dbPort: config.project.database ? Math.floor(Math.random() * 50000) + 10000 : undefined,
    };

    const missingPackageManager = findMissingPackageManager(ctx);
    if (missingPackageManager) {
      printError(missingPackageManagerMessage(missingPackageManager));
      process.exit(1);
    }

    const templates = getAllTemplatesForContext(ctx);

    const result = await generateProjectFiles(templates, ctx);

    if (result.skipped.length > 0 || result.failed.length > 0) {
      displayGenerationErrors(result);
    }

    if (!result.success) {
      log.error('Project generation failed. Please fix the errors and try again.');
      process.exit(1);
    }

    const projectPath = getProjectPath(ctx);
    const postGeneration = await runPostGeneration(ctx, projectPath);

    if (postGeneration.installFailure) {
      displayInstallFailure(getProjectDir(ctx), postGeneration.installFailure);
      process.exit(1);
    }

    displaySummaryNote(ctx, postGeneration.gitFailure, postGeneration.pendingPostGenerate);
    displayOutroCliCommand(ctx, projectPath);
  } catch (error) {
    log.error(`An error occurred:\n${getErrorMessage(error)}`);
    outro('👋 Bye');
    process.exit(1);
  }
}

main().catch((error) => {
  log.error(getErrorMessage(error));
  process.exit(1);
});
