import { join } from 'node:path';
import { intro, log, outro } from '@clack/prompts';
import { META } from '@/__meta__';
import { ASCII, INTRO_MESSAGE } from '@/lib/constants';
import { displayGenerationErrors, generateProjectFiles } from '@/lib/file-generator';
import { runPostGeneration } from '@/lib/post-generation';
import { getAllTemplatesForContext } from '@/lib/template-resolver';
import { displayOutroCliCommand, displaySummaryNote } from '@/tui/summary';
import type { TemplateContext } from '@/types/ctx';
import { blueprintCli, cli } from './cli';
import { parseFlags } from './flags';
import { promptSelect } from './prompts/base-prompts';
import { selectBlueprintPrompt } from './prompts/stack-prompts';

async function main() {
  const partial = parseFlags();

  console.log(ASCII);

  intro(INTRO_MESSAGE);

  try {
    let config: Omit<TemplateContext, 'repo'>;

    if (partial.blueprint) {
      config = await blueprintCli(partial.blueprint, partial);
    } else {
      const hasCompositionFlags =
        'apps' in partial || 'project' in partial || 'git' in partial || 'pm' in partial || 'skipInstall' in partial;
      const hasBlueprints = Object.keys(META.blueprints).length > 0;

      if (!hasCompositionFlags && hasBlueprints) {
        const mode = await promptSelect<string>(undefined, 'What would you like to create?', partial, {
          options: [
            { value: 'custom', label: 'Start from scratch', hint: 'Choose your own stack and libraries' },
            { value: 'blueprint', label: 'Use a template', hint: 'Pre-configured project with application code' },
          ],
        });

        if (mode === 'blueprint') {
          const blueprintName = await selectBlueprintPrompt('Choose a template:');

          config = await blueprintCli(blueprintName, partial);
        } else {
          config = await cli(partial);
        }
      } else {
        config = await cli(partial);
      }
    }

    const isTurborepo = config.apps.length > 1;

    const ctx: TemplateContext = {
      ...config,
      repo: isTurborepo ? 'turborepo' : 'single',
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
