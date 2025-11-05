import { join } from 'node:path';
import { intro, log, outro } from '@clack/prompts';
import color from 'picocolors';
import { displayGenerationErrors, generateProjectFiles } from '@/lib/file-generator';
import { runPostGeneration } from '@/lib/post-generation';
import { getAllTemplatesForContext } from '@/lib/template-resolver';
import type { TemplateContext } from '@/types/ctx';
import { cli } from './cli';
import { INTRO_ASCII, INTRO_MESSAGE } from './constants';

async function main() {
  console.log(INTRO_ASCII);

  intro(INTRO_MESSAGE);

  try {
    const config = await cli();

    const isTurborepo =
      config.apps.length > 1 || config.apps.some((app) => app.metaApp && app.metaServer?.name !== 'none');

    const ctx: TemplateContext = {
      repo: isTurborepo ? 'turborepo' : 'single',
      ...config,
    };

    const templates = getAllTemplatesForContext(ctx);

    const result = await generateProjectFiles(templates, ctx);

    if (result.skipped.length > 0 || result.failed.length > 0) {
      displayGenerationErrors(result);
    }

    if (!result.success) {
      log.error('Project generation failed. Please fix the errors and try again.');
      process.exit(1);
    }

    const projectPath = join(process.cwd(), ctx.projectName);

    await runPostGeneration(ctx, projectPath, {
      install: true,
      packageManager: 'bun',
    });

    outro(color.green(`✨ Project created successfully at ${projectPath}!`));
  } catch (error) {
    log.error(`An error occurred:\n${error instanceof Error ? error.message : String(error)}`);
    outro('Operation cancelled, bye');
    process.exit(1);
  }
}

main().catch(log.error);
