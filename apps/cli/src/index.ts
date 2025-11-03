import { join } from 'node:path';
import { log } from '@clack/prompts';
import { displayGenerationResults, generateProjectFiles } from '@/lib/file-generator';
import { runPostGeneration } from '@/lib/post-generation';
import { getAllTemplatesForContext } from '@/lib/template-resolver';
import type { TemplateContext } from '@/types/ctx';
import { cli } from './cli';

async function main() {
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

    displayGenerationResults(result);

    if (!result.success) {
      log.error('Project generation failed. Please fix the errors and try again.');
      process.exit(1);
    }

    const projectPath = join(process.cwd(), ctx.projectName);

    await runPostGeneration(ctx, projectPath, {
      install: true,
      packageManager: 'bun',
    });
  } catch (error) {
    log.error(`An error occurred:\n${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main().catch(log.error);
