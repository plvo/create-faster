import { join } from 'node:path';
import { intro, log, note, outro } from '@clack/prompts';
import color from 'picocolors';
import { META } from '@/__meta__';
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

    const isTurborepo = config.apps.length > 1;

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

    await runPostGeneration(ctx, projectPath);

    displaySummaryNote(ctx);
    outro(color.green(`✨ Project created successfully at ${projectPath}!`));
  } catch (error) {
    log.error(`An error occurred:\n${error instanceof Error ? error.message : String(error)}`);
    outro('Operation cancelled, bye');
    process.exit(1);
  }
}

main().catch(log.error);

function displaySummaryNote(ctx: TemplateContext): void {
  const appsSummary = ctx.apps
    .map((app) => {
      const stack = META.stacks[app.stackName];
      const stackLabel = stack ? stack.label : app.stackName;
      const modulesCount = color.dim(` +${app.modules.length} modules`);

      return `• ${app.appName} (${stackLabel}${modulesCount})`;
    })
    .join('\n');

  note(appsSummary, 'Summary');

  const steps: string[] = [];

  steps.push(`cd ${ctx.projectName}`);
  steps.push('');
  steps.push('# Development:');
  steps.push(`${ctx.pm ?? 'npm'} run dev        # Start development server`);
  steps.push('');
  steps.push('# Build:');
  steps.push(`${ctx.pm ?? 'npm'} run build      # Build for production`);

  if (ctx.git) {
    steps.push('');
    steps.push('# Git:');
    steps.push('git remote add origin <your-repo-url>');
    steps.push('git push -u origin main');
  }

  note(steps.join('\n'), 'Next steps');
}
