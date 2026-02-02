import { join } from 'node:path';
import { intro, log, outro } from '@clack/prompts';
import { ASCII, INTRO_MESSAGE } from '@/lib/constants';
import { displayGenerationErrors, generateProjectFiles } from '@/lib/file-generator';
import { runPostGeneration } from '@/lib/post-generation';
import { getAllTemplatesForContext } from '@/lib/template-resolver';
import { displayOutroCliCommand, displaySummaryNote } from '@/tui/summary';
import type { TemplateContext } from '@/types/ctx';
import { cli } from './cli';
import { parseFlags } from './flags';

async function main() {
  const partial = parseFlags();

  console.log(ASCII);

  intro(INTRO_MESSAGE);

  try {
    const config = await cli(partial);

    const isTurborepo = config.apps.length > 1;

    const ctx: TemplateContext = {
      ...config,
      repo: isTurborepo ? 'turborepo' : 'single',
    };

    const templates = getAllTemplatesForContext(ctx);

    const result = await generateProjectFiles(templates, ctx);

    if (result.skipped.length || result.failed.length) {
      displayGenerationErrors(result);
    }

    if (!result.success) {
      log.error('Project generation failed. Please fix the errors and try again.');
      process.exit(1);
    }

    const projectPath = join(process.cwd(), ctx.projectName);
    await runPostGeneration(ctx, projectPath);

    displaySummaryNote(ctx);
    displayOutroCliCommand(ctx, projectPath);
  } catch (error) {
    log.error(`An error occurred:\n${error instanceof Error ? error.message : String(error)}`);
    outro('👋 Bye');
    process.exit(1);
  }
}

main().catch((error) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
